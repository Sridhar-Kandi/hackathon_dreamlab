"""Arm kinematics for the YAM arms: forward kinematics and damped-least-squares IK on a scratch MjData."""

import mujoco
import numpy as np


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


def smooth(n):
    """n easing weights in (0, 1], smoothstep-shaped, for interpolating a motion over n rows."""
    s = np.linspace(0, 1, n + 1)[1:]
    return s * s * (3 - 2 * s)
