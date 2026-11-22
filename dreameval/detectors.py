"""Task-independent event detectors that read MuJoCo ground truth from the Dream YAM scene.

Every detector takes the env (yam_env.YamEnv) and object/target names, so new tasks are compositions, not new code.
"""

import numpy as np
from dream_harness.geometry import (BOWL, PLATE, TABLE_TOP_Z, arm_touching, body_pos, body_speed,  # noqa: F401
                                    free_objects, half_height, touching)

OBJECTS = ("apple", "banana", "orange", "water_bottle")  # stock scene; other scenes: free_objects(model)


def contacts(env):
    """All active contacts as (body_a, body_b) names."""
    m, d = env.model, env.data
    out = []
    for i in range(d.ncon):
        c = d.contact[i]
        out.append((m.body(m.geom_bodyid[c.geom1]).name, m.body(m.geom_bodyid[c.geom2]).name))
    return out


def arm_table_contact(env):
    """True if any arm link touches the table (excluding the base mounts)."""
    m, d = env.model, env.data
    table = m.geom("table").id
    for i in range(d.ncon):
        c = d.contact[i]
        other = c.geom2 if c.geom1 == table else c.geom1 if c.geom2 == table else None
        if other is None:
            continue
        body = m.body(m.geom_bodyid[other]).name
        if (body.startswith("left_") or body.startswith("right_")) and "base" not in body and "world" not in body:
            return True
    return False


def in_bowl_at(p):
    return bool(np.linalg.norm(p[:2] - BOWL["center"]) < BOWL["inner_radius"] and p[2] < BOWL["rim_z"] + 0.05)  # +5 cm: a fruit may rest on another


def on_plate_at(p):
    return bool(np.linalg.norm(p[:2] - PLATE["center"]) < PLATE["radius"] and p[2] < PLATE["top_z"] + 0.06)


def inside_bowl(env, obj):
    return in_bowl_at(body_pos(env, obj))


def on_plate(env, obj):
    return on_plate_at(body_pos(env, obj))


## Places an object can end up, by name; used to name a wrong destination.
PLACES = {"bowl": in_bowl_at, "plate": on_plate_at}
GOAL_PLACE = {"inside_bowl": "bowl", "on_plate": "plate"}


def place_of(p):
    """Where a position is: 'bowl', 'plate', 'table' (resting height) or 'air'."""
    for name, test in PLACES.items():
        if test(p):
            return name
    return "table" if p[2] < TABLE_TOP_Z + 0.06 else "air"


def upright(env, obj, max_tilt_deg=20):
    """The body's z axis within max_tilt of world up."""
    z_axis = env.data.body(obj).xmat.reshape(3, 3)[:, 2]
    return bool(np.degrees(np.arccos(np.clip(z_axis[2], -1, 1))) < max_tilt_deg)


def on_top_of(env, a, b, z_tol=0.01):
    """a rests on b: a's bottom at b's top (within z_tol), a's centre over b's top face, and they touch."""
    pa, pb = body_pos(env, a), body_pos(env, b)
    ha, hb = half_height(env.model, a), half_height(env.model, b)
    return bool(abs((pa[2] - pb[2]) - (ha + hb)) < z_tol and np.linalg.norm(pa[:2] - pb[:2]) < hb
                and touching(env, a, b))


GOALS = {
    "inside_bowl": inside_bowl,
    "on_plate": on_plate,
}


def goal_fn(name):
    """A goal by name: 'inside_bowl', 'on_plate', or 'on:<object>' (rest on top of that object)."""
    if name is None:
        return None
    if name.startswith("on:"):
        support = name[3:]
        return lambda env, obj: on_top_of(env, obj, support)
    if name.startswith("in:"):
        import bimanual

        cont = name[3:]
        return lambda env, obj: bimanual.in_container(env, obj, cont)
    return GOALS[name]


