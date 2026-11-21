"""Two-arm tasks: geometry, graders and scripted-oracle plans.

Scenes (built in scenes.py):
  racks      two sample tubes (red, blue) and two fixed colour-coded racks. Each tube starts on the side of the
             *other* colour's rack, so the natural solution uses both arms, each crossing the midline.
             Graded with SequenceTracker(ordered=False): red_tube in red_rack, blue_tube in blue_rack.
  hold_fill  a cup with a side handle (left arm side) and a red tube (right arm side). Success needs coordination:
             one arm holds the cup off the table while the other arm puts the tube into it.

Containers are open-top boxes; CONTAINERS[name] gives the inner half-width and wall height, measured in the
container's own frame so a moving (held) cup is graded correctly.

BimanualStats is a per-row add-on for any two-arm scene: which arm carried what, and for how long both arms were
holding something lifted at the same time (the coordination signal).
"""

import numpy as np

import detectors
from oracle import Oracle, grasp_rotation, smooth  # noqa: F401

CONTAINERS = {}  # name -> {"inner": inner half-width (m), "wall": wall height above the floor top (m), "floor": floor half-thickness}
SAMPLES = {}  # name -> (radius, half length)
TUBE_R, TUBE_H = 0.014, 0.03
WALL_T = 0.004


def add_container(ET, parent, name, pos, inner, wall, rgba, rim_rgba, free=False, mass=0.06, handle=None):
    """Open-top box: floor + 4 walls (+ optional handle box sticking out along +x)."""
    floor = 0.003
    body = ET.SubElement(parent, "body", name=name, pos=f"{pos[0]} {pos[1]} {0.76 + floor + 0.0005}")
    if free:
        ET.SubElement(body, "freejoint", name=f"{name}_free")
    m = str(mass / 6) if free else None

    def geom(size, at, color):
        kw = dict(type="box", size=" ".join(map(str, size)), pos=" ".join(map(str, at)), rgba=color,
                  friction="1.2 .01 .001")
        if m:
            kw["mass"] = m
        ET.SubElement(body, "geom", **kw)

    out = inner + WALL_T
    geom((out, out, floor), (0, 0, 0), rgba)
    hz = wall / 2
    z = floor + hz
    geom((WALL_T / 2, out, hz), (inner + WALL_T / 2, 0, z), rim_rgba)
    geom((WALL_T / 2, out, hz), (-inner - WALL_T / 2, 0, z), rim_rgba)
    geom((inner, WALL_T / 2, hz), (0, inner + WALL_T / 2, z), rim_rgba)
    geom((inner, WALL_T / 2, hz), (0, -inner - WALL_T / 2, z), rim_rgba)
    if handle:
        length, half_w, half_h = handle
        geom((length / 2, half_w, half_h), (out + length / 2, 0, -floor + half_h), rim_rgba)
    CONTAINERS[name] = {"inner": inner, "wall": wall, "floor": floor}


def add_tube(ET, parent, name, pos, rgba, mass=0.03):
    body = ET.SubElement(parent, "body", name=name, pos=f"{pos[0]} {pos[1]} {0.76 + TUBE_H + 0.0005}")
    ET.SubElement(body, "freejoint", name=f"{name}_free")
    ET.SubElement(body, "geom", type="cylinder", size=f"{TUBE_R} {TUBE_H}", rgba=rgba, mass=str(mass),
                  friction="1.2 .01 .001")
    SAMPLES[name] = (TUBE_R, TUBE_H)


def _container_spec(model, name):
    if name not in CONTAINERS:  # registry is per process; rebuild lazily from the scene builders
        import scenes

        for build in scenes.SCENES.values():
            build()
            if name in CONTAINERS:
                break
    return CONTAINERS[name]


def in_container(env, obj, cont, margin=0.002):
    """obj's centre is inside cont's walls (container frame) and its bottom is below the rim."""
    spec = _container_spec(env.model, cont)
    d = env.data
    R = d.body(cont).xmat.reshape(3, 3)
    rel = R.T @ (d.body(obj).xpos - d.body(cont).xpos)
    half = detectors.half_height(env.model, obj)
    return bool(abs(rel[0]) < spec["inner"] - margin and abs(rel[1]) < spec["inner"] - margin
                and rel[2] - half < spec["floor"] + spec["wall"] and rel[2] > -0.01)


def lifted_by(env, obj, rest_z, min_lift=0.03):
    """Arms touching obj while it is at least min_lift above where it started."""
    if env.data.body(obj).xpos[2] - rest_z < min_lift:
        return set()
    return detectors.arm_touching(env, obj)


