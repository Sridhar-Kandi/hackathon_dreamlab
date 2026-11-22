"""Difficulty-ladder experiments: run several controllers on the same seeds, in parallel, in clean mode.

Clean mode means the robot receives one instruction for the whole trial and nothing derived from simulator ground
truth while it runs. Ground truth only grades. The scripted teacher is the one exception: it reads object positions,
so its trials are labelled as teacher demonstrations and are never compared as a controller.

    python -m mission_control.ladder run NAME --levels L1 L2 --arms tuned stock --seeds 2000-2019 --workers 4
    python -m mission_control.ladder report NAME
    python -m mission_control.ladder export OUT --manifest selection.json --held-out 2000-2019
"""

import argparse
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from . import execution

LEVELS = {
    "L1": dict(name="Orange into bowl", scene="stock", task="Put the orange into the bowl.",
               target="orange", goal="inside_bowl", sequence=None, sim_seconds=60),
    "L2": dict(name="Orange into bowl, then banana onto plate", scene="stock",
               task="Put the orange into the bowl, then put the banana onto the plate.",
               target="orange", goal="inside_bowl", sequence=["orange:inside_bowl", "banana:on_plate"], sim_seconds=120),
    "L3": dict(name="Three-block stack", scene="blocks3",
               task="put the red block on the yellow block, then put the blue block on the red block",
               target="red_block", goal="on:yellow_block",
               sequence=["red_block:on:yellow_block", "blue_block:on:red_block"], sim_seconds=150),
    "L4": dict(name="Tower of Hanoi", scene="hanoi",
               task="solve the tower of hanoi: move the three blocks from the green pad to the black pad one at a time,"
                    " never putting a bigger block on a smaller one",
               target="blue_block", goal="on:pad_c", sequence=None, sim_seconds=420),
}
BASE = "dreamlabs/dream-1-beta"
ARMS = {
    "teacher": dict(model="oracle", actions=24, label="Scripted teacher (reads simulator state; demonstrations only)"),
    "stock": dict(model=BASE, actions=48, label="Dream-1 base, stock 48 rows per reply"),
    "tuned": dict(model=BASE, actions=24, label="Dream-1 base, harness-tuned 24 rows per reply"),
}
JITTER_CM = 2.0
ROOT_NAME = "ladder"


def root():
    return execution.engine_dir() / ".mission-control" / ROOT_NAME


def seeds_from(text):
    seeds = []
    for part in text.split(","):
        low, _, high = part.partition("-")
        seeds.extend(range(int(low), int(high or low) + 1))
    return seeds


def arm_spec(name):
    """Named arms, or `ft:<label>=<checkpoint>` for a fine-tuned model at 24 rows."""
    if name in ARMS:
        return dict(ARMS[name], arm=name)
    if name.startswith("ft:") and "=" in name:
        label, checkpoint = name[3:].split("=", 1)
        return dict(model=checkpoint, actions=24, label=f"Fine-tuned {label} ({checkpoint}), 24 rows", arm=f"ft-{label}")
    raise SystemExit(f"Unknown arm {name!r}. Use {', '.join(ARMS)} or ft:<label>=<checkpoint>.")


_env = {}


def run_one(job):
    """One trial in a worker process. Returns the result row."""
    sys.path.insert(0, str(execution.engine_dir()))
    import runner
    import scenes
    from .datasets import EpisodeRecorder

    level = LEVELS[job["level"]]
    if _env.get("scene") != level["scene"]:
        if _env.get("env") is not None:
            _env["env"].close()
        _env.update(scene=level["scene"], env=scenes.make_env(level["scene"]))
    env = _env["env"]
    folder = Path(job["folder"])
    trial_id = f"{job['level']}-{job['arm']}-s{job['seed']}"
    episode = None
    if job["episode"]:
        path = folder / "episodes" / f"{trial_id}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            path.unlink()
        episode = EpisodeRecorder(path)
    video = folder / "video" / f"{trial_id}.mp4" if job["video"] else None
    started = time.monotonic()
    connection_retries = 0
    # Stagger session opens so parallel workers do not all connect at the same instant.
    time.sleep(job.get("stagger_s", 0))
    while True:
        if episode is not None and episode.count:
            episode.close()
            (folder / "episodes" / f"{trial_id}.jsonl").unlink()
            episode = EpisodeRecorder(folder / "episodes" / f"{trial_id}.jsonl")
        try:
            row = runner.run_trial(
                env, task=level["task"], target=level["target"], goal=level["goal"], scene=level["scene"],
                sequence=level["sequence"], model=job["model"], actions=job["actions"], seed=job["seed"],
                sim_seconds=level["sim_seconds"], jitter_cm=JITTER_CM, record=str(video) if video else None,
                on_sample=episode.add if episode else None, wall_timeout=job["wall_timeout"],
            )
        except Exception as exc:
            row = {"outcome": "error", "success": False, "error": f"{type(exc).__name__}: {exc}"[:300]}
        # A connection failure before the first model reply is infrastructure, not a trial outcome: retry it.
        unreachable = "could not reach" in str(row.get("error")) and not row.get("calls")
        if not unreachable or connection_retries >= 3:
            break
        connection_retries += 1
        time.sleep(10 * 2 ** connection_retries)
    if episode:
        episode.close()
    row.pop("trace", None)
    row.update(trial_id=trial_id, level=job["level"], arm=job["arm"], arm_label=job["label"], seed=job["seed"],
               harness_wall_s=round(time.monotonic() - started, 1), connection_retries=connection_retries)
    if episode:
        row["episode"] = {"path": str(folder / "episodes" / f"{trial_id}.jsonl"), "frames": episode.count,
                          "error": episode.error,
                          "source": "scripted_teacher" if job["model"] == "oracle" else "model_generated"}
    if video and row.get("recording"):
        row["video"] = str(video)
    return row


