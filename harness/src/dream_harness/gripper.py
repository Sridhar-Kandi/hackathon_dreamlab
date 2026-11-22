"""Gripper reply normalization."""

import numpy as np

from .settings import HarnessSettings


def clamp_gripper(reply, slack=None):
    """Dream-1 occasionally returns a gripper opening slightly outside 0..1 (seen: 1.055), which the stock
    validator rejects as a contract error. Clip small overshoots; leave larger ones for the validator to flag."""
    slack = HarnessSettings.GRIPPER_SLACK if slack is None else slack
    out = dict(reply)
    for k in ("q_l_chunk", "q_r_chunk"):
        a = np.array(reply[k], dtype=float, copy=True)
        if a.ndim == 2 and a.shape[1] == 7:
            g = a[:, 6]
            near = (g > -slack) & (g < 1 + slack)
            a[near, 6] = np.clip(g[near], 0.0, 1.0)
        out[k] = a
    return out