class Tracker:
    """Per-row event tracking for one target object; produces the trial verdict.

    Lift: object >= lift_height above its resting height while touched, for lift_rows consecutive rows.
    Goal: goal predicate true, untouched by arms, speed < still_speed, for goal_rows consecutive rows.
    """

    def __init__(self, env, obj, goal, lift_height=0.05, lift_rows=5, goal_rows=20, still_speed=0.03):
        self.obj, self.goal = obj, goal_fn(goal)
        self.lift_height, self.lift_rows, self.goal_rows, self.still_speed = lift_height, lift_rows, goal_rows, still_speed
        self.rest_z = body_pos(env, obj)[2]
        self.start_xy = body_pos(env, obj)[:2]
        self.row = 0
        self.first_contact = None
        self.lift_run = 0
        self.lifted_at = None
        self.goal_run = 0
        self.goal_at = None
        self.max_height = 0.0
        self.contact_rows = 0
        self.table_hits = 0
        self.fell_off_table = False
        self.goal_name = goal
        self.others = [o for o in free_objects(env.model) if o != obj]
        self.other_first = {}  # other object -> first row an arm touched it

    def update(self, env):
        p = body_pos(env, self.obj)
        touched = bool(arm_touching(env, self.obj))
        height = p[2] - self.rest_z
        self.max_height = max(self.max_height, height)
        if touched:
            self.contact_rows += 1
            if self.first_contact is None:
                self.first_contact = self.row
        self.lift_run = self.lift_run + 1 if (touched and height >= self.lift_height) else 0
        if self.lifted_at is None and self.lift_run >= self.lift_rows:
            self.lifted_at = self.row
        if self.goal is not None:
            ok = self.goal(env, self.obj) and not touched and body_speed(env, self.obj) < self.still_speed
            self.goal_run = self.goal_run + 1 if ok else 0
            if self.goal_at is None and self.goal_run >= self.goal_rows:
                self.goal_at = self.row
        for other in self.others:
            if other not in self.other_first and arm_touching(env, other):
                self.other_first[other] = self.row
        if arm_table_contact(env):
            self.table_hits += 1
        if p[2] < TABLE_TOP_Z - 0.05:
            self.fell_off_table = True
        self.row += 1

    @property
    def success(self):
        return self.goal_at is not None

    def outcome(self, env):
        """One failure label, the first that applies."""
        if self.success:
            return "success"
        if self.fell_off_table:
            return "fell_off_table"
        if self.first_contact is None:
            return "wrong_object" if self.other_first else "never_touched"
        if self.lifted_at is None:
            return "touched_no_lift"
        if self.goal is not None and self.goal(env, self.obj):
            return "at_goal_not_settled"
        where = place_of(body_pos(env, self.obj))
        if where in PLACES and where != GOAL_PLACE.get(self.goal_name):
            return "wrong_destination"
        return "lifted_missed_goal"

    def summary(self, env):
        p = body_pos(env, self.obj)
        return {
            "outcome": self.outcome(env),
            "success": self.success,
            "rows": self.row,
            "first_contact_row": self.first_contact,
            "lifted_row": self.lifted_at,
            "goal_row": self.goal_at,
            "max_lift_cm": round(100 * self.max_height, 1),
            "contact_rows": self.contact_rows,
            "arm_table_rows": self.table_hits,
            "final_pos": [round(float(v), 4) for v in p],
            "target": self.obj,
            "final_bowl_dist_cm": round(100 * float(np.linalg.norm(p[:2] - BOWL["center"])), 1),
            "ended_at": place_of(p),
            "final_plate_dist_cm": round(100 * float(np.linalg.norm(p[:2] - PLATE["center"])), 1),
            "other_objects_touched": dict(sorted(self.other_first.items(), key=lambda kv: kv[1])),
            "touched_other_first": next(
                (o for o, r in sorted(self.other_first.items(), key=lambda kv: kv[1])
                 if self.first_contact is None or r < self.first_contact),
                None,
            ),
        }


