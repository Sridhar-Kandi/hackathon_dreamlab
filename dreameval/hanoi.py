"""Tower of Hanoi (3 discs) for the harness: a ground-truth grader and a move planner.

HanoiTracker watches the three blocks every row. Whenever nothing is moving and no arm touches a block for 1 s it
reads a *settled configuration* (which pad each block is on, bottom to top) and logs it if it changed. From that log:

  success          all three on the black pad, largest at the bottom, settled, and no rule was ever broken
  optimal_progress furthest state of the 7-move optimal solution reached (0..7)
  moves            settled configuration changes (the optimum is 7)
  illegal          a larger block was ever seen resting on a smaller one

Planner: next_move(config) solves the puzzle from *any* legal configuration (BFS over the 27 states), so a
stepwise prompter can recover from a non-optimal move instead of following a fixed script.
"""

from collections import deque
from functools import lru_cache

import numpy as np

import detectors
from scenes import HANOI_BLOCKS, PADS

BLOCKS = [b[0] for b in reversed(HANOI_BLOCKS)]  # small -> large: blue, red, yellow
SIZE = {b: i for i, b in enumerate(BLOCKS)}
COLOR = {b: b.split("_")[0] for b in BLOCKS}
PEGS = ("pad_a", "pad_b", "pad_c")
START, GOAL = ("pad_a",) * 3, ("pad_c",) * 3
SINGLE_PROMPT = ("solve the tower of hanoi: move the three blocks from the green pad to the black pad one at a time, "
                 "never putting a bigger block on a smaller one")


def _tops(cfg):
    """peg -> list of blocks bottom..top for a config (tuple of pegs indexed like BLOCKS); legal order assumed."""
    out = {p: [] for p in PEGS}
    for b in sorted(BLOCKS, key=lambda b: -SIZE[b]):
        out[cfg[SIZE[b]]].append(b)
    return out


def legal_moves(cfg):
    stacks = _tops(cfg)
    for src in PEGS:
        if not stacks[src]:
            continue
        b = stacks[src][-1]
        for dst in PEGS:
            if dst != src and (not stacks[dst] or SIZE[stacks[dst][-1]] > SIZE[b]):
                nxt = list(cfg)
                nxt[SIZE[b]] = dst
                yield b, dst, tuple(nxt)


@lru_cache(maxsize=None)
def solve(cfg):
    """Shortest list of (block, peg) moves from cfg to GOAL."""
    prev = {cfg: None}
    q = deque([cfg])
    while q:
        c = q.popleft()
        if c == GOAL:
            path = []
            while prev[c] is not None:
                c0, b, dst = prev[c]
                path.append((b, dst))
                c = c0
            return path[::-1]
        for b, dst, n in legal_moves(c):
            if n not in prev:
                prev[n] = (c, b, dst)
                q.append(n)
    return None


OPTIMAL = [START]
for _b, _dst in solve(START):
    _n = list(OPTIMAL[-1])
    _n[SIZE[_b]] = _dst
    OPTIMAL.append(tuple(_n))


def move_prompt(cfg, block, dst):
    under = _tops(cfg)[dst]
    if under:
        return f"put the {COLOR[block]} block on the {COLOR[under[-1]]} block"
    return f"put the {COLOR[block]} block on the {PADS[dst][2]} pad"


def oracle_steps():
    """The 7 optimal moves as harness (object, goal) steps for the scripted oracle."""
    cfg, steps = START, []
    for b, dst in solve(START):
        under = _tops(cfg)[dst]
        steps.append((b, f"on:{under[-1]}" if under else f"on:{dst}"))
        n = list(cfg)
        n[SIZE[b]] = dst
        cfg = tuple(n)
    return steps


