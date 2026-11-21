"""Probe: once a chunk is predicted to take a gripper to the apple, can we redirect Dream-1 to the orange?

Run normally (24 rows/reply) until forward kinematics says a chunk ends with a gripper within 6 cm of the apple.
Save the full simulator state there, then branch from that identical state:
  control     fresh session, nothing changed
  hold_arm    the offending arm is held still (gripper open); only the other arm's rows are executed
  cover_apple the apple is hidden in every camera image Dream-1 receives (physics unchanged)
  both        hold_arm + cover_apple
Every branch first holds both arms still for 1.8 s so all 9 frames of each camera window are rendered
under that branch's view, then opens a fresh session and runs 15 s (or until the orange is lifted).

Usage: python probe_redirect.py 5 210 215
"""

import base64
import io
import json
import sys
import warnings
from collections import deque

import mujoco
import numpy as np
from PIL import Image

warnings.filterwarnings("ignore")
import runner  # noqa: E402
import dream_control as dc  # noqa: E402
import yam_env  # noqa: E402
from detectors import Tracker, arm_touching  # noqa: E402

SIDES = ("left", "right")
ACTIONS = 24
TASK = "put orange into the bowl"
NEAR = 0.06


class Cameras:
    """Renders the model's three views, optionally with the apple hidden (geom group 5 switched off)."""

    def __init__(self, env):
        self.env = env
        self.renderer = mujoco.Renderer(env.model, height=480, width=640)
        apple = env.model.body("apple").id
        self.apple_geoms = [g for g in range(env.model.ngeom) if env.model.geom_bodyid[g] == apple]
        self.groups = env.model.geom_group[self.apple_geoms].copy()

    def capture(self, windows, hide_apple):
        m = self.env.model
        opt = mujoco.MjvOption()
        if hide_apple:
            m.geom_group[self.apple_geoms] = 5
            opt.geomgroup[5] = 0
        try:
            for name in ("top", "left", "right"):
                self.renderer.update_scene(self.env.data, camera=name, scene_option=opt)
                rgb = self.renderer.render()[60:420]
                buf = io.BytesIO()
                Image.fromarray(rgb).resize(dc.FRAME_SIZE, Image.BILINEAR).save(buf, format="JPEG", quality=85)
                windows[name].append(base64.b64encode(buf.getvalue()).decode("ascii"))
        finally:
            m.geom_group[self.apple_geoms] = self.groups


def chunk_targets(env, scratch, left, right):
    """Where each gripper ends after the executed rows: distance (cm) to apple and orange."""
    scratch.qpos[:] = env.data.qpos
    for side, row in zip(SIDES, (left[ACTIONS - 1], right[ACTIONS - 1])):
        for i in range(6):
            scratch.joint(f"{side}_joint{i + 1}").qpos[0] = row[i]
    mujoco.mj_kinematics(env.model, scratch)
    out = {}
    for s in SIDES:
        tcp = scratch.site(f"{s}_tcp").xpos
        out[s] = {o: round(100 * float(np.linalg.norm(tcp - env.data.body(o).xpos)), 1) for o in ("apple", "orange")}
    return out


def open_session(windows, steps, cfg):
    return dc.open_policy(
        dc.policy_config(dc.BETA_MODEL, cfg.get("DREAM_GATEWAY_URL", "https://api.dreamlabs.ai"), True),
        cfg["DREAM_API_KEY"],
    )


def feed(policy, env, windows, steps, every=1):
    dc.feed(policy, env, windows, TASK, dc.BETA_MODEL, steps, every=every, station=True)


def warm_until_flag(env, cams, scratch, seed, cfg, max_rows=500):
    """Normal run until a chunk is predicted to reach the apple. Returns (state, steps, offending side, rows) or None."""
    rng = np.random.default_rng(seed)
    env.reset()
    runner.randomize(env, rng, 0.02, ["orange"])
    windows = {n: deque(maxlen=dc.FRAMES) for n in dc.VIDEO_ROLES}
    steps = 0
    hold = env.state()
    while any(len(w) < dc.FRAMES for w in windows.values()):
        env.step(hold["left"], hold["right"])
        if steps % dc.FRAME_EVERY_STEPS == 0:
            cams.capture(windows, False)
        steps += 1
    policy = open_session(windows, steps, cfg)
    feed(policy, env, windows, steps, every=0)
    rows = 0
    try:
        while rows < max_rows:
            left, right = dc.validate_chunk(env, policy.get_action(), ACTIONS, verbose=False)
            ends = chunk_targets(env, scratch, left, right)
            bad = [s for s in SIDES if ends[s]["apple"] < 100 * NEAR and ends[s]["apple"] < ends[s]["orange"]]
            if bad and not arm_touching(env, "orange"):
                spec = mujoco.mjtState.mjSTATE_INTEGRATION
                state = np.empty(mujoco.mj_stateSize(env.model, spec))
                mujoco.mj_getState(env.model, env.data, state, spec)
                return state, steps, bad[0], rows, ends
            for l, r in zip(left, right):
                env.step(l, r)
                if steps % dc.FRAME_EVERY_STEPS == 0:
                    cams.capture(windows, False)
                    feed(policy, env, windows, steps)
                steps += 1
                rows += 1
                if arm_touching(env, "orange"):
                    return None
        return None
    finally:
        policy.close()