def read_rows(folder):
    path = folder / "results.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def latest(rows):
    """The newest row per (level, arm, seed)."""
    keep = {}
    for row in rows:
        if row.get("model") == "oracle" and not row.get("steering"):
            # Rows written before the teacher was labelled: it always reads simulator state.
            row = {**row, "steering": ["scripted teacher reads simulator object positions"], "clean": False}
        keep[(row["level"], row["arm"], row["seed"])] = row
    return list(keep.values())


def run(args):
    folder = root() / args.name
    folder.mkdir(parents=True, exist_ok=True)
    arms = [arm_spec(name) for name in args.arms]
    seeds = seeds_from(args.seeds)
    done = {(r["level"], r["arm"], r["seed"]) for r in latest(read_rows(folder)) if r.get("outcome") != "error"}
    jobs = []
    # Seed-major and arm-interleaved, so a slow or drifting server affects every arm alike.
    for seed in seeds:
        for level in args.levels:
            for arm in arms:
                if (level, arm["arm"], seed) in done:
                    continue
                jobs.append(dict(level=level, arm=arm["arm"], label=arm["label"], model=arm["model"],
                                 actions=arm["actions"], seed=seed, folder=str(folder), episode=args.episodes,
                                 video=args.video, wall_timeout=1500 if level == "L4" else 900,
                                 stagger_s=3 * len(jobs) if len(jobs) < args.workers else 0))
    config = folder / "config.json"
    history = json.loads(config.read_text()) if config.exists() else []
    history.append(dict(at=execution.now(), levels=args.levels, arms=arms, seeds=seeds, jitter_cm=JITTER_CM,
                        episodes=args.episodes, video=args.video, levels_spec={k: LEVELS[k] for k in args.levels}))
    config.write_text(json.dumps(history, indent=2))
    print(f"{len(jobs)} trials to run ({len(done)} done) with {args.workers} workers -> {folder}", flush=True)
    stop = False
    with ProcessPoolExecutor(max_workers=args.workers) as pool, (folder / "results.jsonl").open("a") as out:
        pending = {pool.submit(run_one, job): job for job in jobs}
        for future in as_completed(pending):
            row = future.result()
            out.write(json.dumps(row, allow_nan=False, default=str) + "\n")
            out.flush()
            progress = f"{row.get('progress', int(bool(row.get('success'))))}/{row.get('progress_of', 1)}"
            print(f"{row['trial_id']:<24} {row.get('outcome'):<22} progress {progress:<5} calls {row.get('calls', 0):>4} "
                  f"sim {row.get('rows', 0) / 20:6.1f}s wall {row['harness_wall_s']:6.1f}s"
                  + (f"  ERROR {row['error'][:90]}" if row.get("error") else ""), flush=True)
            if "DA-1000" in str(row.get("error")) or "DreamAuthError" in str(row.get("error")):
                stop = True
            if stop:
                for other in pending:
                    other.cancel()
    if stop:
        print("Stopped: Dream API access was refused (DA-1000). Rerun the same command to resume.", flush=True)


# ---------- report ----------

def wilson(s, n, z=1.96):
    if n == 0:
        return (math.nan, math.nan)
    p = s / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return centre - half, centre + half


def mcnemar(wins, losses):
    n = wins + losses
    if n == 0:
        return 1.0
    k = min(wins, losses)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def median(values):
    values = sorted(v for v in values if v is not None)
    if not values:
        return None
    mid = len(values) // 2
    return values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2