class SequenceTracker:
    """Ordered multi-step goal: [(object, goal), ...]. Each step is a Tracker; steps are graded in parallel so an
    out-of-order completion is seen. Success = every step latched, in order, and still true at the end.

    Exposes the Tracker interface the runner uses (row, success, max_height, lifted_at, summary) for the step
    currently in progress.
    """

    def __init__(self, env, steps, ordered=True, **kw):
        self.steps = [Tracker(env, obj, goal, **kw) for obj, goal in steps]
        self.spec = steps
        self.ordered = ordered  # False: steps may complete in any order (e.g. sorting)

    @property
    def row(self):
        return self.steps[0].row

    def update(self, env):
        for t in self.steps:
            t.update(env)

    def progress(self):
        """Steps done in order: step k counts only if steps 0..k-1 latched no later than it."""
        if not self.ordered:
            return sum(t.goal_at is not None for t in self.steps)
        n, last = 0, -1
        for t in self.steps:
            if t.goal_at is None or t.goal_at < last:
                break
            n, last = n + 1, t.goal_at
        return n

    def _current(self):
        for t in self.steps:
            if t.goal_at is None:
                return t
        return self.steps[-1]

    def _ordered(self):
        if not self.ordered:
            return True
        times = [t.goal_at for t in self.steps if t.goal_at is not None]
        return all(a <= b for a, b in zip(times, times[1:])) and self.progress() == len(times)

    @property
    def max_height(self):
        return self._current().max_height

    @property
    def lifted_at(self):
        return self._current().lifted_at

    @property
    def success(self):
        return all(t.goal_at is not None for t in self.steps) and self._ordered()

    def summary(self, env):
        n = len(self.steps)
        done = self.progress()
        latched = [t.goal_at is not None for t in self.steps]
        final_ok = all(t.goal(env, t.obj) for t in self.steps if t.goal is not None)
        if all(latched) and self._ordered() and final_ok:
            outcome = "success"
        elif any(latched) and not self._ordered():
            outcome = "wrong_order"
        elif all(latched):
            outcome = "undone"  # completed, then disturbed
        elif done:
            outcome = "partial"
        else:
            outcome = self.steps[0].outcome(env)
        base = self._current().summary(env)
        base.update(
            outcome=outcome,
            success=outcome == "success",
            progress=done,
            progress_of=n,
            step_outcomes=[t.outcome(env) for t in self.steps],
            step_goal_rows=[t.goal_at for t in self.steps],
            step_details=[t.summary(env) for t in self.steps],
            sequence=[f"{o}:{g}" for o, g in self.spec],
        )
        return base


class OrderedPlanTracker:
    """Keep per-step grading and verify that completed placements still hold at the end."""

    def __init__(self, env, steps, emit):
        self.steps = steps
        self.emit = emit
        self.row = 0
        self.index = 0
        self.started_row = 0
        self.trackers = [Tracker(env, steps[0]["target"], steps[0]["goal"])]
        self.completed = []
        self.failure = None
        self.emit("step_started", step_id=self.step["id"], sim_s=0)

    @property
    def step(self):
        return self.steps[self.index]

    def _current(self):
        return self.trackers[self.index]

    @property
    def max_height(self):
        return self._current().max_height

    @property
    def lifted_at(self):
        return self._current().lifted_at

    @property
    def success(self):
        return len(self.completed) == len(self.steps) and self.failure is None

    @property
    def done(self):
        return self.success or self.failure is not None

    def update(self, env):
        self.row += 1
        for tracker in self.trackers:
            tracker.update(env)
        tracker = self._current()
        sim_s = self.row / 20
        for milestone, reached in (("contact", tracker.first_contact), ("lift", tracker.lifted_at)):
            if reached == tracker.row - 1:
                self.emit(milestone, step_id=self.step["id"], sim_s=sim_s)

        if tracker.success:
            summary = tracker.summary(env)
            if self.index == len(self.steps) - 1:
                lost = [step["id"] for step, graded in zip(self.steps, self.trackers)
                        if graded.goal_run < graded.goal_rows]
                if lost:
                    self.failure = "final_placement_lost"
                    self.emit("step_failed", step_id=self.step["id"], sim_s=sim_s,
                              reason=self.failure, lost_goals=lost, evidence=summary)
                    return
            self.completed.append(self.step["id"])
            self.emit("step_succeeded", step_id=self.step["id"], sim_s=sim_s,
                      settled_s=tracker.goal_rows / 20, evidence=summary)
            if not self.success:
                self.index += 1
                self.started_row = self.row
                self.trackers.append(Tracker(env, self.step["target"], self.step["goal"]))
                self.emit("step_started", step_id=self.step["id"], sim_s=sim_s)
        elif self.row - self.started_row >= self.step["max_rows"]:
            self.failure = "task_timeout"
            self.emit("step_failed", step_id=self.step["id"], sim_s=sim_s,
                      reason=self.failure, evidence=tracker.summary(env))

    def summary(self, env):
        active = self._current().summary(env)
        evidence = []
        for index, step in enumerate(self.steps):
            if index < len(self.completed):
                state = "succeeded"
            elif index == self.index:
                state = "task_failed" if self.failure else "interrupted"
            else:
                state = "pending"
            detail = self.trackers[index].summary(env) if index < len(self.trackers) else None
            evidence.append(dict(id=step["id"], status=state, evidence=detail))
        return {**active, "rows": self.row, "success": self.success,
                "outcome": "success" if self.success else self.failure or "partial",
                "progress": len(self.completed), "progress_of": len(self.steps),
                "ordered_steps": evidence, "detector_version": "stock-tracker-v1"}
