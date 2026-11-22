"""Grasp assist: small, ground-truth-gated corrections around Dream-1's own grasps. Dream-1 keeps choosing the object,
the approach, the carry and the placement; the assist only fixes the grasp, which probe_grasp.py showed is where it
fails (it closes with the fingertips at or above the block's top edge).

Four parts, each switchable:
  depth     (1) close-onset check: when Dream-1 starts closing on the target with the tcp more than `high_m` above the
                target's top face, pause the policy, re-open, descend straight down to the oracle's grasp height (tcp at
                the block's centre), close, lift 3 cm, and hand control back. A hold latch then keeps the grip firm
                until Dream-1 itself opens past the object's width (its release).
  width     (2) width gate: after a close, if the measured opening is clearly below the object's width while the
                object has not come up, the fingers are pinching an edge -> the same regrasp.
  backtrack (4) on a stalled grasp (touched STALL_S without lift), open and replay the replay buffer (REPLAY_BUFFER_S
                of commanded motion) in reverse, then re-open the Dream session from that nearby state.
  adaptive  (3) execute only NEAR_ROWS rows of a reply while the gripper is near the target (grasp) or the held
                target is near its support (placement); full replies in free space.

Every number comes from a HarnessConfig (see settings.py); keyword arguments override single values.
"""

import numpy as np

from . import geometry as detectors
from .buffer import ReplayBuffer
from .kinematics import ArmIK, smooth
from .settings import HarnessConfig

FULL_W = 0.095  # gripper opening (m) at normalized 1.0


