"""Choose training episodes for the two fine-tuning recipes, with the same episode budget.

naive:   scripted-teacher demonstrations on arbitrary training seeds, the same number per level.
harness: chosen from what the harness measured on base Dream-1 (clean runs on training seeds):
         - hard cases: teacher demonstrations replaying exactly the starts where Dream-1 failed,
           allocated to levels in proportion to Dream-1's failure count;
         - self-successes: Dream-1's own successful episodes that pass the quality gate,
           so the model also keeps what it already does well.

    python -m mission_control.recipes naive OUT.json --collection c1-teacher --per-level 20
    python -m mission_control.recipes harness OUT.json --profile profile --teacher c2-teacher --total 60
    python -m mission_control.recipes hard-seeds --profile profile      # seeds to replay with the teacher
"""

import argparse
import json
from collections import Counter

from .ladder import latest, read_rows, root

LEVELS = ("L1", "L2", "L3")


def rows_of(collection):
    return latest(read_rows(root() / collection))


def complete(row):
    episode = row.get("episode") or {}
    return bool(row.get("success")) and not episode.get("error") and episode.get("frames") == row.get("rows")


def quality(row):
    """Quality gate for a model-generated episode: success, clean, no arm-table scraping, no stray grabs."""
    reasons = []
    if not complete(row):
        reasons.append("not a complete success")
    if not row.get("clean"):
        reasons.append("steered")
    if (row.get("arm_table_rows") or 0) > 20:
        reasons.append("arm scraped the table for over 1 s")
    # In a multi-step task the row's target is the last step's object, so touching an earlier step's object
    # first is expected; only objects that belong to no step count as stray grabs.
    steps = row.get("step_details") or [row]
    task_objects = {step.get("target") for step in steps} | {row.get("target")}
    for step in steps:
        touched = step.get("touched_other_first")
        if touched and touched not in task_objects:
            reasons.append(f"touched {touched} before the target")
            break
    return reasons


def naive(args):
    rows = [r for r in rows_of(args.collection) if r["level"] in LEVELS and complete(r)]
    chosen = []
    for level in LEVELS:
        picks = sorted((r for r in rows if r["level"] == level), key=lambda r: r["seed"])[:args.per_level]
        chosen += [dict(collection=args.collection, trial=r["trial_id"], why="teacher, arbitrary seed") for r in picks]
    write(args.output, "naive: teacher demonstrations on arbitrary training seeds, equal per level", chosen)


def failures(profile):
    return [r for r in rows_of(profile) if r["level"] in LEVELS and r.get("outcome") != "error" and not r.get("success")]


def hard_seeds(args):
    for level in LEVELS:
        seeds = sorted(r["seed"] for r in failures(args.profile) if r["level"] == level)
        print(level, ",".join(map(str, seeds)) or "-")


def harness(args):
    profile = rows_of(args.profile)
    failed = failures(args.profile)
    by_level = Counter(r["level"] for r in failed)
    graded = Counter(r["level"] for r in profile if r["level"] in LEVELS and r.get("outcome") != "error")
    teacher = {(r["level"], r["seed"]): r for r in rows_of(args.teacher) if complete(r)}
    selfs = [r for r in profile if r["level"] in LEVELS and not quality(r)]
    rejected = [(r["trial_id"], quality(r)) for r in profile if r["level"] in LEVELS and r.get("success") and quality(r)]
    hard_budget = args.total - min(len(selfs), args.total // 3)
    total_failed = sum(by_level.values()) or 1
    chosen = []
    # Hard cases: share of the budget per level follows Dream-1's failure count there.
    for level in LEVELS:
        share = round(hard_budget * by_level[level] / total_failed)
        replays = [teacher[(level, r["seed"])] for r in sorted(failed, key=lambda r: r["seed"])
                   if r["level"] == level and (level, r["seed"]) in teacher]
        for r in replays[:share]:
            label = next(f["outcome"] for f in failed if f["level"] == level and f["seed"] == r["seed"])
            chosen.append(dict(collection=args.teacher, trial=r["trial_id"],
                               why=f"teacher replay of a start where Dream-1 ended '{label}'"))
    # Self-successes fill the rest, hardest level first.
    for r in sorted(selfs, key=lambda r: (-by_level[r["level"]] / max(graded[r["level"]], 1), r["seed"])):
        if len(chosen) >= args.total:
            break
        chosen.append(dict(collection=args.profile, trial=r["trial_id"], why="Dream-1's own success, passed quality gate"))
    recipe = {
        "description": "harness-informed: teacher replays of Dream-1's failed starts (allocated by failure count) "
                       "plus Dream-1's own quality-passing successes",
        "dream1_failures_by_level": dict(by_level), "dream1_graded_by_level": dict(graded),
        "failure_labels": dict(Counter(r["outcome"] for r in failed)),
        "self_successes_available": len(selfs), "self_successes_rejected": rejected,
    }
    write(args.output, recipe, chosen)


def write(path, recipe, chosen):
    counts = Counter((item["trial"].split("-")[0], "teacher" if "teacher" in item["trial"] else "dream-1") for item in chosen)
    with open(path, "w", encoding="utf-8") as out:
        json.dump({"recipe": recipe, "episodes": chosen}, out, indent=2)
    print(f"{len(chosen)} episodes -> {path}")
    for (level, source), n in sorted(counts.items()):
        print(f"  {level} {source}: {n}")


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    modes = cli.add_subparsers(dest="mode", required=True)
    n = modes.add_parser("naive")
    n.add_argument("output")
    n.add_argument("--collection", default="c1-teacher")
    n.add_argument("--per-level", type=int, default=20)
    h = modes.add_parser("harness")
    h.add_argument("output")
    h.add_argument("--profile", default="profile")
    h.add_argument("--teacher", default="c2-teacher")
    h.add_argument("--total", type=int, default=60)
    s = modes.add_parser("hard-seeds")
    s.add_argument("--profile", default="profile")
    a = cli.parse_args()
    {"naive": naive, "harness": harness, "hard-seeds": hard_seeds}[a.mode](a)
