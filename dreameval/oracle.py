"""Scripted oracle: a ground-truth pick-and-place controller, the ceiling Dream-1 is compared against.

Same idea as the Ace blackjack dealer's taught-pose cycle, but in sim the poses come from MuJoCo ground truth
instead of a recorded demo: each step is split into gated phases (approach, descend, close, lift, carry, lower,
release, retreat), each phase solved with damped-least-squares IK on the arm's `<side>_tcp` site, and a failed
grasp is detected from ground truth and retried.

It emits the same 7-value joint+gripper rows Dream-1 does and runs through the same env.step / Tracker path, so its
results land in the same results.jsonl and report as the policy's.

    plan = oracle.plan(env, [("blue_block", "on:red_block")])   # generator of (left, right) rows
"""

import mujoco
import numpy as np

import detectors
import yam_env

HZ = 20
DOWN = np.array([0.0, 0.0, -1.0])
BASE_X = {"left": 0.305, "right": -0.305}


class ArmIK:
    """Damped-least-squares IK for one arm's tcp site, on a scratch MjData (the live sim is never touched)."""

    def __init__(self, env, side):
        m = env.model
        self.env, self.side, self.m = env, side, m
        self.d = mujoco.MjData(m)
        joints = [m.joint(f"{side}_joint{i}") for i in range(1, 7)]
        self.qadr = np.array([m.jnt_qposadr[j.id] for j in joints])
        self.dofs = np.array([m.jnt_dofadr[j.id] for j in joints])
        self.lo = np.array([j.range[0] for j in joints])
        self.hi = np.array([j.range[1] for j in joints])
        self.site = m.site(f"{side}_tcp").id

    def fk(self, q):
        self.d.qpos[:] = self.env.data.qpos
        self.d.qpos[self.qadr] = q
        mujoco.mj_kinematics(self.m, self.d)
        return self.d.site_xpos[self.site].copy(), self.d.site_xmat[self.site].reshape(3, 3).copy()

    def solve(self, q0, pos, rot, iters=150, damping=0.03):
        q = np.clip(np.array(q0, float), self.lo, self.hi)
        jp, jr = np.zeros((3, self.m.nv)), np.zeros((3, self.m.nv))
        for _ in range(iters):
            p, r = self.fk(q)
            ep = pos - p
            eo = 0.5 * sum(np.cross(r[:, k], rot[:, k]) for k in range(3))
            if np.linalg.norm(ep) < 5e-4 and np.linalg.norm(eo) < 5e-3:
                break
            mujoco.mj_comPos(self.m, self.d)
            mujoco.mj_jacSite(self.m, self.d, jp, jr, self.site)
            J = np.vstack([jp[:, self.dofs], jr[:, self.dofs]])
            e = np.r_[ep, 0.5 * eo]
            dq = J.T @ np.linalg.solve(J @ J.T + damping**2 * np.eye(6), e)
            q = np.clip(q + np.clip(dq, -0.3, 0.3), self.lo, self.hi)
        p, r = self.fk(q)
        err = np.linalg.norm(pos - p) + 0.05 * np.linalg.norm(0.5 * sum(np.cross(r[:, k], rot[:, k]) for k in range(3)))
        return q, err


def grasp_rotation(env, obj, side):
    """Tool z straight down, tool x (finger closing axis) along one of the object's horizontal faces.
    Of the 4 face-aligned yaws, take the one whose wrist roll is most natural for this arm (fingers across the
    arm's reach direction)."""
    bx = env.data.body(obj).xmat.reshape(3, 3)[:, 0].copy()
    bx[2] = 0
    bx = bx / (np.linalg.norm(bx) or 1)
    by = np.array([-bx[1], bx[0], 0.0])
    reach = env.data.body(obj).xpos[:2] - np.array([BASE_X[side], 0.24])
    reach = reach / (np.linalg.norm(reach) or 1)
    cands = []
    for x in (bx, -bx, by, -by):
        y = np.cross(DOWN, x)
        # prefer tool y (wrist forward) roughly along the reach direction
        cands.append((-float(y[:2] @ reach), np.column_stack([x, y, DOWN])))
    cands.sort(key=lambda c: c[0])
    return [c[1] for c in cands]


def smooth(n):
    s = np.linspace(0, 1, n + 1)[1:]
    return s * s * (3 - 2 * s)


