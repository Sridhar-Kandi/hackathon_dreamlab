"""Offline check of assist.py, no API: a scripted 'bad policy' reproduces Dream-1's failure (closes with the tcp
1.5 cm above the block's top), then tries to carry; with the assist on, the block must come up and stay held."""
import sys, warnings
warnings.filterwarnings("ignore")
import numpy as np
import runner, scenes, detectors, assist, oracle
from detectors import Tracker

def bad_policy(env, obj, side, high):
    o = oracle.Oracle(env)
    o.cmd = o._cmd()
    p = env.data.body(obj).xpos.copy()
    top = p[2] + detectors.half_height(env.model, obj)
    q, err, rot = o._best_ik(side, np.r_[p[:2], top + high + 0.08], oracle.grasp_rotation(env, obj, side))
    yield from o._rows(q, side, 1.0, 2.0)
    yield from o._line(side, np.r_[p[:2], top + high], rot, 1.0, 1.0)
    yield from o._rows(o.cmd[side][:6], side, 0.0, 1.0)          # closes too high
    here, _ = o.ik[side].fk(o.cmd[side][:6])
    yield from o._line(side, here + [0, 0, 0.10], rot, o.cmd[side][6], 1.5)  # "carry" up
    yield from o._wait(1.0)

def trial(obj, side, high, parts):
    env = scenes.make_env("blocks2")
    env.reset()
    tr = Tracker(env, obj, None)
    a = assist.Assist(env, tr, parts=parts) if parts else None
    rows = bad_policy(env, obj, side, high)
    for l, r in rows:
        if a: l, r = a.filter(l, r)
        env.step(l, r); tr.update(env)
        if a:
            a.after(); act = a.take()
            if act:
                for hl, hr in act[1]:
                    env.step(hl, hr); tr.update(env)
                # the bad policy continues from its own plan (like Dream-1 after hand-back)
    lift = 100 * (env.data.body(obj).xpos[2] - tr.rest_z)
    ev = [(e["reason"], e.get("info")) for e in a.events] if a else []
    env.close()
    return round(lift, 1), tr.lifted_at is not None, ev

for obj, side in (("red_block", "right"), ("blue_block", "left")):
    for high in (0.015, 0.003):
        for parts in (None, ("depth", "width", "backtrack")):
            print(obj, side, f"high={100*high:.1f}cm", "assist" if parts else "plain ", trial(obj, side, high, parts))
