"""Headless Dream-1 trial runner on the stock Dream YAM Sim.

Mirrors dream_control.main()'s request/validate/step loop, with three changes for evaluation:
- the budget is simulated seconds (physics pauses during inference anyway), not wall-clock;
- no viewer and no real-time pacing; cameras render only on the rows the model sees;
- a detectors.Tracker grades every row and can stop the trial at verified success.
"""

import json
import os
import sys
import time
from collections import deque
from pathlib import Path

import numpy as np

EXAMPLE_DIR = Path(sys.prefix) / "Lib" / "site-packages" / "dream_examples" / "yam_mujoco"
if not EXAMPLE_DIR.is_dir():  # non-Windows venv layout
    import sysconfig

    EXAMPLE_DIR = Path(sysconfig.get_paths()["purelib"]) / "dream_examples" / "yam_mujoco"
sys.path.insert(0, str(EXAMPLE_DIR))
os.environ.setdefault("MUJOCO_GL", "glfw" if os.name == "nt" else "egl")

import dream_control as dc  # noqa: E402
import yam_env  # noqa: E402

from detectors import SequenceTracker, Tracker  # noqa: E402

## Published Dream-1 price: $3/hour of action at 1.6 s of action per call -> 2250 calls/hour.
USD_PER_CALL = 3.0 / 2250

FREE_JOINTS = {"apple": "apple_free", "banana": "banana_free", "orange": "orange_free", "water_bottle": "bottle_free"}


def randomize(env, rng, jitter_m, objects):
    """Shift each named object's start xy by up to jitter_m (uniform), keeping z and orientation."""
    m = env.model
    for obj in objects:
        adr = m.jnt_qposadr[m.body_jntadr[m.body(obj).id]]
        env.data.qpos[adr : adr + 2] += rng.uniform(-jitter_m, jitter_m, size=2)
    import mujoco

    mujoco.mj_forward(env.model, env.data)


def capture(env, windows):
    """Render the three cameras into the model's JPEG windows; return the full-size RGB images."""
    return dc.capture(env, windows, keep=True)


class Recorder:
    """Collects the three camera views (what the model sees) as a labelled contact sheet per frame; saves a GIF.

    Frames are taken on the rows the model's cameras render anyway (every 4 rows = 0.2 s sim), so recording adds
    only the resize and compositing cost.
    """

    def __init__(self, path, width=240, every=2):
        self.path, self.width, self.every, self.frames, self.seen = Path(path), width, every, [], 0

    def add(self, images, label):
        from PIL import Image, ImageDraw

        self.seen += 1
        if (self.seen - 1) % self.every:
            return
        tiles = [Image.fromarray(images[n]) for n in ("left", "top", "right")]
        h = int(tiles[0].height * self.width / tiles[0].width)
        sheet = Image.new("RGB", (3 * self.width, h + 18), (20, 20, 20))
        for i, t in enumerate(tiles):
            sheet.paste(t.resize((self.width, h)), (i * self.width, 18))
        ImageDraw.Draw(sheet).text((4, 3), label, fill=(240, 240, 240))
        self.frames.append(sheet)

    def save(self, title):
        if not self.frames:
            return None
        from PIL import ImageDraw

        last = self.frames[-1].copy()
        ImageDraw.Draw(last).rectangle((0, 0, last.width, 17), fill=(20, 20, 20))
        ImageDraw.Draw(last).text((4, 3), title, fill=(255, 220, 80))
        self.frames.extend([last] * 5)  # hold the verdict for 2 s
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.frames[0].save(self.path, save_all=True, append_images=self.frames[1:], duration=200 * self.every, loop=0)
        return str(self.path)


class WrongObjectWatch:
    """Fires when an arm is holding a non-target object that has been moved (lifted >= 1.5 cm or slid >= 3 cm)
    while the target has not been lifted. A brush or bump does not fire; a grab does."""

    def __init__(self, env, target):
        from detectors import free_objects

        self.target = target
        self.others = [o for o in free_objects(env.model) if o != target]
        self.rebase(env)

    def rebase(self, env):
        self.start = {o: env.data.body(o).xpos.copy() for o in self.others}

    def check(self, env, tracker):
        from detectors import arm_touching

        if tracker.lifted_at is not None:
            return None
        for o in self.others:
            p = env.data.body(o).xpos
            moved = p - self.start[o]
            if (moved[2] >= 0.015 or np.linalg.norm(moved[:2]) >= 0.03) and arm_touching(env, o):
                return o
        return None


