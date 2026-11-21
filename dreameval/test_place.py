"""Offline check of the place_align assist (no API): a scripted policy grasps the red block well, then lowers it
over the blue block with an xy error and releases. Plain should fall off; assist_place should stack."""
import warnings
warnings.filterwarnings("ignore")
import numpy as np
import scenes, detectors, assist, oracle
from detectors import Tracker

def sloppy(env, err):
    o = oracle.Oracle(env); o.cmd = o._cmd()
    obj, sup, side = "red_block", "blue_block", "right"
    p = env.data.body(obj).xpos.copy()
    q, _, rot = o._best_ik(side, np.r_[p[:2], p[2] + 0.10], oracle.grasp_rotation(env, obj, side))
    yield from o._rows(q, side, 1.0, 2.0)
    yield from o._line(side, p.copy(), rot, 1.0, 1.2)
    yield from o._rows(o.cmd[side][:6], side, 0.0, 0.8)
    yield from o._line(side, p + [0, 0, 0.10], rot, 0.0, 1.0)
    s = env.data.body(sup).xpos.copy()
    z = s[2] + 0.0175 + 0.025 + 0.006
    yield from o._line(side, np.r_[s[:2] + err, p[2] + 0.10], rot, 0.0, 2.0)
    yield from o._line(side, np.r_[s[:2] + err, z], rot, 0.0, 1.5)
    yield from o._rows(o.cmd[side][:6], side, 1.0, 0.8)          # release
    here, _ = o.ik[side].fk(o.cmd[side][:6])
    yield from o._line(side, here + [0, 0, 0.06], rot, 1.0, 1.0)
    yield from o._wait(3.0)

def trial(err, parts):
    env = scenes.make_env("blocks2"); env.reset()
    tr = Tracker(env, "red_block", "on:blue_block")
    a = assist.Assist(env, tr, parts=parts) if parts else None
    for l, r in sloppy(env, np.array(err)):
        if a: l, r = a.filter(l, r)
        env.step(l, r); tr.update(env)
        if a:
            a.after(); act = a.take()
            if act:
                for hl, hr in act[1]:
                    env.step(hl, hr); tr.update(env)
    ok = detectors.on_top_of(env, "red_block", "blue_block")
    ev = [(e["reason"], e.get("info")) for e in a.events] if a else []
    env.close()
    return ok, ev

for err in ([0.0, 0.0], [0.02, 0.0], [0.0, 0.025], [0.03, 0.02]):
    print(err, "plain", trial(err, None), "| assist_place", trial(err, ("depth", "width", "place")))