def branch(env, cams, scratch, saved, steps0, side, cfg, hold_arm, cover, rows=300):
    spec = mujoco.mjtState.mjSTATE_INTEGRATION
    mujoco.mj_setState(env.model, env.data, saved, spec)
    mujoco.mj_forward(env.model, env.data)
    held = env.state()
    held[side] = held[side].copy()
    held[side][6] = 1.0  # held arm's gripper open
    windows = {n: deque(maxlen=dc.FRAMES) for n in dc.VIDEO_ROLES}
    steps = steps0
    for _ in range(dc.FRAMES * dc.FRAME_EVERY_STEPS):  # 1.8 s still, frames rendered under this branch's view
        st = env.state()
        env.step(held["left"] if (hold_arm and side == "left") else st["left"],
                 held["right"] if (hold_arm and side == "right") else st["right"])
        if steps % dc.FRAME_EVERY_STEPS == 0:
            cams.capture(windows, cover)
        steps += 1
    tracker = Tracker(env, "orange", "inside_bowl")
    first = None
    intents = []
    policy = open_session(windows, steps, cfg)
    feed(policy, env, windows, steps, every=0)
    try:
        while tracker.row < rows and tracker.lifted_at is None:
            left, right = dc.validate_chunk(env, policy.get_action(), ACTIONS, verbose=False)
            ends = chunk_targets(env, scratch, left, right)
            intents.append({s: min(ends[s], key=ends[s].get) if min(ends[s].values()) < 8 else "-" for s in SIDES})
            for l, r in zip(left, right):
                if hold_arm:
                    l, r = (held["left"], r) if side == "left" else (l, held["right"])
                env.step(l, r)
                tracker.update(env)
                if first is None:
                    for o in ("orange", "apple"):
                        who = arm_touching(env, o)
                        if who:
                            first = f"{o} ({'/'.join(sorted(who))} arm) at {tracker.row / 20:.1f}s"
                            break
                if steps % dc.FRAME_EVERY_STEPS == 0:
                    cams.capture(windows, cover)
                    feed(policy, env, windows, steps)
                steps += 1
                if tracker.row >= rows or tracker.lifted_at is not None:
                    break
    finally:
        policy.close()
    return {
        "first_touch": first or "nothing",
        "orange_lifted": tracker.lifted_at is not None,
        "orange_max_lift_cm": round(100 * tracker.max_height, 1),
        "chunk_intents": " ".join(f"{i['left'][0]}{i['right'][0]}" for i in intents),
        "calls": len(intents),
    }


def main(seeds):
    env = yam_env.YamEnv()
    cams = Cameras(env)
    scratch = mujoco.MjData(env.model)
    cfg = dc.settings()
    results = []
    for seed in seeds:
        flagged = warm_until_flag(env, cams, scratch, seed, cfg)
        if flagged is None:
            print(f"seed {seed}: never headed for the apple this run (or reached the orange first); skipped", flush=True)
            continue
        saved, steps, side, rows, ends = flagged
        print(f"\nseed {seed}: flagged at {rows / 20:.1f}s, {side} gripper heading to apple ({ends[side]}) ", flush=True)
        for name, hold_arm, cover in [("control", False, False), ("hold_arm", True, False),
                                      ("cover_apple", False, True), ("both", True, True)]:
            r = branch(env, cams, scratch, saved, steps, side, cfg, hold_arm, cover)
            r.update(seed=seed, branch=name, side=side, flagged_s=rows / 20)
            results.append(r)
            print(f"  {name:<12} first touch: {r['first_touch']:<34} orange lifted: {r['orange_lifted']!s:<5} "
                  f"intents(L R per chunk; a=apple o=orange -=neither): {r['chunk_intents']}", flush=True)
    with open("runs/probe_redirect.jsonl", "a") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")
    env.close()


if __name__ == "__main__":
    main([int(s) for s in sys.argv[1:]] or [5])