class GraspWatch:
    """Ace-style phase gate for Dream-1: fires when the current target has been touched for `stall_s` without a lift
    (a stalled grasp), or was lifted and then dropped back to rest untouched for `drop_s` while its goal is not met.

    Uses only ground truth the harness already has, so it is task-agnostic: on a sequence it watches the step in
    progress."""

    def __init__(self, env, stall_s=8.0, drop_s=2.0):
        self.stall_rows, self.drop_rows = int(stall_s * 20), int(drop_s * 20)
        self.rebase(env)

    def rebase(self, env):
        """Start a fresh attempt: contact/lift state is tracked per attempt, not per trial."""
        self.contact_row = None
        self.idle_rows = 0
        self.lift_run = 0
        self.lifted = False
        self.step_obj = None

    def check(self, env, tracker):
        from detectors import arm_touching, body_pos

        t = tracker._current() if hasattr(tracker, "_current") else tracker
        if t.goal_at is not None:
            return None
        if t.obj != self.step_obj:  # a sequence moved on to its next step
            self.rebase(env)
            self.step_obj = t.obj
        touched = bool(arm_touching(env, t.obj))
        height = body_pos(env, t.obj)[2] - t.rest_z
        if not self.lifted:
            if touched and self.contact_row is None:
                self.contact_row = t.row
            self.lift_run = self.lift_run + 1 if (touched and height >= 0.05) else 0
            self.lifted = self.lift_run >= 5
            if not self.lifted and self.contact_row is not None and t.row - self.contact_row >= self.stall_rows:
                return "grasp_stalled"
            return None
        # lifted in this attempt: watch for a drop back to the table, away from the goal
        resting = height < 0.01
        on_goal = t.goal is not None and t.goal(env, t.obj)
        self.idle_rows = self.idle_rows + 1 if (resting and not touched and not on_goal) else 0
        if self.idle_rows >= self.drop_rows:
            return "dropped"
        return None


ASSIST_MODES = {
    "assist": ("depth", "width", "backtrack"),
    "assist_adaptive": ("depth", "width", "backtrack", "adaptive"),
    "adaptive": ("adaptive",),
    "assist_place": ("depth", "width", "backtrack", "place"),
    "place_only": ("place",),
}


class _Skip(Exception):
    pass


def _clamp_gripper(reply, slack=0.2):
    """Dream-1 occasionally returns a gripper opening slightly outside 0..1 (seen: 1.055), which the stock
    validator rejects as a contract error. Clip small overshoots; leave larger ones for the validator to flag."""
    out = dict(reply)
    for k in ("q_l_chunk", "q_r_chunk"):
        a = np.array(reply[k], dtype=float, copy=True)
        if a.ndim == 2 and a.shape[1] == 7:
            g = a[:, 6]
            near = (g > -slack) & (g < 1 + slack)
            a[near, 6] = np.clip(g[near], 0.0, 1.0)
        out[k] = a
    return out


