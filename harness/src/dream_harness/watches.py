"""Supervisor watches: each one fires when a trial needs a home-and-retry intervention.

A watch reads the tracker the runner already grades with. Trackers expose `row`, `obj`, `rest_z`, `goal`,
`goal_at` and `lifted_at`; sequence trackers also expose `_current()` for the step in progress.
"""

import numpy as np

from .geometry import arm_touching, body_pos, free_objects
from .settings import HarnessConfig


def current_step(tracker):
    return tracker._current() if hasattr(tracker, "_current") else tracker


class WrongObjectWatch:
    """Fires when an arm is holding a non-target object that has been moved (lifted or slid) while the target has
    not been lifted. A brush or bump does not fire; a grab does."""

    def __init__(self, env, target, config=None):
        self.config = config or HarnessConfig()
        self.target = target
        self.others = [o for o in free_objects(env.model) if o != target]
        self.rebase(env)

    def rebase(self, env):
        self.start = {o: env.data.body(o).xpos.copy() for o in self.others}

    def check(self, env, tracker):
        if tracker.lifted_at is not None:
            return None
        for o in self.others:
            moved = env.data.body(o).xpos - self.start[o]
            grabbed = (moved[2] >= self.config.WRONG_OBJECT_LIFT_M
                       or np.linalg.norm(moved[:2]) >= self.config.WRONG_OBJECT_SLIDE_M)
            if grabbed and arm_touching(env, o):
                return o
        return None


class GraspWatch:
    """Fires when the current target has been touched for STALL_S without a lift (a stalled grasp), or was lifted
    and then dropped back to rest untouched for DROP_S while its goal is not met. On a sequence it watches the step
    in progress."""

    def __init__(self, env, config=None):
        self.config = config or HarnessConfig()
        hz = self.config.CONTROL_HZ
        self.stall_rows, self.drop_rows = int(self.config.STALL_S * hz), int(self.config.DROP_S * hz)
        self.rebase(env)

    def rebase(self, env):
        """Start a fresh attempt: contact/lift state is tracked per attempt, not per trial."""
        self.contact_row = None
        self.idle_rows = 0
        self.lift_run = 0
        self.lifted = False
        self.step_obj = None

    def check(self, env, tracker):
        t = current_step(tracker)
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


def build_watches(env, target, names, config):
    return [GraspWatch(env, config) if name == "grasp" else WrongObjectWatch(env, target, config)
            for name in dict.fromkeys(names)]