class HanoiTracker:
    settle_rows = 20  # 1 s

    def __init__(self, env, still_speed=0.03, pad_radius=0.065, lift_height=0.05):
        self.env = env
        self.still_speed, self.pad_radius, self.lift_height = still_speed, pad_radius, lift_height
        self.rest_z = {b: detectors.body_pos(env, b)[2] for b in BLOCKS}
        self.pad_xy = {p: np.array(PADS[p][0]) for p in PEGS}
        self.row = 0
        self.still_run = 0
        self.history = [{"row": 0, "config": START, "legal": True}]
        self.illegal = False
        self.off_pad = False
        self.fell_off_table = False
        self.goal_at = None
        self.first_contact = None
        self.lifted_at = None
        self.max_height = 0.0
        self.contact_rows = 0
        self.table_hits = 0
        self.lift_run = 0

    # --- reading the table -------------------------------------------------------------------------------------
    def read(self):
        """(config tuple or None if a block is off every pad, legal bool, stacks)."""
        env = self.env
        cfg, stacks = [], {p: [] for p in PEGS}
        for b in BLOCKS:
            p = detectors.body_pos(env, b)
            d = {peg: float(np.linalg.norm(p[:2] - xy)) for peg, xy in self.pad_xy.items()}
            peg = min(d, key=d.get)
            if d[peg] > self.pad_radius:
                return None, False, None
            cfg.append(peg)
            stacks[peg].append((p[2], b))
        legal = all(SIZE[a] > SIZE[b] for s in stacks.values() for (_, a), (_, b) in zip(sorted(s), sorted(s)[1:]))
        return tuple(cfg), legal, {k: [b for _, b in sorted(v)] for k, v in stacks.items()}

    def update(self, env):
        touching = {b: bool(detectors.arm_touching(env, b)) for b in BLOCKS}
        any_touch = any(touching.values())
        if any_touch:
            self.contact_rows += 1
            if self.first_contact is None:
                self.first_contact = self.row
        heights = {b: detectors.body_pos(env, b)[2] - self.rest_z[b] for b in BLOCKS}
        self.max_height = max(self.max_height, max(heights.values()))
        lifted_now = any(touching[b] and heights[b] >= self.lift_height for b in BLOCKS)
        self.lift_run = self.lift_run + 1 if lifted_now else 0
        if self.lifted_at is None and self.lift_run >= 5:
            self.lifted_at = self.row
        if any(detectors.body_pos(env, b)[2] < detectors.TABLE_TOP_Z - 0.05 for b in BLOCKS):
            self.fell_off_table = True
        if detectors.arm_table_contact(env):
            self.table_hits += 1
        still = not any_touch and all(detectors.body_speed(env, b) < self.still_speed for b in BLOCKS)
        self.still_run = self.still_run + 1 if still else 0
        if self.still_run == self.settle_rows:
            cfg, legal, _ = self.read()
            if cfg is None:
                self.off_pad = True
            elif cfg != self.history[-1]["config"] or legal != self.history[-1]["legal"]:
                self.history.append({"row": self.row, "config": cfg, "legal": legal})
                self.illegal |= not legal
            if cfg == GOAL and legal and self.goal_at is None:
                self.goal_at = self.row
        self.row += 1

    # --- planner -----------------------------------------------------------------------------------------------
    def config(self):
        """Last settled legal configuration (the planner's belief)."""
        for h in reversed(self.history):
            if h["legal"]:
                return h["config"]
        return START

    def next_move(self):
        cfg = self.config()
        if not self.history[-1]["legal"]:
            return None
        path = solve(cfg)
        return (cfg, *path[0]) if path else None

    def next_prompt(self):
        m = self.next_move()
        return move_prompt(*m) if m else None

    # --- grading -----------------------------------------------------------------------------------------------
    @property
    def success(self):
        return self.goal_at is not None and not self.illegal

    def optimal_progress(self):
        """Furthest state of the optimal solution reached (0..7). Settled reads can miss a state while an arm still
        rests on a block, so this is the furthest optimal state seen, not a strict in-order subsequence."""
        seen = {h["config"] for h in self.history if h["legal"]}
        return max(i for i, c in enumerate(OPTIMAL) if c in seen or i == 0)

    def outcome(self, env):
        cfg, legal, _ = self.read()
        solved_now = cfg == GOAL and legal
        if self.goal_at is not None and not self.illegal:
            return "success" if solved_now else "undone"
        if self.fell_off_table:
            return "fell_off_table"
        if self.goal_at is not None or (solved_now and self.illegal):
            return "solved_illegally"
        if self.illegal:
            return "illegal_move"
        if self.first_contact is None:
            return "never_touched"
        if self.lifted_at is None:
            return "touched_no_lift"
        if self.off_pad or cfg is None:
            return "block_off_pad" if self.optimal_progress() == 0 else "partial_then_off_pad"
        return "partial" if self.optimal_progress() else "no_progress"

    def summary(self, env):
        cfg, legal, stacks = self.read()
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
            "progress": self.optimal_progress(),
            "progress_of": len(OPTIMAL) - 1,
            "moves": len(self.history) - 1,
            "illegal": self.illegal,
            "final_stacks": stacks,
            "history": [{"row": h["row"], "config": list(h["config"]), "legal": h["legal"]} for h in self.history],
            "final_pos": [round(float(v), 4) for v in detectors.body_pos(env, BLOCKS[0])],
            "final_bowl_dist_cm": None,
            "final_plate_dist_cm": None,
            "ended_at": "solved" if cfg == GOAL and legal else "unsolved",
        }