def run_trial(
    env,
    *,
    task,
    target,
    goal,
    model=dc.BETA_MODEL,
    actions=48,
    sim_seconds=40.0,
    seed=0,
    jitter_cm=0.0,
    stop_on_success=True,
    wall_timeout=600.0,
    key=None,
    trace=False,
    record=None,
    supervise=False,
    max_retries=2,
    retry_prompt=None,
    stall_s=8.0,
    sequence=None,
    scene="stock",
):
    """Run one trial and return a result dict (never raises for API/validation errors; they become outcome='error')."""
    config = dc.settings()
    key = key or config.get("DREAM_API_KEY", "")
    gateway = config.get("DREAM_GATEWAY_URL", "https://api.dreamlabs.ai")
    rng = np.random.default_rng(seed)
    env.reset()
    if sequence:
        sequence = [tuple(x.split(":", 1)) if isinstance(x, str) else tuple(x) for x in sequence]
        target = sequence[0][0]
    stepwise = supervise == "stepwise"
    if stepwise:
        supervise = False
    if scene == "hanoi":
        import hanoi

        target = hanoi.BLOCKS[0]
        if jitter_cm:  # shift the whole tower together (jittering blocks separately would topple it)
            off = rng.uniform(-jitter_cm / 100, jitter_cm / 100, size=2)
            for b in hanoi.BLOCKS:
                adr = env.model.jnt_qposadr[env.model.body_jntadr[env.model.body(b).id]]
                env.data.qpos[adr : adr + 2] += off
            import mujoco

            mujoco.mj_forward(env.model, env.data)
    elif jitter_cm:
        movers = sorted({o for o, _ in sequence}) if sequence else [target]
        if scene == "hold_fill":
            movers = ["cup", "red_tube"]
        randomize(env, rng, jitter_cm / 100, movers)

    windows = {name: deque(maxlen=dc.FRAMES) for name in dc.VIDEO_ROLES}
    steps = 0
    hold = env.state()
    while any(len(w) < dc.FRAMES for w in windows.values()):
        env.step(hold["left"], hold["right"])
        if steps % dc.FRAME_EVERY_STEPS == 0:
            capture(env, windows)
        steps += 1

    stats = None
    if scene == "hanoi":
        tracker = hanoi.HanoiTracker(env)
    elif scene == "hold_fill":
        import bimanual

        tracker = bimanual.HoldFillTracker(env)
    elif scene == "racks":
        import bimanual

        sequence = sequence or [(o, f"in:{c}") for o, c in bimanual.RACK_PAIRS]
        tracker = SequenceTracker(env, sequence, ordered=False)
        stats = bimanual.BimanualStats(env, [o for o, _ in sequence])
    else:
        tracker = SequenceTracker(env, sequence) if sequence else Tracker(env, target, goal)
    helper = None
    if supervise in ASSIST_MODES:
        import assist as assist_mod

        helper = assist_mod.Assist(env, tracker, parts=ASSIST_MODES[supervise], stall_s=stall_s)
    recorder = Recorder(record) if record else None
    if supervise in ASSIST_MODES:
        watch = None
    elif supervise == "grasp":
        watch = GraspWatch(env, stall_s=stall_s)
    elif supervise:
        watch = WrongObjectWatch(env, target)
    else:
        watch = None
    budget_rows = int(round(sim_seconds * 20))
    rtts, error, policy = [], None, None
    near_replies = [0]
    interventions = []
    rows_trace = []
    started = time.monotonic()
    poses = model in dc.POSE_MODELS
    prompt = task
    state = {"steps": steps}

    def advance(l, r):
        """One 50 ms row: physics, grading, camera windows, recording. Returns the rendered images or None."""
        env.step(l, r)
        tracker.update(env)
        if stats is not None:
            stats.update(env)
        if trace:
            from detectors import arm_touching
            st = env.state()
            tgt = tracker._current().obj if hasattr(tracker, "_current") else target
            rows_trace.append({
                "obj": env.data.body(tgt).xpos.round(4).tolist(),
                "cmd_grip": [round(float(l[6]), 3), round(float(r[6]), 3)],
                "grip": [round(float(st["left"][6]), 3), round(float(st["right"][6]), 3)],
                "tcp": [env.data.site("left_tcp").xpos.round(4).tolist(), env.data.site("right_tcp").xpos.round(4).tolist()],
                "touch": sorted(arm_touching(env, tgt)),
            })
        images = None
        if state["steps"] % dc.FRAME_EVERY_STEPS == 0:
            images = capture(env, windows)
            if recorder:
                tag = f"RETRY {len(interventions)}  " if interventions else ""
                recorder.add(
                    images,
                    f"t={tracker.row / 20:5.1f}s  reply {len(rtts)}  rows/reply {actions}  {tag}"
                    f"lift {100 * max(0.0, tracker.max_height):.1f}cm  "
                    f"{'LIFTED ' if tracker.lifted_at is not None else ''}{prompt}",
                )
        state["steps"] += 1
        return images

    def open_session():
        nonlocal policy, poses
        # DA-2000 NO_CAPACITY (pool full) is a transient server state, not a trial outcome: back off and retry.
        for wait in (5, 10, 20, 40, 60, 90, 0):
            try:
                policy = dc.open_policy(dc.policy_config(model, gateway, poses), key)
                break
            except Exception as exc:
                if "NO_CAPACITY" not in str(exc) or not wait:
                    raise
                time.sleep(wait)
        dc.feed(policy, env, windows, prompt, model, state["steps"], every=0, station=poses)

    if model == "oracle":
        import oracle

        if scene in ("racks", "hold_fill"):
            import bimanual

            bot, rows = bimanual.oracle_plan(env, scene)
        else:
            steps = hanoi.oracle_steps() if scene == "hanoi" else (sequence or [(target, goal)])
            bot, rows = oracle.plan(env, steps)
        try:
            for l, r in rows:
                advance(l, r)
                if (stop_on_success and tracker.success) or tracker.row >= budget_rows:
                    break
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"[:300]
        interventions = bot.events
        policy = "oracle"
    try:
        if policy == "oracle":
            raise _Skip
        open_session()
        restarts = 0
        busy_waits = 0
        done = False
        while not done and tracker.row < budget_rows:
            if time.monotonic() - started > wall_timeout:
                error = "wall_timeout"
                break
            if stepwise:
                nxt = tracker.next_prompt()
                if nxt and nxt != prompt:
                    # planner: the last move landed (or a different one did) -> instruct the next move from the
                    # settled configuration, in a fresh session so the new instruction starts clean
                    prompt = nxt
                    interventions.append({"row": tracker.row, "reason": "next_move", "prompt": prompt})
                    policy.close()
                    policy = None
                    open_session()
            t0 = time.monotonic()
            try:
                reply = policy.get_action()
            except Exception as exc:  # mirror the stock runner's two recoveries
                if type(exc).__name__ == "DreamSessionExpired" and restarts < 3:
                    restarts += 1
                    continue
                if "NO_CAPACITY" in str(exc) and busy_waits < 8:
                    # Pool full: physics is paused between replies anyway, so waiting does not change the trial.
                    busy_waits += 1
                    time.sleep(min(60, 5 * 2**busy_waits))
                    continue
                if not poses and dc.needs_poses(exc):
                    policy.close()
                    poses = True
                    open_session()
                    continue
                raise
            restarts = 0
            rtts.append(time.monotonic() - t0)
            reply = _clamp_gripper(reply)
            left, right = dc.validate_chunk(env, reply, actions, verbose=False)
            run_rows = actions
            if helper is not None and helper.near():
                run_rows = min(actions, helper.near_rows)
                near_replies[0] += 1
            for l, r in zip(left[:run_rows], right[:run_rows]):
                if helper is not None:
                    l, r = helper.filter(l, r)
                images = advance(l, r)
                if helper is not None:
                    helper.after()
                    act = helper.take()
                    if act is not None:
                        reason, rows, reopen = act
                        if images is not None:
                            dc.feed(policy, env, windows, prompt, model, state["steps"] - 1, station=poses)
                        for hl, hr in rows:
                            images = advance(hl, hr)
                            if images is not None and not reopen:
                                dc.feed(policy, env, windows, prompt, model, state["steps"] - 1, station=poses)
                            if (stop_on_success and tracker.success) or tracker.row >= budget_rows:
                                break
                        if reopen and tracker.row < budget_rows:
                            policy.close()
                            policy = None
                            open_session()
                        if (stop_on_success and tracker.success) or tracker.row >= budget_rows:
                            done = True
                        break
                if images is not None:
                    dc.feed(policy, env, windows, prompt, model, state["steps"] - 1, station=poses)
                if (stop_on_success and tracker.success) or tracker.row >= budget_rows:
                    done = True
                    break
                grabbed = watch.check(env, tracker) if watch else None
                if grabbed and len(interventions) < max_retries:
                    # Supervisor: wrong object in hand. Abandon the chunk, end the session, drive the arms home
                    # (grippers open, so the object is released), then start a fresh session.
                    reason = grabbed if supervise == "grasp" else "wrong_object"
                    interventions.append({"row": tracker.row, "reason": reason,
                                          **({} if supervise == "grasp" else {"object": grabbed})})
                    policy.close()
                    policy = None
                    for hl, hr in yam_env.home_path(env.state(), seconds=2.0):
                        advance(hl, hr)
                        if tracker.row >= budget_rows:
                            break
                    watch.rebase(env)
                    if retry_prompt:
                        prompt = retry_prompt
                    if tracker.row < budget_rows:
                        open_session()
                    else:
                        done = True
                    break
    except _Skip:
        policy = None
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"[:300]
    finally:
        if policy is not None:
            try:
                policy.close()
            except Exception:
                pass

    if helper is not None:
        interventions = helper.events
    if stepwise:
        supervise = "stepwise"
    result = {
        "task": task,
        "scene": scene,
        "target": target,
        "goal": goal,
        "model": model,
        "actions": actions,
        "sim_seconds": sim_seconds,
        "seed": seed,
        "jitter_cm": jitter_cm,
        **tracker.summary(env),
        **(stats.summary() if stats is not None else {}),
        "calls": len(rtts),
        "median_rtt_s": round(float(np.median(rtts)), 3) if rtts else None,
        "wall_s": round(time.monotonic() - started, 1),
        "est_cost_usd": round(len(rtts) * USD_PER_CALL, 4),
        "error": error,
        "supervised": supervise,
        "short_replies": near_replies[0],
        "retries": sum(1 for i in interventions if (i.get("reason") not in (None, "latch_release")) or i.get("phase") == "grasp_failed"),
        "interventions": interventions,
    }
    if error:
        result["outcome"] = "error"
        result["success"] = False
    if trace:
        result["trace"] = rows_trace
    if recorder:
        result["recording"] = recorder.save(
            f"{result['outcome'].upper()}  lift {result['max_lift_cm']}cm  bowl dist {result['final_bowl_dist_cm']}cm"
            f"  seed {seed}  {task}"
        )
    return result


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description="Run one headless Dream-1 trial and print the verdict.")
    p.add_argument("--task", default="put orange into the bowl")
    p.add_argument("--target", default="orange")
    p.add_argument("--goal", default="inside_bowl")
    p.add_argument("--actions", type=int, default=48)
    p.add_argument("--sim-seconds", type=float, default=40)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--jitter-cm", type=float, default=0)
    p.add_argument("--record", help="save a GIF of the three camera views here")
    p.add_argument("--supervise", nargs="?", const="wrong_object", default=False, choices=["wrong_object", "grasp", "assist", "assist_adaptive", "adaptive", "assist_place", "place_only", "stepwise"],
                   help="home and re-prompt after a wrong-object grab, or (grasp) after a stalled grasp / drop")
    p.add_argument("--model", default=dc.BETA_MODEL, help="Dream model id, or 'oracle' for the scripted controller")
    p.add_argument("--max-retries", type=int, default=2)
    p.add_argument("--retry-prompt")
    p.add_argument("--scene", default="stock")
    p.add_argument("--sequence", help="ordered steps, e.g. apple:inside_bowl,orange:inside_bowl")
    a = p.parse_args()
    import scenes

    env = scenes.make_env(a.scene)
    try:
        r = run_trial(
            env,
            task=a.task,
            target=a.target,
            goal=a.goal,
            actions=a.actions,
            sim_seconds=a.sim_seconds,
            seed=a.seed,
            jitter_cm=a.jitter_cm,
            record=a.record,
            supervise=a.supervise,
            model=a.model,
            max_retries=a.max_retries,
            retry_prompt=a.retry_prompt,
            scene=a.scene,
            sequence=a.sequence.split(",") if a.sequence else None,
        )
        print(json.dumps(r, indent=2))
    finally:
        env.close()
