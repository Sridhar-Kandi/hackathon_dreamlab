"""Probe: at a fixed simulator state, ask Dream-1 for a chunk several times without stepping. Do the chunks differ,
and where would each one put the grippers (forward kinematics of the last row)?"""

import sys
import warnings
from collections import deque

import mujoco
import numpy as np

warnings.filterwarnings("ignore")
import runner  # noqa: E402  (sets up the example path)
import dream_control as dc  # noqa: E402
import yam_env  # noqa: E402

SIDES = ("left", "right")


def tcp_after(env, scratch, left_row, right_row):
    """Gripper (TCP) positions if the arms reached these joint targets: kinematics only, no physics."""
    scratch.qpos[:] = env.data.qpos
    for side, row in zip(SIDES, (left_row, right_row)):
        for i in range(6):
            scratch.joint(f"{side}_joint{i + 1}").qpos[0] = row[i]
    mujoco.mj_kinematics(env.model, scratch)
    return {s: scratch.site(f"{s}_tcp").xpos.copy() for s in SIDES}


def main(seed=5, warm_rows=int(sys.argv[1]) if len(sys.argv) > 1 else 120, asks=4, actions=24):
    env = yam_env.YamEnv()
    scratch = mujoco.MjData(env.model)
    cfg = dc.settings()
    rng = np.random.default_rng(seed)
    env.reset()
    runner.randomize(env, rng, 0.02, ["orange"])
    windows = {n: deque(maxlen=dc.FRAMES) for n in dc.VIDEO_ROLES}
    steps = 0
    hold = env.state()
    while any(len(w) < dc.FRAMES for w in windows.values()):
        env.step(hold["left"], hold["right"])
        if steps % dc.FRAME_EVERY_STEPS == 0:
            dc.capture(env, windows)
        steps += 1
    task = "put orange into the bowl"
    policy = dc.open_policy(dc.policy_config(dc.BETA_MODEL, cfg.get("DREAM_GATEWAY_URL", "https://api.dreamlabs.ai"), True), cfg["DREAM_API_KEY"])
    dc.feed(policy, env, windows, task, dc.BETA_MODEL, steps, every=0, station=True)
    rows = 0
    while rows < warm_rows:  # run normally for a while so the arms are mid-approach
        reply = policy.get_action()
        left, right = dc.validate_chunk(env, reply, actions, verbose=False)
        for l, r in zip(left, right):
            env.step(l, r)
            if steps % dc.FRAME_EVERY_STEPS == 0:
                dc.capture(env, windows)
                dc.feed(policy, env, windows, task, dc.BETA_MODEL, steps, station=True)
            steps += 1
            rows += 1
            last = {"q_l_chunk": l, "q_r_chunk": r}
    objs = {o: env.data.body(o).xpos.copy() for o in ("orange", "apple")}
    print(f"after {rows} rows; orange {objs['orange'].round(3)} apple {objs['apple'].round(3)}")
    chunks = []
    for k in range(asks):
        reply = policy.get_action(commanded=last)
        left, right = dc.validate_chunk(env, reply, 48, verbose=False)
        chunks.append((left, right))
        end = tcp_after(env, scratch, left[actions - 1], right[actions - 1])
        d = {s: {o: round(100 * float(np.linalg.norm(end[s] - p)), 1) for o, p in objs.items()} for s in SIDES}
        print(f"ask {k}: TCP at row {actions}: left->{d['left']} right->{d['right']} cm")
    base = chunks[0]
    for k, (l, r) in enumerate(chunks[1:], 1):
        print(f"ask {k} vs ask 0: max joint diff left {np.abs(l - base[0]).max():.3f} rad, right {np.abs(r - base[1]).max():.3f} rad")
    policy.close()
    env.close()


if __name__ == "__main__":
    main()