class Assist:
    def __init__(self, env, tracker, parts=("depth", "width", "backtrack"), config=None, near_rows=None,
                 high_m=None, max_regrasps=None, stall_s=None):
        config = config or HarnessConfig()
        hz = config.CONTROL_HZ
        self.env, self.tracker, self.parts, self.config = env, tracker, set(parts), config
        self.near_rows = config.NEAR_ROWS if near_rows is None else near_rows
        self.high_m = config.HIGH_M if high_m is None else high_m
        self.max_regrasps = config.MAX_REGRASPS if max_regrasps is None else max_regrasps
        self.stall_rows = int((config.STALL_S if stall_s is None else stall_s) * hz)
        self.ik = {s: ArmIK(env, s) for s in ("left", "right")}
        self.history = ReplayBuffer.from_config(config)
        self.last_cmd = {"left": 1.0, "right": 1.0}
        self.latch = {"left": None, "right": None}  # side -> object while the assist holds the grip
        self.pending = None
        self.regrasps = {}
        self.events = []
        self.closed_rows = {"left": 0, "right": 0}
        self.contact_row = None
        self.step_obj = None
        self.hover, self.hover_rows, self.last_obj_pos = 0, int(config.HOVER_S * hz), None
        self.post_place = None

    # --- helpers ---------------------------------------------------------------------------------------------
    def _step(self):
        t = self.tracker
        return t._current() if hasattr(t, "_current") else t

    def _obj(self):
        return self._step().obj

    def width(self, obj):
        """Normalized gripper opening at which the fingers meet this (box) object's faces."""
        return min(1.0, 2 * detectors.half_height(self.env.model, obj) / FULL_W)

    def _geom(self, side, obj):
        d = self.env.data
        tcp = d.site(f"{side}_tcp").xpos
        p = d.body(obj).xpos
        top = p[2] + detectors.half_height(self.env.model, obj)
        return tcp, p, top

    def _lifted(self, obj):
        st = self._step()
        return self.env.data.body(obj).xpos[2] - st.rest_z > 0.01

    # --- per row hooks ---------------------------------------------------------------------------------------
    def filter(self, l, r):
        """Applied to each Dream-1 row before it executes: hold latch, close-onset detection, history."""
        l, r = np.array(l, float), np.array(r, float)
        obj = self._obj()
        if obj != self.step_obj:
            self.step_obj, self.contact_row = obj, None
        w = self.width(obj)
        for side, a in (("left", l), ("right", r)):
            cmd = a[6]
            held = self.latch[side]
            if ("place" in self.parts and self.pending is None and cmd > self.last_cmd[side] + 0.01
                    and cmd > self.width(obj) - 0.02 and self._carrying(side, obj)):
                # release onset over the support: centre the object there before letting go
                off = self._support_offset(obj)
                if off is not None and self._place_window(off):
                    a[6] = self.last_cmd[side]
                    self.pending = ("place_align", side, round(100 * float(np.linalg.norm(off[:2])), 1))
                    self.last_cmd[side] = a[6]
                    continue
            if held is not None:
                if cmd > self.width(held) + 0.02:  # Dream-1 opens past the object: its release
                    self.latch[side] = None
                    self.events.append({"row": self.tracker.row, "reason": "latch_release", "arm": side})
                else:
                    a[6] = min(cmd, max(0.0, self.width(held) - 0.12))
            if ("depth" in self.parts and self.pending is None and self.latch[side] is None
                    and self.last_cmd[side] >= w + 0.1 > cmd and not self._lifted(obj)):
                tcp, p, top = self._geom(side, obj)
                if np.linalg.norm(tcp[:2] - p[:2]) < 0.03 and tcp[2] - top > self.high_m:
                    self.pending = ("depth_too_high", side, round(100 * (tcp[2] - top), 1))
            self.last_cmd[side] = cmd
        self.history.append(l, r)
        return l, r

    def after(self):
        """After each row: width gate and stall detection."""
        if self.pending is not None:
            return
        env, obj = self.env, self._obj()
        st = env.state()
        touching = detectors.arm_touching(env, obj)
        if touching and self.contact_row is None:
            self.contact_row = self.tracker.row
        w = self.width(obj)
        for side in ("left", "right"):
            closing = self.last_cmd[side] < w - 0.05
            self.closed_rows[side] = self.closed_rows[side] + 1 if closing else 0
            tcp, p, top = self._geom(side, obj)
            over = np.linalg.norm(tcp[:2] - p[:2]) < 0.03 and tcp[2] - top < 0.03
            if ("width" in self.parts and self.closed_rows[side] == 10 and (side in touching or over)
                    and not self._lifted(obj) and self.latch[side] is None and st[side][6] < w - 0.04):
                self.pending = ("edge_pinch", side, round(float(st[side][6]), 3))
                return
        if ("backtrack" in self.parts and self.contact_row is not None and not self._lifted(obj)
                and self.tracker.row - self.contact_row >= self.stall_rows):
            self.pending = ("grasp_stalled", None, None)
            return
        self._check_hover(obj)
        self._watch_after_place(obj, touching)

    def _watch_after_place(self, obj, touching):
        """Diagnostics for 2 s after a placement: was the object left alone, still, and at the goal?"""
        w = self.post_place
        if w is None:
            return
        w["rows"] += 1
        w["touched"] += bool(touching)
        if not touching and w["first_free"] is None:
            w["first_free"] = w["rows"]
        w["touch_sides"] |= set(touching)
        w["max_speed"] = max(w["max_speed"], detectors.body_speed(self.env, obj))
        w["at_goal"] += bool(self._step().goal(self.env, obj))
        if w["rows"] >= 2 * self.config.CONTROL_HZ:
            w["touch_sides"] = sorted(w["touch_sides"])
            w["max_speed"] = round(w["max_speed"], 3)
            self.events.append({"row": self.tracker.row, "reason": "after_place", "info": w})
            self.post_place = None

    def _check_hover(self, obj):
        """Bowl/plate goals only: Dream-1 often carries the fruit over the goal and then hovers without letting go.
        If the carried object stays inside the place window, nearly still, for `hover_rows`, place it."""
        goal = self._step().goal_name or ""
        if "place" not in self.parts or goal.startswith("on:"):
            return
        p = self.env.data.body(obj).xpos.copy()
        prev, self.last_obj_pos = self.last_obj_pos, p
        side = next((s for s in ("left", "right") if self._carrying(s, obj)), None)
        off = self._support_offset(obj) if side else None
        if off is None or prev is None or not self._place_window(off) or np.linalg.norm(p - prev) > 0.002:
            self.hover = 0
            return
        self.hover += 1
        if self.hover >= self.hover_rows:
            self.hover = 0
            self.pending = ("place_hover", side, round(100 * float(np.linalg.norm(off[:2])), 1))

    def _carrying(self, side, obj):
        return self._lifted(obj) and side in detectors.arm_touching(self.env, obj)

    def _support_offset(self, obj):
        """(dx, dy, dz) from where the object is to where it should be released; None if the goal has no place.
        on:<block>: resting centred on the block. on_plate: resting on the plate centre. inside_bowl: centred
        1 cm above the bowl rim (it drops in)."""
        goal = self._step().goal_name or ""
        d, m = self.env.data, self.env.model
        hh = detectors.half_height(m, obj)
        if goal.startswith("on:"):
            sup = goal[3:]
            want = d.body(sup).xpos.copy()
            want[2] += detectors.half_height(m, sup) + hh
        elif goal == "on_plate":
            want = np.r_[detectors.PLATE["center"], detectors.PLATE["top_z"] + hh]
        elif goal == "inside_bowl":
            want = np.r_[detectors.BOWL["center"], detectors.BOWL["rim_z"] + hh + 0.01]
        else:
            return None
        return want - d.body(obj).xpos

    def _place_window(self, off):
        """Only correct Dream-1's aim near the goal it chose: 0.4-6 cm off for blocks, up to 10 cm for bowl/plate
        (larger targets, higher releases). Releases far from the goal are left alone (that is a wrong-destination
        choice, not an aim error)."""
        goal = self._step().goal_name or ""
        xy = float(np.linalg.norm(off[:2]))
        if goal.startswith("on:"):
            return 0.004 < xy < 0.06 and abs(off[2]) < 0.04
        return 0.004 < xy < 0.10 and -0.12 < off[2] < 0.04

    def near(self):
        """True when the next reply should be short: gripper near the un-lifted target, or held target near goal."""
        if "adaptive" not in self.parts:
            return False
        env, obj = self.env, self._obj()
        p = env.data.body(obj).xpos
        if not self._lifted(obj):
            radius = self.config.NEAR_RADIUS_M
            return any(np.linalg.norm(env.data.site(f"{s}_tcp").xpos - p) < radius for s in ("left", "right"))
        goal = self._step().goal_name or ""
        if goal.startswith("on:"):
            return float(np.linalg.norm(p[:2] - env.data.body(goal[3:]).xpos[:2])) < 0.05
        return False

    # --- interventions ---------------------------------------------------------------------------------------
    def take(self):
        """Pop the pending intervention: (reason, rows generator, reopen_session) or None."""
        if self.pending is None:
            return None
        reason, side, info = self.pending
        self.pending = None
        obj = self._obj()
        n = self.regrasps.get(obj, 0)
        if n >= self.max_regrasps:
            return None
        self.regrasps[obj] = n + 1
        self.events.append({"row": self.tracker.row, "reason": reason, "arm": side, "info": info, "obj": obj})
        if reason == "grasp_stalled":
            self.contact_row = None
            return reason, self._backtrack(), True
        if reason in ("place_align", "place_hover"):
            return reason, self._place(side, obj), False
        return reason, self._regrasp(side, obj), False

    def _hold_rows(self):
        st = self.env.state()
        return {s: st[s].copy() for s in ("left", "right")}

    def _regrasp(self, side, obj):
        env, ik = self.env, self.ik[side]
        cmd = self._hold_rows()
        q = cmd[side][:6].copy()
        _, rot = ik.fk(q)
        w = self.width(obj)

        def emit():
            return cmd["left"].copy(), cmd["right"].copy()

        # 1) open past the object's width
        g0 = cmd[side][6]
        for b in smooth(8):
            cmd[side][6] = g0 + (min(1.0, w + 0.3) - g0) * b
            yield emit()
        # 2) straight down (and centre in xy) to the oracle's grasp height, keeping Dream-1's wrist orientation
        p = env.data.body(obj).xpos.copy()
        tcp0, _ = ik.fk(q)
        if np.linalg.norm(tcp0[:2] - p[:2]) > 0.035:
            return
        goal = np.r_[p[:2], max(p[2], detectors.TABLE_TOP_Z + 0.012)]
        for b in smooth(24):
            q, _ = ik.solve(q, tcp0 + (goal - tcp0) * b, rot, iters=40)
            cmd[side][:6] = q
            yield emit()
        # 3) close and settle
        g0 = cmd[side][6]
        for b in smooth(12):
            cmd[side][6] = g0 * (1 - b)
            yield emit()
        for _ in range(6):
            yield emit()
        # 4) lift 3 cm, then hand back with the latch holding the grip
        top, _ = ik.fk(q)
        for b in smooth(16):
            q, _ = ik.solve(q, top + np.array([0, 0, 0.03 * b]), rot, iters=40)
            cmd[side][:6] = q
            yield emit()
        self.latch[side] = obj
        self.last_cmd[side] = 0.0

    def _place(self, side, obj):
        """Keep the grip, move so the object sits centred 4 mm above its support, then open and back off."""
        ik = self.ik[side]
        cmd = self._hold_rows()
        q = cmd[side][:6].copy()
        tcp0, rot = ik.fk(q)
        grip = cmd[side][6]
        cmd[side][6] = max(0.0, grip - 0.05)

        def emit():
            return cmd["left"].copy(), cmd["right"].copy()

        off = self._support_offset(obj)
        goal = tcp0 + off + np.array([0, 0, 0.004])
        above = np.r_[goal[:2], max(goal[2], tcp0[2])]
        for b in smooth(14):  # level move to above the target, then straight down
            q, _ = ik.solve(q, tcp0 + (above - tcp0) * b, rot, iters=40)
            cmd[side][:6] = q
            yield emit()
        for b in smooth(10):
            q, _ = ik.solve(q, above + (goal - above) * b, rot, iters=40)
            cmd[side][:6] = q
            yield emit()
        for _ in range(4):
            yield emit()
        g0 = cmd[side][6]
        for b in smooth(10):
            cmd[side][6] = g0 + (1.0 - g0) * b
            yield emit()
        for b in smooth(12):
            q, _ = ik.solve(q, goal + np.array([0, 0, 0.05 * b]), rot, iters=40)
            cmd[side][:6] = q
            yield emit()
        self.latch[side] = None
        self.last_cmd[side] = 1.0
        self.post_place = {"rows": 0, "touched": 0, "touch_sides": set(), "max_speed": 0.0, "at_goal": 0,
                           "handback_touch": sorted(detectors.arm_touching(self.env, obj)),
                           "handback_obj_z": round(float(self.env.data.body(obj).xpos[2]), 3),
                           "handback_grip": round(float(self.env.state()[side][6]), 3), "first_free": None}

    def _backtrack(self):
        """Open the grippers, then replay the replay buffer's commanded joints in reverse."""
        past = self.history.drain_reversed()
        if not past:
            return
        for l, r in past:
            l, r = l.copy(), r.copy()
            l[6] = r[6] = 1.0
            yield l, r
        for s in ("left", "right"):
            self.last_cmd[s] = 1.0
            self.latch[s] = None