def stage_times(row):
    """Simulated seconds of first contact, lift and settle for the first step (or the whole task)."""
    details = row.get("step_details") or [row]
    first = details[0]
    to_s = lambda value: None if value is None else (value + 1) / 20
    return to_s(first.get("first_contact_row")), to_s(first.get("lifted_row")), to_s(first.get("goal_row"))


def fmt(value, unit="", digits=1):
    return "—" if value is None else f"{value:.{digits}f}{unit}"


def summarize(rows):
    """Per level and arm: grades, intervals, progress, labels, stage timing, cost; paired comparisons; per seed."""
    groups = defaultdict(list)
    for row in rows:
        groups[(row["level"], row["arm"])].append(row)
    levels = []
    for level in sorted({level for level, _ in groups}):
        spec = LEVELS[level]
        arm_names = sorted(arm for lv, arm in groups if lv == level)
        arms = []
        for arm in arm_names:
            items = groups[(level, arm)]
            graded = [r for r in items if r.get("outcome") != "error"]
            wins = sum(bool(r.get("success")) for r in graded)
            low, high = wilson(wins, len(graded))
            progress = [r.get("progress", int(bool(r.get("success")))) / r.get("progress_of", 1) for r in graded]
            cost = sum(r.get("est_cost_usd") or 0 for r in items)
            stages = [stage_times(r) for r in graded]
            stage_summary = {}
            for index, name in enumerate(("contact", "lift", "settle")):
                reached = [s[index] for s in stages if s[index] is not None]
                stage_summary[name] = dict(reached=len(reached), of=len(stages), median_s=median(reached))
            arms.append(dict(
                arm=arm, label=items[0].get("arm_label"), clean=all(r.get("clean") for r in items),
                steering=sorted({s for r in items for s in r.get("steering", [])}),
                graded=len(graded), passed=wins, errors=len(items) - len(graded),
                rate=wins / len(graded) if graded else None,
                ci=[low, high] if graded else None,
                mean_progress=sum(progress) / len(progress) if progress else None,
                median_calls=median([r.get("calls") for r in graded]),
                median_success_s=median([r.get("rows", 0) / 20 for r in graded if r.get("success")]),
                cost_usd=round(cost, 3), cost_per_success=round(cost / wins, 3) if wins and cost else None,
                median_rtt_s=median([r.get("median_rtt_s") for r in graded]),
                outcomes=dict(Counter(r.get("outcome") for r in items).most_common()),
                stages=stage_summary,
                network_retries=sum(r.get("network_retries") or 0 for r in items),
            ))
        pairs = []
        for i, a in enumerate(arm_names):
            for b in arm_names[i + 1:]:
                first = {r["seed"]: r for r in groups[(level, a)] if r.get("outcome") != "error"}
                second = {r["seed"]: r for r in groups[(level, b)] if r.get("outcome") != "error"}
                shared = sorted(set(first) & set(second))
                both = sum(bool(first[s]["success"] and second[s]["success"]) for s in shared)
                only_b = sum(bool(second[s]["success"] and not first[s]["success"]) for s in shared)
                only_a = sum(bool(first[s]["success"] and not second[s]["success"]) for s in shared)
                pairs.append(dict(baseline=a, candidate=b, pairs=len(shared), both=both, only_candidate=only_b,
                                  only_baseline=only_a, neither=len(shared) - both - only_a - only_b,
                                  change_pts=100 * (only_b - only_a) / len(shared) if shared else None,
                                  p=mcnemar(only_b, only_a)))
        seeds = defaultdict(dict)
        for arm in arm_names:
            for r in groups[(level, arm)]:
                seeds[r["seed"]][arm] = dict(trial=r["trial_id"], success=bool(r.get("success")), outcome=r.get("outcome"),
                                             progress=r.get("progress", int(bool(r.get("success")))),
                                             progress_of=r.get("progress_of", 1), video=bool(r.get("video")))
        levels.append(dict(level=level, name=spec["name"], task=spec["task"], sim_seconds=spec["sim_seconds"],
                           arms=arms, pairs=pairs, seeds={str(k): v for k, v in sorted(seeds.items())}))
    return dict(levels=levels, trials=len(rows), calls=sum(r.get("calls") or 0 for r in rows),
                cost_usd=round(sum(r.get("est_cost_usd") or 0 for r in rows), 2), jitter_cm=JITTER_CM)