class Oracle:
    def __init__(self, env, max_grasp_tries=3):
        self.env = env
        self.ik = {s: ArmIK(env, s) for s in ("left", "right")}
        self.max_grasp_tries = max_grasp_tries
        self.events = []

    # --- low level -------------------------------------------------------------------------------------------
    def _cmd(self):
        s = self.env.state()
        return {k: v.copy() for k, v in s.items()}

    def _rows(self, targets, side, grip, seconds):
        """Joint-space smoothstep from the arm's current command to `targets` (6 joints), other arm held."""
        n = max(1, int(round(seconds * HZ)))
        start = self.cmd[side][:6].copy()
        g0 = self.cmd[side][6]
        for b in smooth(n):
            self.cmd[side] = np.r_[start + (targets - start) * b, g0 + (grip - g0) * b]
            yield self.cmd["left"].copy(), self.cmd["right"].copy()

    def _line(self, side, p1, rot, grip, seconds):
        """Cartesian straight line of the tcp to p1 (IK per row, warm-started)."""
        n = max(1, int(round(seconds * HZ)))
        p0, _ = self.ik[side].fk(self.cmd[side][:6])
        g0 = self.cmd[side][6]
        q = self.cmd[side][:6]
        for b in smooth(n):
            q, _ = self.ik[side].solve(q, p0 + (p1 - p0) * b, rot, iters=40)
            self.cmd[side] = np.r_[q, g0 + (grip - g0) * b]
            yield self.cmd["left"].copy(), self.cmd["right"].copy()

    def _wait(self, seconds):
        for _ in range(int(round(seconds * HZ))):
            yield self.cmd["left"].copy(), self.cmd["right"].copy()

    def _best_ik(self, side, pos, rots):
        best = None
        for rot in rots:
            for seed in (self.cmd[side][:6], np.array([0, 1.2, 1.2, 0, 0, 0]), np.array([0, 0.8, 1.6, -0.5, 0, 0])):
                q, err = self.ik[side].solve(seed, pos, rot)
                if best is None or err < best[1] - 1e-4:
                    best = (q, err, rot)
        return best

    # --- task level ------------------------------------------------------------------------------------------
    def pick_place(self, obj, goal):
        env = self.env
        half = detectors.half_height(env.model, obj)
        for attempt in range(self.max_grasp_tries):
            p = env.data.body(obj).xpos.copy()
            side = "left" if p[0] > 0 else "right"
            other = "right" if side == "left" else "left"
            self.cmd = self._cmd()
            self.cmd[other] = yam_env.HOME.copy()
            grasp_z = max(p[2], detectors.TABLE_TOP_Z + 0.012)
            q_pre, err, rot = self._best_ik(side, np.r_[p[:2], grasp_z + 0.10], grasp_rotation(env, obj, side))
            self.events.append({"phase": "approach", "obj": obj, "arm": side, "attempt": attempt, "ik_err_mm": round(1000 * err, 1)})
            yield from self._rows(q_pre, side, 1.0, 2.5)
            yield from self._line(side, np.r_[p[:2], grasp_z], rot, 1.0, 1.5)
            yield from self._rows(self.cmd[side][:6], side, 0.0, 1.0)
            yield from self._wait(0.4)
            lift_to = np.r_[p[:2], grasp_z + 0.06]
            yield from self._line(side, lift_to, rot, 0.0, 1.0)
            # gate: ground truth says the object came up with the gripper
            if env.data.body(obj).xpos[2] - p[2] > 0.03 and detectors.arm_touching(env, obj):
                break
            self.events.append({"phase": "grasp_failed", "obj": obj, "attempt": attempt})
            yield from self._rows(self.cmd[side][:6], side, 1.0, 0.6)
            yield from self._line(side, np.r_[p[:2], grasp_z + 0.12], rot, 1.0, 1.0)
        else:
            return False
        # carry: hold the object-in-hand offset measured now
        tcp, _ = self.ik[side].fk(self.cmd[side][:6])
        offset = env.data.body(obj).xpos - tcp
        dest_xy, dest_z = self._destination(goal, half)
        carry_z = max(dest_z, p[2]) + 0.10
        yield from self._line(side, np.r_[tcp[:2], carry_z - offset[2]], rot, 0.0, 1.0)
        yield from self._line(side, np.r_[dest_xy - offset[:2], carry_z - offset[2]], rot, 0.0, 2.0)
        # re-aim at the support's live position before lowering
        dest_xy, dest_z = self._destination(goal, half)
        yield from self._line(side, np.r_[dest_xy - offset[:2], dest_z + 0.004 - offset[2]], rot, 0.0, 1.8)
        yield from self._wait(0.3)
        yield from self._rows(self.cmd[side][:6], side, 1.0, 0.8)
        here, _ = self.ik[side].fk(self.cmd[side][:6])
        yield from self._line(side, here + np.array([0, 0, 0.08]), rot, 1.0, 1.0)
        yield from self._rows(yam_env.HOME[:6], side, 1.0, 2.0)
        self.events.append({"phase": "placed", "obj": obj})
        return True

    def _destination(self, goal, half):
        """(xy, z of the held object's centre at release) for a goal name."""
        env = self.env
        if goal.startswith("on:"):
            sup = goal[3:]
            sp = env.data.body(sup).xpos
            return sp[:2].copy(), sp[2] + detectors.half_height(env.model, sup) + half
        if goal == "inside_bowl":
            return detectors.BOWL["center"].copy(), detectors.BOWL["rim_z"] + 0.03
        if goal == "on_plate":
            return detectors.PLATE["center"].copy(), detectors.PLATE["top_z"] + half + 0.01
        raise ValueError(goal)

    def plan(self, steps):
        for obj, goal in steps:
            ok = yield from self.pick_place(obj, goal)
            yield from self._wait(1.0)
            if not ok:
                break
        while True:  # hold home until the runner's budget or success ends the trial
            yield from self._wait(1.0)


def plan(env, steps):
    o = Oracle(env)
    return o, o.plan(steps)