def arms_collide(env):
    """Any contact between a left-arm body and a right-arm body."""
    m, d = env.model, env.data
    for i in range(d.ncon):
        c = d.contact[i]
        a, b = m.body(m.geom_bodyid[c.geom1]).name, m.body(m.geom_bodyid[c.geom2]).name
        if (a.startswith("left_") and b.startswith("right_")) or (a.startswith("right_") and b.startswith("left_")):
            return True
    return False


def tilt_deg(env, obj):
    z = env.data.body(obj).xmat.reshape(3, 3)[:, 2]
    return float(np.degrees(np.arccos(np.clip(z[2], -1, 1))))


class BimanualStats:
    """Per-row: who carries what, and for how long both arms hold something lifted at once."""

    def __init__(self, env, objects):
        self.env, self.objects = env, list(objects)
        self.rest = {o: env.data.body(o).xpos[2] for o in self.objects}
        self.carry_rows = {o: {"left": 0, "right": 0} for o in self.objects}
        self.both_rows = 0
        self.arm_rows = {"left": 0, "right": 0}
        self.collide_rows = 0

    def update(self, env):
        busy = set()
        for o in self.objects:
            for side in lifted_by(env, o, self.rest[o]):
                self.carry_rows[o][side] += 1
                busy.add(side)
        for s in busy:
            self.arm_rows[s] += 1
        if busy == {"left", "right"}:
            self.both_rows += 1
        self.collide_rows += arms_collide(env)

    def summary(self):
        carried_by = {o: (max(v, key=v.get) if max(v.values()) else None) for o, v in self.carry_rows.items()}
        return {
            "carried_by": carried_by,
            "arms_used": sorted({s for s in carried_by.values() if s}),
            "both_arms_busy_s": round(self.both_rows / 20, 1),
            "arm_carry_s": {k: round(v / 20, 1) for k, v in self.arm_rows.items()},
            "arm_collision_s": round(self.collide_rows / 20, 2),
        }