def report(args):
    folder = root() / args.name
    rows = [r for r in latest(read_rows(folder)) if not args.levels or r["level"] in args.levels]
    summary = summarize(rows)
    pct = lambda value: fmt(None if value is None else 100 * value, "%", 0)
    lines = [f"# Harness report: {args.name}", "",
             f"Generated {execution.now()}. Clean mode (one instruction per trial, ground truth grades only). "
             f"Start-position variation ±{JITTER_CM:g} cm. Success = every step placed, in order, and settled 1 s.", ""]
    for level in summary["levels"]:
        lines += [f"## {level['level']} · {level['name']}",
                  f"Instruction: \"{level['task']}\" · limit {level['sim_seconds']} s sim", "",
                  "| Arm | Clean | Passed | Rate (95% CI) | Mean progress | Median calls | Median sim s to success "
                  "| Est. $ / success | Errors |", "|---|---|---|---|---|---|---|---|---|"]
        for arm in level["arms"]:
            ci = arm["ci"] or [None, None]
            lines.append(
                f"| {arm['arm']} | {'yes' if arm['clean'] else 'no (' + '; '.join(arm['steering']) + ')'} "
                f"| {arm['passed']}/{arm['graded']} | {pct(arm['rate'])} ({pct(ci[0])}–{pct(ci[1])}) "
                f"| {pct(arm['mean_progress'])} | {fmt(arm['median_calls'], '', 0)} | {fmt(arm['median_success_s'], ' s')} "
                f"| {fmt(arm['cost_per_success'], '', 2)} | {arm['errors']} |")
        lines += ["", "**Where trials ended (harness failure labels)**", ""]
        for arm in level["arms"]:
            lines.append(f"- {arm['arm']}: " + ", ".join(f"{k} {v}" for k, v in arm["outcomes"].items()))
        lines += ["", "**Stage timing, first step (median simulated seconds, trials reaching the stage)**", ""]
        for arm in level["arms"]:
            lines.append(f"- {arm['arm']}: " + " · ".join(
                f"{name} {fmt(s['median_s'], ' s')} ({s['reached']}/{s['of']})" for name, s in arm["stages"].items()))
        if level["pairs"]:
            lines += ["", "**Paired on identical seeds (exact McNemar)**", "",
                      "| Baseline → candidate | Pairs | Both pass | Only candidate | Only baseline | Both fail | Change | p |",
                      "|---|---|---|---|---|---|---|---|"]
            for p in level["pairs"]:
                lines.append(f"| {p['baseline']} → {p['candidate']} | {p['pairs']} | {p['both']} | {p['only_candidate']} "
                             f"| {p['only_baseline']} | {p['neither']} | {fmt(p['change_pts'], ' pts', 0)} | {p['p']:.3f} |")
        arm_names = [arm["arm"] for arm in level["arms"]]
        lines += ["", "**Per seed**", "", "| Seed | " + " | ".join(arm_names) + " |", "|---|" + "---|" * len(arm_names)]
        for seed, cells in level["seeds"].items():
            marks = []
            for arm in arm_names:
                cell = cells.get(arm)
                if not cell:
                    marks.append("")
                    continue
                mark = "✔" if cell["success"] else cell["outcome"]
                if cell["progress_of"] > 1:
                    mark += f" {cell['progress']}/{cell['progress_of']}"
                marks.append(mark)
            lines.append(f"| {seed} | " + " | ".join(marks) + " |")
        lines.append("")
    lines += [f"Totals: {summary['trials']} trials, {summary['calls']} model calls, "
              f"about ${summary['cost_usd']:.2f} at the published $3 per 2,250 calls."]
    text = "\n".join(lines) + "\n"
    (folder / "report.md").write_text(text, encoding="utf-8")
    (folder / "summary.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    print(text)


# ---------- export ----------

def export(args):
    from . import datasets

    held_out = seeds_from(args.held_out)
    selection = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    chosen = []
    for item in selection["episodes"]:
        rows = {r["trial_id"]: r for r in latest(read_rows(root() / item["collection"]))}
        row = rows[item["trial"]]
        episode = row.get("episode") or {}
        if not row.get("success") or episode.get("error") or episode.get("frames") != row.get("rows"):
            raise SystemExit(f"{item['trial']} is not a complete successful episode.")
        if row["seed"] in held_out:
            raise SystemExit(f"{item['trial']} uses held-out seed {row['seed']}.")
        chosen.append(dict(id=f"{item['collection']}/{item['trial']}", path=Path(episode["path"]), frames=episode["frames"],
                           seed=row["seed"], level=row["level"], source=episode["source"],
                           fingerprint=row.get("initial_state_fingerprint"), why=item.get("why")))
    output = Path(args.output)
    datasets.write_dataset(output, chosen, held_out, recipe=selection.get("recipe"))
    datasets.validate(output)
    print(f"Exported and validated {len(chosen)} episodes -> {output}")


def train(args):
    """Upload a validated dataset, wait until Dream Labs has processed it, then queue one fine-tuning job."""
    import dream

    client = dream.DreamClient()
    record_path = root() / "jobs" / f"{args.suffix}.json"
    record_path.parent.mkdir(parents=True, exist_ok=True)
    record = json.loads(record_path.read_text()) if record_path.exists() else {"suffix": args.suffix}

    def save(**changes):
        record.update(changes)
        record_path.write_text(json.dumps(record, indent=2, default=str))

    if record.get("job_id"):
        job = client.get_finetuning_status(record["job_id"])
        save(job=job)
        print(json.dumps(job, indent=2, default=str))
        return
    embodiment = args.embodiment or client.get_embodiments()[0].name
    if not record.get("dataset_id"):
        dataset = client.upload_dataset(args.dataset, args.suffix, embodiment)
        save(dataset_id=dataset.id, dataset_name=dataset.name, embodiment=embodiment, episodes=dataset.episodes,
             size_bytes=dataset.size_bytes, uploaded_at=execution.now())
        print(f"Uploaded {dataset.name} ({dataset.id}), {dataset.episodes} episodes", flush=True)
    while True:
        dataset = client.get_dataset_status(record["dataset_id"])
        save(dataset_status=dataset.status, dataset_error=dataset.error)
        print(f"dataset {dataset.status}", flush=True)
        if dataset.status == "processed":
            break
        if dataset.status == "failed":
            raise SystemExit(f"Dataset processing failed: {dataset.error}")
        time.sleep(30)
    job = client.finetune(record["dataset_name"], args.suffix, steps=args.steps, lr_schedule="cosine")
    save(job_id=job["id"], job=job, submitted_at=execution.now(), steps=args.steps)
    print(json.dumps(job, indent=2, default=str))


def finetunes():
    """Saved state of each fine-tuning job (as of the last `ladder train <suffix>`) and what it trained on."""
    jobs = []
    for path in sorted((root() / "jobs").glob("*.json")):
        record = json.loads(path.read_text())
        job = record.get("job") or {}
        progress = job.get("progress") or {}
        mix = defaultdict(int)
        manifest_path = root() / "datasets" / f"{record['suffix']}-ds" / ".mission-control.json"
        recipe = None
        if manifest_path.is_file():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            recipe = manifest.get("recipe")
            for episode in manifest["episodes"]:
                mix[f"{episode['level']} {episode['source']}"] += 1
        jobs.append(dict(suffix=record["suffix"], job_id=record.get("job_id"), status=job.get("status") or record.get("dataset_status"),
                         phase=progress.get("phase"), step=progress.get("step"), total_steps=progress.get("total_steps") or record.get("steps"),
                         loss=progress.get("loss"), updated_at=progress.get("updated_at"), submitted_at=record.get("submitted_at"),
                         checkpoint=job.get("fine_tuned_model"), price_cents=job.get("price_cents"), error=job.get("error"),
                         dataset=record.get("dataset_name"), episodes=record.get("episodes"), mix=dict(sorted(mix.items())),
                         recipe=recipe if isinstance(recipe, str) else (recipe or {}).get("description")))
    return jobs


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    modes = cli.add_subparsers(dest="mode", required=True)
    r = modes.add_parser("run")
    r.add_argument("name")
    r.add_argument("--levels", nargs="+", default=["L1", "L2", "L3"], choices=list(LEVELS))
    r.add_argument("--arms", nargs="+", default=["tuned"])
    r.add_argument("--seeds", required=True, help="e.g. 2000-2019 or 1000,1003,1010-1012")
    r.add_argument("--workers", type=int, default=4)
    r.add_argument("--episodes", action="store_true", help="record synchronized training samples")
    r.add_argument("--video", action="store_true", help="record a 40 fps MP4 per trial")
    p = modes.add_parser("report")
    p.add_argument("name")
    p.add_argument("--levels", nargs="*")
    e = modes.add_parser("export")
    e.add_argument("output")
    e.add_argument("--manifest", required=True)
    e.add_argument("--held-out", required=True)
    t = modes.add_parser("train")
    t.add_argument("suffix", help="checkpoint suffix, e.g. c1-naive")
    t.add_argument("--dataset", help="validated dataset directory (first call only)")
    t.add_argument("--steps", type=int, default=1000)
    t.add_argument("--embodiment")
    a = cli.parse_args()
    {"run": run, "report": report, "export": export, "train": train}[a.mode](a)
