"""Headless Dream-1 trial runner on the stock Dream YAM Sim.

Mirrors dream_control.main()'s request/validate/step loop, with three changes for evaluation:
- the budget is simulated seconds (physics pauses during inference anyway), not wall-clock;
- no viewer and no real-time pacing; cameras render only on the rows the model sees;
- a detectors.Tracker grades every row and can stop the trial at verified success.
"""

import json
import hashlib
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

from detectors import OrderedPlanTracker, SequenceTracker, Tracker  # noqa: E402
from dream_harness import GraspWatch, HarnessConfig, RetryPolicy, build_watches, clamp_gripper, open_waits  # noqa: E402

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


class VideoRecorder:
    """Records the three model cameras as an H.264 MP4 at 40 fps of simulated time.

    Each 50 ms control row is split in half so two frames are rendered per row. Frames are encoded as they
    arrive, so a long trial never holds its whole video in memory. Layout: overhead camera on the left
    (960x540), left wrist above right wrist on the right (480x270 each).
    """

    FPS = 40
    TOP, WRIST = (960, 540), (480, 270)

    def __init__(self, path, env):
        import mujoco

        self.path, self.env, self.mujoco = Path(path), env, mujoco
        vis = env.model.vis.global_
        # The policy cameras crop a 4:3 render to 16:9; render 4:3 at the larger size and crop the same way.
        vis.offwidth, vis.offheight = max(vis.offwidth, 960), max(vis.offheight, 720)
        self.renderer_top = mujoco.Renderer(env.model, height=720, width=960)
        self.renderer_wrist = mujoco.Renderer(env.model, height=360, width=480)
        self.container = self.stream = None
        self.frames = 0

    def render(self):
        top = self._camera(self.renderer_top, "top", 90)
        left = self._camera(self.renderer_wrist, "left", 45)
        right = self._camera(self.renderer_wrist, "right", 45)
        frame = np.empty((540, 1440, 3), dtype=np.uint8)
        frame[:, :960] = top
        frame[:270, 960:] = left
        frame[270:, 960:] = right
        frame[:, 958:962] = 12  # divider between the overhead and wrist views
        frame[268:272, 960:] = 12
        self._encode(frame)

    def _camera(self, renderer, name, crop):
        renderer.update_scene(self.env.data, camera=name)
        image = renderer.render()
        return image[crop:image.shape[0] - crop]

    def _encode(self, frame):
        import av

        if self.container is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.container = av.open(str(self.path), "w", options={"movflags": "faststart"})
            self.stream = self.container.add_stream("libx264", rate=self.FPS)
            self.stream.width, self.stream.height = frame.shape[1], frame.shape[0]
            self.stream.pix_fmt = "yuv420p"
            self.stream.options = {"crf": "23", "preset": "veryfast"}
        video_frame = av.VideoFrame.from_ndarray(frame, format="rgb24")
        for packet in self.stream.encode(video_frame):
            self.container.mux(packet)
        self.frames += 1

    def step(self, left, right):
        """Run one control row through env.step, rendering one frame halfway and one at the end."""
        real = self.mujoco
        recorder = self

        class HalfwayFrame:
            def __getattr__(self, name):
                return getattr(real, name)

            def mj_step(self, model, data, nstep=1):
                first = nstep // 2
                real.mj_step(model, data, nstep=first)
                real.mj_kinematics(model, data)
                recorder.render()
                real.mj_step(model, data, nstep=nstep - first)

        yam_env.mujoco = HalfwayFrame()
        try:
            self.env.step(left, right)
        finally:
            yam_env.mujoco = real
        self.render()

    def save(self, title=None):
        if self.container is None:
            self._close_renderers()
            return None
        for packet in self.stream.encode():
            self.container.mux(packet)
        self.container.close()
        self._close_renderers()
        return str(self.path)

    def _close_renderers(self):
        self.renderer_top.close()
        self.renderer_wrist.close()


ASSIST_MODES = {
    "assist": ("depth", "width", "backtrack"),
    "assist_adaptive": ("depth", "width", "backtrack", "adaptive"),
    "adaptive": ("adaptive",),
    "assist_place": ("depth", "width", "backtrack", "place"),
    "place_only": ("place",),
}