class HoldFillTracker:
    """Grades hold_fill: the tube must end inside the cup while one arm holds the cup off the table and the tube has
    been let go by the other arm (held 0.5 s)."""

    def __init__(self, env, cup="cup", sample="red_tube", min_lift=0.03, hold_rows=10):
        self.env, self.cup, self.sample = env, cup, sample
        self.min_lift, self.hold_rows = min_lift, hold_rows
        self.rest = {o: env.data.body(o).xpos[2] for o in (cup, sample)}
        self.row = 0
        self.first_contact = None
        self.lifted_at = None  # tube lifted
        self.cup_lifted_at = None
        self.max_height = 0.0
        self.cup_max = 0.0
        self.goal_run = 0
        self.goal_at = None
        self.in_cup_at = None
        self.in_cup_on_table = False
        self.both_rows = 0  # cup held up by one arm while the tube is held up by the other
        self.cup_path = []  # cup positions while both arms were busy (sway)
        self.cup_arm = None
        self.tube_arm = None
        self.max_cup_tilt = 0.0
        self.spilled = False
        self.fell_off_table = False
        self.stats = BimanualStats(env, (cup, sample))

    def update(self, env):
        self.stats.update(env)
        cup_h = env.data.body(self.cup).xpos[2] - self.rest[self.cup]
        tube_h = env.data.body(self.sample).xpos[2] - self.rest[self.sample]
        self.max_height = max(self.max_height, tube_h)
        self.cup_max = max(self.cup_max, cup_h)
        cup_arms = lifted_by(env, self.cup, self.rest[self.cup], self.min_lift)
        tube_arms = lifted_by(env, self.sample, self.rest[self.sample], self.min_lift)
        if (detectors.arm_touching(env, self.cup) or detectors.arm_touching(env, self.sample)) and self.first_contact is None:
            self.first_contact = self.row
        if cup_arms and self.cup_lifted_at is None:
            self.cup_lifted_at = self.row
        if tube_arms and self.lifted_at is None:
            self.lifted_at = self.row
        if cup_arms:
            self.cup_arm = sorted(cup_arms)[0]
        if tube_arms:
            self.tube_arm = sorted(tube_arms)[0]
        if cup_arms and tube_arms and cup_arms != tube_arms:
            self.both_rows += 1
            self.cup_path.append(env.data.body(self.cup).xpos.copy())
        inside = in_container(env, self.sample, self.cup)
        tilt = tilt_deg(env, self.cup)
        if self.cup_lifted_at is not None:
            self.max_cup_tilt = max(self.max_cup_tilt, tilt)
        if inside and self.in_cup_at is None:
            self.in_cup_at = self.row
        if self.in_cup_at is not None and not inside and self.goal_at is None:
            self.spilled = True
        if inside and not cup_arms and cup_h < 0.01 and not detectors.arm_touching(env, self.sample):
            self.in_cup_on_table = True
        released = not detectors.arm_touching(env, self.sample)
        ok = inside and bool(cup_arms) and released and tilt < 30
        self.goal_run = self.goal_run + 1 if ok else 0
        if self.goal_at is None and self.goal_run >= self.hold_rows:
            self.goal_at = self.row
        if any(env.data.body(o).xpos[2] < detectors.TABLE_TOP_Z - 0.05 for o in (self.cup, self.sample)):
            self.fell_off_table = True
        self.row += 1

    @property
    def success(self):
        return self.goal_at is not None

    def outcome(self, env):
        if self.success:
            return "success"
        if self.fell_off_table:
            return "fell_off_table"
        if self.first_contact is None:
            return "never_touched"
        if self.in_cup_on_table or (in_container(env, self.sample, self.cup) and self.cup_lifted_at is None):
            return "filled_on_table"  # one-arm solution: no coordination
        if self.spilled:
            return "spilled"
        if self.cup_lifted_at is None and self.lifted_at is None:
            return "touched_no_lift"
        if self.cup_lifted_at is None:
            return "cup_never_held"
        if self.lifted_at is None:
            return "held_cup_no_tube"
        if self.both_rows == 0:
            return "never_together"
        return "missed_cup"

    def summary(self, env):
        sway = None
        if len(self.cup_path) > 1:
            pts = np.array(self.cup_path)
            sway = round(100 * float(np.linalg.norm(pts - pts.mean(0), axis=1).max()), 1)
        p = env.data.body(self.sample).xpos
        return {
            "outcome": self.outcome(env),
            "success": self.success,
            "rows": self.row,
            "first_contact_row": self.first_contact,
            "lifted_row": self.lifted_at,
            "goal_row": self.goal_at,
            "max_lift_cm": round(100 * self.max_height, 1),
            "cup_max_lift_cm": round(100 * self.cup_max, 1),
            "cup_lifted_row": self.cup_lifted_at,
            "cup_arm": self.cup_arm,
            "tube_arm": self.tube_arm,
            "together_s": round(self.both_rows / 20, 1),
            "cup_sway_cm": sway,
            "max_cup_tilt_deg": round(self.max_cup_tilt, 1),
            "in_cup_row": self.in_cup_at,
            "contact_rows": 0,
            "arm_table_rows": 0,
            "final_pos": [round(float(v), 4) for v in p],
            "target": self.sample,
            "final_bowl_dist_cm": None,
            "final_plate_dist_cm": None,
            "ended_at": "cup" if in_container(env, self.sample, self.cup) else "out",
            **self.stats.summary(),
        }