class _Skip(Exception):
    pass


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
    max_retries=None,
    retry_prompt=None,
    stall_s=None,
    sequence=None,
    scene="stock",
    before_request=None,
    max_usd=None,
    ordered_plan=None,
    checkpoint=None,
    on_event=None,
    on_sample=None,
    normalize_gripper=True,
    assist_parts=None,
    watches=None,
    recover=False,
    harness=None,
):
    """Run one trial and return a result dict (never raises for API/validation errors; they become outcome='error').

    Spotter modules can also be switched on one by one: `assist_parts` (any of depth, width, backtrack, place,
    adaptive), `watches` (any of "grasp", "wrong_object"), and `recover`, which keeps the network and capacity
    retries on even when a console `checkpoint` is set.

    `harness` (a dream_harness.HarnessConfig or its dict form) replaces those four arguments with one module list and
    supplies every tunable value; without it the library's static HarnessSettings defaults apply."""
    if harness is not None:
        if not isinstance(harness, HarnessConfig):
            harness = HarnessConfig.from_dict(harness)
        assist_parts, watches = harness.assist_parts, harness.watches
        recover, normalize_gripper = harness.recover, harness.clamp_gripper
    else:
        harness = HarnessConfig.from_dict({})
    if stall_s is not None:
        harness.values["STALL_S"] = float(stall_s)
    if max_retries is None:
        max_retries = harness.MAX_SUPERVISOR_RETRIES
    retry_prompt = retry_prompt or harness.RETRY_PROMPT or None
    if max_usd is not None and (not np.isfinite(max_usd) or max_usd < 0):
        raise ValueError("--max-usd must be finite and nonnegative")
    config = {} if model == "oracle" else dc.settings()
    key = key or config.get("DREAM_API_KEY", "")
    gateway = config.get("DREAM_GATEWAY_URL", "https://api.dreamlabs.ai")
    rng = np.random.default_rng(seed)
    if ordered_plan and (scene != "stock" or supervise or sequence):
        raise ValueError("Ordered plans require an unassisted stock scene.")
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
        if ordered_plan:
            movers = sorted({step["target"] for step in ordered_plan})
        if scene == "hold_fill":
            movers = ["cup", "red_tube"]
        randomize(env, rng, jitter_cm / 100, movers)

    def emit(kind, **detail):
        if on_event:
            on_event(kind, **detail)

    initial_state_fingerprint = hashlib.sha256(env.data.qpos.tobytes() + env.data.qvel.tobytes()).hexdigest()
    windows = {name: deque(maxlen=dc.FRAMES) for name in dc.VIDEO_ROLES}
    steps = 0
    hold = env.state()
    while any(len(w) < dc.FRAMES for w in windows.values()):
        if checkpoint:
            checkpoint()
        env.step(hold["left"], hold["right"])
        if steps % dc.FRAME_EVERY_STEPS == 0:
            capture(env, windows)
        steps += 1

    stats = None
    if ordered_plan:
        tracker = OrderedPlanTracker(env, ordered_plan, emit)
    elif scene == "hanoi":
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
    parts = ASSIST_MODES[supervise] if supervise in ASSIST_MODES else tuple(assist_parts or ())
    if parts:
        from dream_harness import assist as assist_mod

        helper = assist_mod.Assist(env, tracker, parts=parts, config=harness)
    video = VideoRecorder(record, env) if record and str(record).lower().endswith(".mp4") else None
    recorder = Recorder(record) if record and not video else None
    watch_names = list(watches or ())
    if supervise == "grasp":
        watch_names.append("grasp")
    elif supervise and supervise not in ASSIST_MODES:
        watch_names.append("wrong_object")
    watch_list = build_watches(env, target, watch_names, harness)
    budget_rows = int(round(sim_seconds * 20))
    rtts, error, policy = [], None, None
    request_attempts, timeout_count = 0, 0
    retries = RetryPolicy(harness)
    first_response_s = None
    near_replies = [0]
    interventions = []
    rows_trace = []
    started = time.monotonic()
    poses = model in dc.POSE_MODELS
    prompt = tracker.step["instruction"] if ordered_plan else task
    state = {"steps": steps}

    def advance(l, r):
        """One 50 ms row: physics, grading, camera windows, recording. Returns the rendered images or None."""
        if checkpoint:
            checkpoint(tracker.row / 20)
        if on_sample:
            # Training data is exported at 10 Hz, so cameras are rendered on even rows only (rendering dominates cost).
            cameras = None
            if tracker.row % 2 == 0:
                sample_windows = {name: deque(maxlen=1) for name in dc.VIDEO_ROLES}
                capture(env, sample_windows)
                cameras = {name: frames[-1] for name, frames in sample_windows.items()}
            on_sample(tracker.row, tracker.step["id"] if ordered_plan else None, prompt, env.state(), l, r, cameras)
        if video:
            video.step(l, r)
        else:
            env.step(l, r)
        if ordered_plan and (not np.isfinite(env.data.qpos).all() or not np.isfinite(env.data.qvel).all()):
            raise RuntimeError("Invalid numeric simulator state.")
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
        for wait in open_waits(recover or not checkpoint):
            try:
                if checkpoint:
                    checkpoint()
                policy = dc.open_policy(dc.policy_config(model, gateway, poses), key)
                break
            except Exception as exc:
                if "NO_CAPACITY" not in str(exc) or not wait:
                    raise
                time.sleep(wait)
        dc.feed(policy, env, windows, prompt, model, state["steps"], every=0, station=poses)

    if model == "oracle":
        import oracle

        if ordered_plan:
            bot = oracle.Oracle(env)

            def ordered_rows():
                while not tracker.done:
                    step = tracker.step
                    for left, right in bot.plan([(step["target"], step["goal"])]):
                        yield left, right
                        if tracker.done or tracker.step is not step:
                            break

            rows = ordered_rows()
        elif scene in ("racks", "hold_fill"):
            import bimanual

            bot, rows = bimanual.oracle_plan(env, scene)
        else:
            steps = hanoi.oracle_steps() if scene == "hanoi" else (sequence or [(target, goal)])
            bot, rows = oracle.plan(env, steps)
        try:
            for l, r in rows:
                if ordered_plan:
                    prompt = tracker.step["instruction"]
                advance(l, r)
                if (ordered_plan and tracker.done) or (stop_on_success and tracker.success) or tracker.row >= budget_rows:
                    break
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
        interventions = bot.events
        policy = "oracle"
    try:
        if policy == "oracle":
            raise _Skip
        open_session()
        done = False
        while not done and tracker.row < budget_rows:
            if time.monotonic() - started > wall_timeout:
                error = "wall_timeout"
                break
            if ordered_plan and tracker.step["instruction"] != prompt:
                prompt = tracker.step["instruction"]
                policy.close()
                policy = None
                capture(env, windows)
                open_session()
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
            if max_usd is not None and (request_attempts + 1) * USD_PER_CALL > max_usd:
                raise RuntimeError("BUDGET_STOPPED: estimated USD cap reached")
            if before_request is not None:
                before_request()
            request_attempts += 1
            t0 = time.monotonic()
            if on_event:
                emit("request_started", sim_s=tracker.row / 20, attempted=request_attempts)
            try:
                reply = policy.get_action()
            except Exception as exc:  # mirror the stock runner's two recoveries
                if isinstance(exc, TimeoutError) or "timeout" in type(exc).__name__.lower():
                    timeout_count += 1
                if checkpoint and not recover:
                    raise
                if not poses and dc.needs_poses(exc):
                    policy.close()
                    poses = True
                    open_session()
                    continue
                wait = retries.decide(exc)
                if wait is None:
                    raise
                time.sleep(wait)
                continue
            retries.succeeded()
            if normalize_gripper:
                reply = clamp_gripper(reply, harness.GRIPPER_SLACK)
            left, right = dc.validate_chunk(env, reply, actions, verbose=False)
            rtts.append(time.monotonic() - t0)
            if first_response_s is None:
                first_response_s = rtts[0]
            if on_event:
                emit("request_completed", sim_s=tracker.row / 20, completed=len(rtts),
                     latency_s=round(rtts[-1], 3))
            run_rows = actions
            if helper is not None and helper.near():
                run_rows = min(actions, helper.near_rows)
                near_replies[0] += 1
            for l, r in zip(left[:run_rows], right[:run_rows]):
                if helper is not None:
                    l, r = helper.filter(l, r)
                images = advance(l, r)
                if ordered_plan and (tracker.done or tracker.step["instruction"] != prompt):
                    done = tracker.done
                    break
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
                grabbed, fired = None, None
                for w in watch_list:
                    grabbed = w.check(env, tracker)
                    if grabbed:
                        fired = w
                        break
                if grabbed and len(interventions) < max_retries:
                    # Supervisor: wrong object in hand or a stalled/dropped grasp. Abandon the chunk, end the
                    # session, drive the arms home (grippers open, so the object is released), then start fresh.
                    if isinstance(fired, GraspWatch):
                        interventions.append({"row": tracker.row, "reason": grabbed})
                    else:
                        interventions.append({"row": tracker.row, "reason": "wrong_object", "object": grabbed})
                    policy.close()
                    policy = None
                    for hl, hr in yam_env.home_path(env.state(), seconds=harness.HOME_SECONDS):
                        advance(hl, hr)
                        if tracker.row >= budget_rows:
                            break
                    for w in watch_list:
                        w.rebase(env)
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
        error = f"{type(exc).__name__}: {exc}"
    finally:
        if policy is not None:
            try:
                policy.close()
            except Exception:
                pass

    if error and key:
        error = error.replace(key, "[redacted]")
        # A truncated SDK error may contain only the beginning of the credential.
        if len(key) >= 8 and key[:8] in error:
            error = error.split(key[:8], 1)[0] + "[redacted]"
    if helper is not None:
        interventions = interventions + helper.events
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
        "request_attempts": request_attempts,
        "request_errors": request_attempts - len(rtts),
        "network_retries": retries.network_retries,
        "timeout_count": timeout_count,
        "first_response_s": round(first_response_s, 3) if first_response_s is not None else None,
        "slowest_rtt_s": round(max(rtts), 3) if rtts else None,
        "p95_rtt_s": round(float(np.percentile(rtts, 95)), 3) if len(rtts) >= 20 else None,
        "median_rtt_s": round(float(np.median(rtts)), 3) if rtts else None,
        "wall_s": round(time.monotonic() - started, 1),
        "est_cost_usd": round(len(rtts) * USD_PER_CALL, 4),
        "error": error,
        "supervised": supervise,
        "spotter": {"assist": list(assist_parts or ()), "watches": list(watches or ()), "recover": recover,
                    "clamp_gripper": normalize_gripper, "harness": harness.to_dict()},
        "short_replies": near_replies[0],
        "retries": sum(1 for i in interventions if (i.get("reason") not in (None, "latch_release")) or i.get("phase") == "grasp_failed"),
        "interventions": interventions,
    }
    if error:
        result["outcome"] = "error"
        result["success"] = False
    # Anything that used simulator ground truth to steer the robot. Ground truth may grade a trial, never drive it.
    steering = []
    if model == "oracle":
        steering.append("scripted teacher reads simulator object positions")
    if supervise:
        steering.append(f"supervisor or assist: {supervise}")
    if assist_parts:
        steering.append(f"spotter assist: {', '.join(assist_parts)}")
    if watches:
        steering.append(f"spotter watch: {', '.join(watches)}")
    if ordered_plan:
        steering.append("instruction switched when the simulator confirmed a step")
    result["steering"] = steering
    result["clean"] = not steering
    result["initial_state_fingerprint"] = initial_state_fingerprint
    if video:
        try:
            result["recording"] = video.save()
            result["recording_fps"] = VideoRecorder.FPS
        except (OSError, ValueError):
            result["recording_error"] = "Could not save the camera replay."
    if recorder:
        try:
            result["recording"] = recorder.save(
                f"{result['outcome'].upper()}  lift {result['max_lift_cm']}cm  bowl dist {result['final_bowl_dist_cm']}cm"
                f"  seed {seed}  {task}"
            )
        except (OSError, ValueError):
            result["recording_error"] = "Could not save the camera replay."
    if trace:
        result["trace"] = rows_trace
    return result


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description="Run one headless Dream-1 trial and print the verdict.")
    p.add_argument("--task", default="put orange into the bowl")
    p.add_argument("--target", default="orange")
    p.add_argument("--goal", default="inside_bowl")
    p.add_argument("--actions", type=int, default=48)
    p.add_argument("--sim-seconds", type=float, default=40)
    p.add_argument("--max-usd", type=float, help="Estimated USD ceiling for attempted action requests in this trial")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--jitter-cm", type=float, default=0)
    p.add_argument("--record", help="save a GIF of the three camera views here")
    p.add_argument("--supervise", nargs="?", const="wrong_object", default=False, choices=["wrong_object", "grasp", "assist", "assist_adaptive", "adaptive", "assist_place", "place_only", "stepwise"],
                   help="home and re-prompt after a wrong-object grab, or (grasp) after a stalled grasp / drop")
    p.add_argument("--model", default=dc.BETA_MODEL, help="Dream model id, or 'oracle' for the scripted controller")
    p.add_argument("--max-retries", type=int)
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
            max_usd=a.max_usd,
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