# --- scripted oracle plans -------------------------------------------------------------------------------------
class BimanualOracle(Oracle):
    def drop_into(self, obj, cont, side, before_carry=None):
        """Pick obj with `side` and release it 1 cm above the container's rim, centred."""
        env = self.env
        half = detectors.half_height(env.model, obj)
        for attempt in range(self.max_grasp_tries):
            p = env.data.body(obj).xpos.copy()
            grasp_z = max(p[2], detectors.TABLE_TOP_Z + 0.012)
            q_pre, err, rot = self._best_ik(side, np.r_[p[:2], grasp_z + 0.10], grasp_rotation(env, obj, side))
            self.events.append({"phase": "approach", "obj": obj, "arm": side, "attempt": attempt,
                                "ik_err_mm": round(1000 * err, 1)})
            yield from self._rows(q_pre, side, 1.0, 2.0)
            yield from self._line(side, np.r_[p[:2], grasp_z], rot, 1.0, 1.5)
            yield from self._rows(self.cmd[side][:6], side, 0.0, 1.0)
            yield from self._wait(0.4)
            yield from self._line(side, np.r_[p[:2], grasp_z + 0.06], rot, 0.0, 1.0)
            if env.data.body(obj).xpos[2] - p[2] > 0.03 and side in detectors.arm_touching(env, obj):
                break
            self.events.append({"phase": "grasp_failed", "obj": obj, "attempt": attempt})
            yield from self._rows(self.cmd[side][:6], side, 1.0, 0.6)
        else:
            return False
        tcp, _ = self.ik[side].fk(self.cmd[side][:6])
        offset = env.data.body(obj).xpos - tcp
        yield from self._line(side, tcp + np.array([0, 0, 0.08]), rot, 0.0, 1.0)
        if before_carry is not None:
            yield from before_carry()
        tcp, _ = self.ik[side].fk(self.cmd[side][:6])

        def target():
            spec = _container_spec(env.model, cont)
            c = env.data.body(cont).xpos
            return c[:2].copy(), c[2] + spec["floor"] + spec["wall"] + half + 0.012

        xy, z = target()
        carry = max(z, env.data.body(obj).xpos[2]) + 0.015
        yield from self._line(side, np.r_[tcp[:2], carry - offset[2]], rot, 0.0, 1.0)
        yield from self._line(side, np.r_[xy - offset[:2], carry - offset[2]], rot, 0.0, 2.0)
        xy, z = target()
        yield from self._line(side, np.r_[xy - offset[:2], z - offset[2]], rot, 0.0, 1.2)
        yield from self._wait(0.3)
        yield from self._rows(self.cmd[side][:6], side, 1.0, 0.6)
        here, _ = self.ik[side].fk(self.cmd[side][:6])
        yield from self._line(side, here + np.array([0, 0, 0.08]), rot, 1.0, 1.0)
        self.events.append({"phase": "dropped_in", "obj": obj, "arm": side})
        return True

    handle_at = 0.08  # grasp point along the handle, from the cup wall (keeps the two hands apart)

    def hold_up(self, cont, side, lift=0.10, present=None):
        """Grasp the container's handle with `side` and lift it; keeps holding (the command stays closed)."""
        env = self.env
        spec = _container_spec(env.model, cont)
        R = env.data.body(cont).xmat.reshape(3, 3)
        c = env.data.body(cont).xpos.copy()
        out = spec["inner"] + WALL_T
        handle = c + R @ np.array([out + self.handle_at, 0, 0.0])
        handle[2] = c[2] - spec["floor"] + 0.022
        x = R[:, 0].copy()  # tool x along the handle: the fingers close across its 2 cm width
        x[2] = 0
        x /= np.linalg.norm(x)
        rots = []
        for xx in (x, -x):
            y = np.cross(np.array([0.0, 0, -1]), xx)
            rots.append(np.column_stack([xx, y, [0, 0, -1]]))
        q_pre, err, rot = self._best_ik(side, handle + np.array([0, 0, 0.10]), rots)
        self.events.append({"phase": "approach_handle", "obj": cont, "arm": side, "ik_err_mm": round(1000 * err, 1)})
        yield from self._rows(q_pre, side, 1.0, 2.0)
        yield from self._line(side, handle, rot, 1.0, 1.5)
        yield from self._rows(self.cmd[side][:6], side, 0.0, 1.0)
        yield from self._wait(0.4)
        yield from self._line(side, handle + np.array([0, 0, lift]), rot, 0.0, 1.5)
        self.hold = (side, rot, c[:2].copy())
        if present is not None:
            yield from self.present(present)
        ok = env.data.body(cont).xpos[2] - c[2] > 0.03
        self.events.append({"phase": "holding" if ok else "hold_failed", "obj": cont, "arm": side})
        return ok

    def present(self, xy, seconds=1.5):
        """Carry the held container level so its centre moves to xy, then hold still."""
        side, rot, c0 = self.hold
        here, _ = self.ik[side].fk(self.cmd[side][:6])
        cur = self.env.data.body("cup").xpos[:2]
        yield from self._line(side, np.r_[here[:2] + np.asarray(xy) - cur, here[2]], rot, 0.0, seconds)
        yield from self._wait(0.5)

    def plan_hold_fill(self, cup="cup", sample="red_tube"):
        """Left arm lifts the cup by its handle; right arm picks the tube and lifts it clear; the left arm then
        brings the cup to the middle and holds it still while the right arm drops the tube in."""
        self.cmd = self._cmd()
        ok = yield from self.hold_up(cup, "left", lift=0.05)
        if ok:
            yield from self.drop_into(sample, cup, "right")
        while True:
            yield from self._wait(1.0)

    def plan_racks(self, pairs):
        self.cmd = self._cmd()
        for obj, cont in pairs:
            side = "left" if self.env.data.body(obj).xpos[0] > 0 else "right"
            yield from self.drop_into(obj, cont, side)
            yield from self._rows(np.zeros(6), side, 1.0, 1.5)
        while True:
            yield from self._wait(1.0)


RACK_PAIRS = (("red_tube", "red_rack"), ("blue_tube", "blue_rack"))


def oracle_plan(env, scene):
    o = BimanualOracle(env)
    if scene == "hold_fill":
        return o, o.plan_hold_fill()
    return o, o.plan_racks(RACK_PAIRS)
