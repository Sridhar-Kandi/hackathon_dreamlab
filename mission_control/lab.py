"""Experiments for the console: named runs of Dream-1 (optionally inside the harness) or the scripted expert.

Each experiment is a folder under <engine>/.mission-control/lab/<id>/ holding its save file:
  experiment.json   the validated configuration
  request.json      the request the console sent (when "save request JSON" is on)
  status.json       queue state and progress
  results.jsonl     one row per (seed, trial)
  media/            one GIF per trial (when "save GIFs" is on)

Ladder collections and the bundled sample save files are listed alongside, read-only.
A single worker thread runs queued experiments one trial at a time, each trial in its own process.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from collections import Counter, defaultdict
from pathlib import Path
from uuid import uuid4

from . import execution, ladder

BASE_MODEL = execution.BASE_MODEL
USD_PER_CALL = 3 / 2250
TRIAL_TIMEOUT_S = 900
SAMPLES = Path(__file__).with_name("samples")

SCENES = {
    "stock": dict(label="Kitchen table", objects=["orange", "banana", "apple", "water_bottle"],
                  goals=["inside_bowl", "on_plate"]),
    "blocks2": dict(label="Two blocks", objects=["red_block", "blue_block"],
                    goals=["on:red_block", "on:blue_block"]),
    "blocks3": dict(label="Three blocks", objects=["yellow_block", "red_block", "blue_block"],
                    goals=["on:yellow_block", "on:red_block", "on:blue_block"]),
}
CONTROLLERS = {"dream1": "Dream-1 policy", "expert": "Scripted expert (forward kinematics)"}
FINISHED = ("completed", "completed_with_errors")
ACTIVE = ("queued", "running", "stopping")

# Outcome code -> (failure category, phase where the run stopped)
FAILURES = {
    "never_touched": ("Approach", "approach"),
    "touched_no_lift": ("Grasp", "grasp"),
    "lifted_missed_goal": ("Placement", "carry"),
    "wrong_object": ("Task logic", "approach"),
    "wrong_order": ("Task logic", "carry"),
    "partial": ("Task logic", "carry"),
    "error": ("Infrastructure", None),
}

LOCK = threading.RLock()
WAKE = threading.Event()
RUNNING = {}
CURRENT = {"id": None}  # the experiment the worker thread is running


class LabError(ValueError):
    pass


def root():
    folder = execution.engine_dir() / ".mission-control" / "lab"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def ladder_root():
    return ladder.root()


def now():
    return execution.now()


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def write_json(path, data):
    execution.write_atomic(Path(path), json.dumps(data, indent=2, allow_nan=False))


def folder_of(exp_id):
    if not re.fullmatch(r"exp-[a-f0-9]{12}", exp_id or ""):
        raise KeyError(exp_id)
    return root() / exp_id


# --- models ------------------------------------------------------------------------------------------------

def models():
    """Models an experiment can run: the base, fine-tunes started here or by the ladder, and every other
    fine-tuned checkpoint on the Dream Labs account."""
    refresh_account()
    out = [dict(id=BASE_MODEL, label="Dream-1 (base)", source="base", runnable=True)]
    for job in finetunes():
        if job.get("model_id") and not job.get("dry_run"):
            out.append(dict(id=job["model_id"], label=job.get("model_name") or f"Fine-tune {job['name']}",
                            source="console", runnable=True, finetune_id=job["id"]))
    try:
        for job in ladder.finetunes():
            if job.get("checkpoint"):
                out.append(dict(id=job["checkpoint"], label=f"Fine-tune {job['suffix']}", source="ladder", runnable=True))
    except (OSError, ValueError, KeyError):
        pass
    for job in ACCOUNT["jobs"] or []:
        if job.get("fine_tuned_model"):
            out.append(dict(id=job["fine_tuned_model"], label=f"Fine-tune {job.get('suffix')}", source="account",
                            runnable=True))
    seen = set()
    unique = []
    for model in out:
        if model["id"] not in seen:
            seen.add(model["id"])
            unique.append(model)
    return unique


# --- validation --------------------------------------------------------------------------------------------

def names_in_use(exclude=None):
    return {e["name"].casefold() for e in list_experiments() if e["id"] != exclude}


def _number(data, name, default, low, high, integer=False):
    value = data.get(name, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        raise LabError(f"{name} must be a number between {low} and {high}.")
    if integer and int(value) != value:
        raise LabError(f"{name} must be a whole number.")
    return int(value) if integer else float(value)


def _text(value, field, limit):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or not value.isprintable():
        raise LabError(f"Enter {field} as a single line of at most {limit} characters.")
    return value.strip()


def validate(data):
    """Turn a create request into a normalized experiment config. Raises LabError with a readable message."""
    from dream_harness import HarnessConfig

    if not isinstance(data, dict):
        raise LabError("Send the experiment as a JSON object.")
    name = _text(data.get("name"), "a name", 80)
    if not re.fullmatch(r"[\w .()+:#/-]+", name):
        raise LabError("Use letters, numbers, spaces and . ( ) + : # / - in the name.")
    if name.casefold() in names_in_use():
        raise LabError(f"An experiment named \"{name}\" already exists. Names must be unique.")
    description = data.get("description") or ""
    if not isinstance(description, str) or len(description) > 400:
        raise LabError("Keep the description under 400 characters.")

    controller = data.get("controller")
    if controller not in CONTROLLERS:
        raise LabError("Choose Dream-1 or the scripted expert as the controller.")
    scene = data.get("scene", "stock")
    if scene not in SCENES:
        raise LabError("Choose a supported scene.")

    steps = data.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= 6:
        raise LabError("Add between one and six steps.")
    clean_steps = []
    for index, step in enumerate(steps, 1):
        if not isinstance(step, dict):
            raise LabError(f"Step {index} is not valid.")
        target, goal = step.get("target"), step.get("goal")
        if target not in SCENES[scene]["objects"] or goal not in SCENES[scene]["goals"]:
            raise LabError(f"Step {index}: choose an object and a goal from the {SCENES[scene]['label']} scene.")
        if goal == f"on:{target}":
            raise LabError(f"Step {index}: an object cannot be placed on itself.")
        clean_steps.append(dict(instruction=_text(step.get("instruction"), f"the step {index} statement", 300),
                                target=target, goal=goal))
    instruction = " Then ".join(s["instruction"].rstrip(".") + "." for s in clean_steps)
    if len(instruction) > 400:
        raise LabError("The combined instruction is longer than 400 characters. Shorten the statements.")

    seeds = data.get("seeds")
    if (not isinstance(seeds, list) or not 1 <= len(seeds) <= 200
            or any(isinstance(s, bool) or not isinstance(s, int) or not 0 <= s < 2**31 for s in seeds)
            or len(set(seeds)) != len(seeds)):
        raise LabError("Give between 1 and 200 distinct whole-number seeds.")
    trials_per_seed = _number(data, "trials_per_seed", 1, 1, 20, integer=True)
    if len(seeds) * trials_per_seed > 400:
        raise LabError("Keep seeds × trials per seed at 400 trials or fewer.")

    config = dict(name=name, description=description.strip(), controller=controller, scene=scene,
                  steps=clean_steps, instruction=instruction, seeds=seeds, trials_per_seed=trials_per_seed,
                  sim_seconds=_number(data, "sim_seconds", 60, 5, 420),
                  jitter_cm=_number(data, "jitter_cm", 2.0, 0, 5))

    harness = data.get("harness") or {}
    if controller == "expert":
        if harness.get("enabled"):
            raise LabError("The harness wraps Dream-1. Turn it off for the scripted expert.")
        config.update(model="oracle", rows_per_reply=24, max_usd=0.0, harness=dict(enabled=False))
    else:
        known = {m["id"]: m for m in models()}
        model = data.get("model", BASE_MODEL)
        if model not in known:
            raise LabError("Choose a model from the list.")
        if not known[model]["runnable"]:
            raise LabError("This model has no published checkpoint to run yet.")
        config.update(model=model, rows_per_reply=_number(data, "rows_per_reply", 24, 1, 48, integer=True),
                      max_usd=_number(data, "max_usd", 5, 0, 500))
        if harness.get("enabled"):
            try:
                parsed = HarnessConfig.from_dict({"modules": harness.get("modules", []),
                                                  "values": harness.get("values", {})})
            except ValueError as exc:
                raise LabError(str(exc)) from None
            config["harness"] = dict(enabled=True, **parsed.to_dict())
        else:
            config["harness"] = dict(enabled=False)

    save = data.get("save") or {}
    config["save"] = dict(request_json=bool(save.get("request_json", True)), gifs=bool(save.get("gifs", False)),
                          episodes=bool(save.get("episodes", True)))
    config["kind"] = kind_of(config)
    config["estimate"] = estimate(config)
    return config


def kind_of(config):
    if config["controller"] == "expert":
        return "scripted"
    return "harness" if config.get("harness", {}).get("enabled") else "vanilla"


def estimate(config):
    trials = len(config["seeds"]) * config["trials_per_seed"]
    if config["controller"] == "expert":
        return dict(trials=trials, max_calls=0, max_usd=0.0)
    calls = int(config["sim_seconds"] * 20 / config["rows_per_reply"]) + 1
    return dict(trials=trials, max_calls=calls * trials, max_usd=round(min(calls * trials * USD_PER_CALL, config["max_usd"]), 2))


# --- store -------------------------------------------------------------------------------------------------

def create(data):
    with LOCK:
        config = validate(data)
        exp_id = "exp-" + uuid4().hex[:12]
        folder = root() / exp_id
        (folder / "media").mkdir(parents=True)
        config.update(id=exp_id, created_at=now(), source="console")
        write_json(folder / "experiment.json", config)
        if config["save"]["request_json"]:
            write_json(folder / "request.json", data)
        write_json(folder / "status.json", dict(status="queued", total=config["estimate"]["trials"], done=0,
                                                errors=0, current=None, message="Waiting for the simulator.",
                                                updated_at=now()))
    WAKE.set()
    return summary_of(config, read_json(folder / "status.json"), [])


def lab_experiments():
    out = []
    for folder in sorted(root().glob("exp-*")):
        config = read_json(folder / "experiment.json")
        if config:
            out.append((config, read_json(folder / "status.json", {}), read_rows(folder / "results.jsonl")))
    return out


def read_rows(path):
    return execution.read_lines(Path(path))


def collection_time(folder):
    """When a ladder collection was first run (its config.json lists every run with an `at` time)."""
    runs = read_json(folder / "config.json") or []
    if isinstance(runs, dict):
        runs = [runs]
    times = [run.get("at") for run in runs if isinstance(run, dict) and run.get("at")]
    return min(times) if times else None


def ladder_experiments():
    """Each (collection, arm, level) group of the ladder becomes a read-only experiment."""
    out = []
    base = ladder_root()
    if not base.is_dir():
        return out
    for folder in sorted(p for p in base.iterdir() if (p / "results.jsonl").is_file()):
        groups = defaultdict(list)
        for row in ladder.latest(ladder.read_rows(folder)):
            groups[(row.get("arm"), row.get("level"))].append(row)
        for (arm, level), rows in sorted(groups.items(), key=lambda item: (str(item[0][1]), str(item[0][0]))):
            spec = ladder.LEVELS.get(level, {})
            first = rows[0]
            sequence = spec.get("sequence") or [f"{first.get('target')}:{first.get('goal')}"]
            controller = "expert" if first.get("model") == "oracle" else "dream1"
            exp_id = f"ladder-{folder.name}-{arm}-{level}"
            config = dict(
                id=exp_id, name=f"{folder.name} · {arm} · {level}", source="ladder", readonly=True,
                description=f"{first.get('arm_label') or arm}. Ladder level {level}: {spec.get('name', '')}.",
                controller=controller, model=first.get("model"), scene=first.get("scene"),
                steps=[dict(instruction=first.get("task") if i == 0 else "", target=s.split(":", 1)[0],
                            goal=s.split(":", 1)[1]) for i, s in enumerate(sequence)],
                instruction=first.get("task"), seeds=sorted({r["seed"] for r in rows}), trials_per_seed=1,
                sim_seconds=first.get("sim_seconds"), jitter_cm=first.get("jitter_cm"),
                rows_per_reply=first.get("actions"), max_usd=None,
                harness=dict(enabled=False), save=dict(request_json=False, gifs=False),
                created_at=collection_time(folder))
            config["kind"] = "scripted" if controller == "expert" else "vanilla"
            trials = []
            for row in sorted(rows, key=lambda r: r["seed"]):
                media = f"/ladder-media/{folder.name}/{row['trial_id']}" if row.get("video") else None
                trials.append({**{k: v for k, v in row.items() if k not in ("video", "recording")},
                               "trial": 1, "media": media, "media_type": "video" if media else None})
            done = sum(t.get("outcome") != "error" for t in trials)
            status = dict(status="completed" if done == len(trials) else "completed_with_errors", total=len(trials),
                          done=len(trials), errors=len(trials) - done, current=None)
            out.append((config, status, trials))
    return out


def sample_experiments():
    out = []
    for path in sorted(SAMPLES.glob("*.json")):
        data = read_json(path)
        out.append(({**data["experiment"], "source": "sample", "readonly": True}, data["status"], data["trials"]))
    return out


def all_experiments():
    return lab_experiments() + sample_experiments() + ladder_experiments()


def summary_of(config, status, trials):
    graded = [t for t in trials if t.get("outcome") != "error"]
    wins = sum(bool(t.get("success")) for t in graded)
    total = status.get("total") or config.get("estimate", {}).get("trials") or len(trials)
    return {**{k: config.get(k) for k in ("id", "name", "description", "source", "readonly", "controller", "model",
                                          "scene", "kind", "instruction", "trials_per_seed", "created_at",
                                          "rows_per_reply", "sim_seconds")},
            "steps": len(config.get("steps") or []), "seeds": len(config.get("seeds") or []),
            "harness": bool(config.get("harness", {}).get("enabled")),
            "harness_modules": config.get("harness", {}).get("modules", []),
            "status": status.get("status", "unknown"), "message": status.get("message"),
            "total": total, "done": status.get("done", len(trials)), "errors": status.get("errors", 0),
            "current": status.get("current"), "successes": wins, "graded": len(graded),
            "success_rate": round(wins / len(graded), 4) if graded else None,
            "cost_usd": round(sum(t.get("est_cost_usd") or 0 for t in trials), 2)}


def list_experiments():
    return [summary_of(*item) for item in all_experiments()]


def find(exp_id):
    for config, status, trials in all_experiments():
        if config["id"] == exp_id:
            return config, status, trials
    raise KeyError(exp_id)


def detail(exp_id):
    config, status, trials = find(exp_id)
    request = None
    if config.get("source") == "console":
        request = read_json(folder_of(exp_id) / "request.json")
    return dict(summary=summary_of(config, status, trials), experiment=config, status=status, request=request,
                trials=trials, analytics=analytics(trials))


def analytics(trials):
    graded = [t for t in trials if t.get("outcome") != "error"]
    wins = [t for t in graded if t.get("success")]
    outcomes = Counter(t.get("outcome") or "unknown" for t in trials)
    categories = Counter(FAILURES.get(t.get("outcome"), ("Other", None))[0] for t in trials if not t.get("success"))
    interventions = Counter(i.get("reason") for t in trials for i in (t.get("interventions") or [])
                            if i.get("reason") not in (None, "latch_release", "after_place"))
    per_seed = defaultdict(lambda: dict(trials=0, successes=0, errors=0))
    for t in trials:
        entry = per_seed[t["seed"]]
        entry["trials"] += 1
        entry["successes"] += bool(t.get("success"))
        entry["errors"] += t.get("outcome") == "error"

    def mean(values):
        values = [v for v in values if isinstance(v, (int, float))]
        return round(sum(values) / len(values), 2) if values else None

    low, high = ladder.wilson(len(wins), len(graded)) if graded else (None, None)
    return dict(
        trials=len(trials), graded=len(graded), successes=len(wins), errors=len(trials) - len(graded),
        success_rate=round(len(wins) / len(graded), 4) if graded else None,
        success_ci=[round(low, 4), round(high, 4)] if graded else None,
        outcomes=dict(outcomes), failure_categories=dict(categories), interventions=dict(interventions),
        per_seed=[dict(seed=seed, **v) for seed, v in sorted(per_seed.items())],
        mean_time_to_success_s=mean([t.get("goal_row", 0) / 20 for t in wins if t.get("goal_row")]),
        mean_sim_s=mean([(t.get("rows") or 0) / 20 for t in graded]),
        mean_calls=mean([t.get("calls") for t in graded]),
        mean_wall_s=mean([t.get("wall_s") for t in trials]),
        median_rtt_s=mean([t.get("median_rtt_s") for t in trials]),
        cost_usd=round(sum(t.get("est_cost_usd") or 0 for t in trials), 2),
        max_lift_cm=[t.get("max_lift_cm") for t in graded if t.get("max_lift_cm") is not None])


def delete(exp_id):
    import shutil

    folder = folder_of(exp_id)
    status = read_json(folder / "status.json")
    if status is None:
        raise KeyError(exp_id)
    if status["status"] in ACTIVE:
        cancel(exp_id)
    # Wait for the worker to let go of this experiment before removing its files.
    deadline = time.monotonic() + 30
    while CURRENT["id"] == exp_id and time.monotonic() < deadline:
        time.sleep(0.2)
    if CURRENT["id"] == exp_id:
        raise LabError("The experiment is still stopping. Try deleting it again in a moment.")
    with LOCK:
        for attempt in range(10):
            try:
                shutil.rmtree(folder)
                break
            except FileNotFoundError:
                break
            except OSError:
                if attempt == 9:
                    raise LabError("Some files are still in use. Try deleting it again in a moment.") from None
                time.sleep(0.3)
    return dict(deleted=exp_id)


def cancel(exp_id):
    with LOCK:
        folder = folder_of(exp_id)
        status = read_json(folder / "status.json")
        if status is None:
            raise KeyError(exp_id)
        if status["status"] == "queued":
            set_status(exp_id, status="cancelled", message="Cancelled before it started.")
        elif status["status"] == "running":
            set_status(exp_id, status="stopping", message="Stopping after the current trial is interrupted.")
            proc = RUNNING.get(exp_id)
            if proc is not None:
                proc.kill()
    return summary_of(*find(exp_id))


def set_status(exp_id, **changes):
    path = folder_of(exp_id) / "status.json"
    status = read_json(path, {})
    status.update(changes, updated_at=now())
    write_json(path, status)
    return status


def export(ids):
    files = []
    for exp_id in ids:
        found = detail(exp_id)
        files.append(dict(experiment=found["experiment"], status=found["status"], request=found["request"],
                          trials=found["trials"]))
    return files


def media_path(exp_id, name):
    if not re.fullmatch(r"s\d+-t\d+\.gif", name):
        raise KeyError(name)
    return folder_of(exp_id) / "media" / name


# --- worker ------------------------------------------------------------------------------------------------

def recover():
    """Experiments left running by a previous server go back to the queue (finished trials are kept)."""
    for folder in root().glob("exp-*"):
        status = read_json(folder / "status.json")
        if status and status["status"] in ("running", "stopping"):
            state = "cancelled" if status["status"] == "stopping" else "queued"
            set_status(folder.name, status=state, current=None, message="Recovered after a server restart.")


def start_worker():
    recover()
    threading.Thread(target=worker_loop, daemon=True).start()
    WAKE.set()
    start_finetune_worker()


def next_queued():
    queued = []
    for config, status, _ in lab_experiments():
        if status.get("status") == "queued":
            queued.append(config)
    return min(queued, key=lambda c: c["created_at"]) if queued else None


def worker_loop():
    while True:
        WAKE.wait(timeout=5)
        WAKE.clear()
        while True:
            with LOCK:
                config = next_queued()
                if config is None:
                    break
                set_status(config["id"], status="running", message="Running trials.", started_at=now())
                CURRENT["id"] = config["id"]
            try:
                run_experiment(config)
            finally:
                CURRENT["id"] = None


def run_experiment(config):
    exp_id = config["id"]
    folder = folder_of(exp_id)
    done = {(r["seed"], r["trial"]) for r in read_rows(folder / "results.jsonl") if r.get("outcome") != "error"}
    for seed in config["seeds"]:
        for trial in range(1, config["trials_per_seed"] + 1):
            if (seed, trial) in done:
                continue
            if read_json(folder / "status.json", {}).get("status") == "stopping":
                return finish(exp_id, "cancelled", "Cancelled.")
            spent = sum(r.get("est_cost_usd") or 0 for r in read_rows(folder / "results.jsonl"))
            if config["controller"] == "dream1" and spent >= config["max_usd"]:
                return finish(exp_id, "completed_with_errors", "Stopped at the experiment's USD cap.")
            set_status(exp_id, current=dict(seed=seed, trial=trial, started_at=now()))
            row = run_trial_process(exp_id, seed, trial, max(0.0, (config["max_usd"] or 0) - spent))
            rows = read_rows(folder / "results.jsonl")
            rows.append(row)
            execution.write_atomic(folder / "results.jsonl", "".join(json.dumps(r, allow_nan=False) + "\n" for r in rows))
            latest = {(r["seed"], r["trial"]): r for r in rows}
            set_status(exp_id, done=len(latest), errors=sum(r.get("outcome") == "error" for r in latest.values()),
                       current=None)
    rows = {(r["seed"], r["trial"]): r for r in read_rows(folder / "results.jsonl")}
    errors = sum(r.get("outcome") == "error" for r in rows.values())
    stopping = read_json(folder / "status.json", {}).get("status") == "stopping"
    if stopping:
        return finish(exp_id, "cancelled", "Cancelled.")
    finish(exp_id, "completed_with_errors" if errors else "completed",
           f"{errors} trial(s) ended with an error." if errors else "All trials finished.")


def finish(exp_id, state, message):
    set_status(exp_id, status=state, message=message, current=None, finished_at=now())


def run_trial_process(exp_id, seed, trial, budget_usd):
    folder = folder_of(exp_id)
    out = folder / "work" / f"s{seed}-t{trial}.json"
    out.parent.mkdir(exist_ok=True)
    out.unlink(missing_ok=True)
    started = now()
    proc = subprocess.Popen([sys.executable, "-m", "mission_control.lab", "--trial", exp_id, str(seed), str(trial),
                             f"{budget_usd:.4f}"], cwd=Path(__file__).resolve().parents[1],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    RUNNING[exp_id] = proc
    try:
        proc.wait(timeout=TRIAL_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
    finally:
        RUNNING.pop(exp_id, None)
    row = read_json(out)
    if row is None:
        stopped = read_json(folder / "status.json", {}).get("status") == "stopping"
        row = dict(outcome="error", success=False,
                   error="Cancelled." if stopped else "The trial process exited or exceeded its time limit.")
    row.update(seed=seed, trial=trial, started_at=started, ended_at=now())
    return row


def trial_request(config, seed, trial):
    """The per-trial request this console hands to the runner (kept with each result)."""
    request = dict(model=config["model"], scene=config["scene"], instruction=config["instruction"],
                   steps=[f"{s['target']}:{s['goal']}" for s in config["steps"]], seed=seed, trial=trial,
                   rows_per_reply=config["rows_per_reply"], sim_seconds=config["sim_seconds"],
                   jitter_cm=config["jitter_cm"])
    if config["harness"].get("enabled"):
        request["harness"] = dict(modules=config["harness"]["modules"], values=config["harness"]["values"])
    return request


def run_one_trial(exp_id, seed, trial, budget_usd):
    """Runs inside the trial process: one call to the dreameval runner, result written as JSON."""
    folder = folder_of(exp_id)
    config = read_json(folder / "experiment.json")
    request = trial_request(config, seed, trial)
    try:
        runner, scenes = execution.import_engine()
        env = scenes.make_env(config["scene"])
        gif = folder / "media" / f"s{seed}-t{trial}.gif" if config["save"]["gifs"] else None
        steps = config["steps"]
        episode = episode_path = None
        if config["save"].get("episodes"):
            from .datasets import EpisodeRecorder
            episode_path = folder / "episodes" / f"s{seed}-t{trial}.jsonl"
            episode_path.parent.mkdir(exist_ok=True)
            episode_path.unlink(missing_ok=True)
            episode = EpisodeRecorder(episode_path)
        try:
            row = runner.run_trial(
                env, task=config["instruction"], target=steps[0]["target"], goal=steps[0]["goal"],
                scene=config["scene"], model=config["model"], seed=seed, actions=config["rows_per_reply"],
                sim_seconds=config["sim_seconds"], jitter_cm=config["jitter_cm"],
                sequence=[f"{s['target']}:{s['goal']}" for s in steps] if len(steps) > 1 else None,
                max_usd=budget_usd if config["controller"] == "dream1" else None,
                record=str(gif) if gif else None, on_sample=episode.add if episode else None,
                harness=request.get("harness") if config["harness"].get("enabled") else None)
        finally:
            env.close()
            if episode:
                episode.close()
        row.pop("trace", None)
        if episode:
            row["episode"] = dict(path=str(episode_path), frames=episode.count, error=episode.error,
                                  source="scripted_teacher" if config["model"] == "oracle" else "model_generated")
        if gif and row.get("recording"):
            row["media"] = f"/lab-media/{exp_id}/{gif.name}"
            row["media_type"] = "gif"
        row.pop("recording", None)
    except Exception as exc:
        row = dict(outcome="error", success=False, error=f"{type(exc).__name__}: {exc}"[:300])
    row["request"] = request
    write_json(folder / "work" / f"s{seed}-t{trial}.json", row)


# --- fine-tuning ---------------------------------------------------------------------------------------------
# A console fine-tune is a real Dream Labs job. One background thread moves each job through
#   preparing  -> build a LeRobot dataset from the recorded successful episodes and validate it locally
#   uploading  -> upload it (an upload interrupted earlier is picked up by name, not repeated)
#   processing -> wait for Dream Labs to process it
#   submitting -> create the paid job (a job created before a crash is found by suffix, never created twice)
#   queued / training -> poll the job until its checkpoint is published
# and ends in `completed` (model_id is the runnable checkpoint) or `failed`. The same thread refreshes the
# account's job list, so any fine-tuned model on the account shows up as runnable without a manual update.
# Jobs saved by the older dry-run simulation (dry_run=True) are still shown but never produce a model.

STAGES = (("Formatting datasets", 0.08), ("Uploading", 0.12), ("Training Dream-1", 0.75), ("Finalizing weights", 0.05))
USD_PER_STEP = 0.20
FT_POLL_S = 60
FT_ACTIVE = ("preparing", "uploading", "processing", "submitting", "queued", "training")
FT_STAGE = {"preparing": "Building dataset", "uploading": "Uploading", "processing": "Processing dataset",
            "submitting": "Submitting job", "queued": "Queued", "training": "Training Dream-1",
            "completed": "Completed", "failed": "Failed"}
FT_PHASE = {"waiting_for_gpu": "Waiting for a GPU", "preparing": "Preparing training", "saving": "Saving checkpoint"}
FT_WAKE = threading.Event()
FT_THREAD = {"thread": None}
ACCOUNT = {"at": 0.0, "jobs": None, "queue": None, "error": None, "updated_at": None}
ACCOUNT_LOCK = threading.Lock()


def finetune_root():
    folder = root() / "finetunes"
    folder.mkdir(exist_ok=True)
    return folder


def training_episodes(exp_id, trials):
    """Successful trials whose aligned episode was recorded completely: what a fine-tune can train on."""
    out = []
    for t in trials:
        episode = t.get("episode") or {}
        path = episode.get("path")
        if (t.get("success") and path and not episode.get("error") and episode.get("frames")
                and episode["frames"] == t.get("rows") and Path(path).is_file()):
            out.append(dict(id=f"{exp_id}/s{t.get('seed')}-t{t.get('trial', 1)}", path=str(path),
                            frames=episode["frames"], seed=t.get("seed"),
                            source=episode.get("source") or "model_generated",
                            fingerprint=t.get("initial_state_fingerprint")))
    return out


def start_finetune(data):
    if not isinstance(data, dict):
        raise LabError("Send the fine-tune request as a JSON object.")
    name = _text(data.get("name"), "a fine-tune name", 40).lower()
    if not re.fullmatch(r"[a-z0-9-]{1,40}", name):
        raise LabError("Use lowercase letters, numbers and dashes in the fine-tune name (up to 40 characters).")
    if any(job["name"] == name for job in finetunes()):
        raise LabError(f"A fine-tune named \"{name}\" already exists.")
    if any(job.get("suffix") == name for job in ACCOUNT.get("jobs") or []):
        raise LabError(f"Your Dream Labs account already has a fine-tune named \"{name}\". Choose another name.")
    if data.get("confirm_charge") is not True:
        raise LabError("Confirm the Dream Labs charge to start a real fine-tune.")
    if not execution.credential_source():
        raise LabError("No Dream API key is configured. Restart with --prompt-key or log in to Dream Labs.")
    steps = _number(data, "steps", 1000, 500, 10000, integer=True)
    if steps % 100:
        raise LabError("Training steps must be a multiple of 100 between 500 and 10,000.")
    ids = data.get("experiment_ids")
    if not isinstance(ids, list) or not ids or len(ids) > 20:
        raise LabError("Select between one and twenty experiments to fine-tune on.")
    picks = data.get("trials")
    if picks is not None and (not isinstance(picks, list) or not all(
            isinstance(p, dict) and p.get("experiment_id") in ids for p in picks)):
        raise LabError("List the trials to train on as {experiment_id, seed, trial} from the selected experiments.")
    sources, episodes, available = [], [], {}
    for exp_id in ids:
        config, status, trials = find(exp_id)
        if status.get("status") not in FINISHED:
            raise LabError(f"\"{config['name']}\" has not finished running, so it has no data to train on yet.")
        chosen = training_episodes(exp_id, trials)
        sources.append(dict(id=exp_id, name=config["name"], kind=config.get("kind"), trials=len(trials),
                            successes=sum(bool(t.get("success")) for t in trials), episodes=len(chosen)))
        episodes += chosen
        for episode in chosen:
            available[episode["id"]] = episode
    if picks is not None:
        # The Analyze pipeline names the exact trajectories of its dataset mix; repeats weight an episode.
        wanted = [f"{p['experiment_id']}/s{p.get('seed')}-t{p.get('trial', 1)}" for p in picks]
        missing = [w for w in wanted if w not in available]
        if missing:
            raise LabError(f"{len(missing)} of the planned trajectories have no recorded episode (first: {missing[0]}). "
                           "Rerun those experiments with \"Record training episodes\" on.")
        episodes = [available[w] for w in wanted]
    if not episodes:
        raise LabError("None of the selected experiments has a recorded successful episode to train on. Run an "
                       "experiment with \"Record training episodes\" on (the scripted expert is the quickest source).")
    job = dict(id="ftl-" + uuid4().hex[:12], name=name, suffix=name, base_model=BASE_MODEL, steps=steps,
               sources=sources, episodes=episodes, dataset=None, created_at=now(), dry_run=False,
               state="preparing", estimated_usd=round(steps * USD_PER_STEP, 2))
    write_json(finetune_root() / f"{job['id']}.json", job)
    start_finetune_worker()
    FT_WAKE.set()
    return finetune_view(job)


def _dry_view(job):
    """The view of a job saved by the older dry-run simulation."""
    elapsed = time.time() - job["started"]
    fraction = min(1.0, elapsed / job["duration_s"])
    stage, start = STAGES[-1][0], 0.0
    for label, share in STAGES:
        if fraction < start + share:
            stage = label
            break
        start += share
    view = {k: v for k, v in job.items() if k != "started"}
    view.update(progress=round(fraction, 4), stage=stage if fraction < 1 else "Completed",
                status="completed" if fraction >= 1 else "running",
                eta_s=round(max(0.0, job["duration_s"] - elapsed)),
                step=int(job["steps"] * min(1.0, max(0.0, (fraction - 0.2) / 0.75))))
    return view


def _seconds_since(stamp):
    try:
        from datetime import datetime
        return max(0.0, time.time() - datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def finetune_view(job):
    if job.get("dry_run"):
        return _dry_view(job)
    state = job.get("state", "preparing")
    remote = job.get("remote") or {}
    progress = remote.get("progress") or {}
    total = progress.get("total_steps") or job["steps"]
    step = progress.get("step") or 0
    phase = progress.get("phase")
    fixed = {"preparing": 0.02, "uploading": 0.06, "processing": 0.10, "submitting": 0.13, "queued": 0.15,
             "completed": 1.0}
    fraction = fixed.get(state, 0.15 + 0.8 * min(1.0, step / total))
    if state == "training" and phase == "saving":
        fraction = 0.96
    stage = FT_PHASE.get(phase, FT_STAGE[state]) if state == "training" else FT_STAGE.get(state, state)
    eta = None
    started = _seconds_since(remote["started_at"]) if remote.get("started_at") else None
    if state == "training" and step and started:
        eta = round(started / step * max(0, total - step) + 120)
    view = {k: v for k, v in job.items() if k != "episodes"}
    view.update(episodes=len(job.get("episodes") or []), progress=round(fraction, 4), stage=stage,
                status="completed" if state == "completed" else "failed" if state == "failed" else "running",
                step=step, eta_s=eta, queue_position=remote.get("queue_position"), loss=progress.get("loss"),
                charge=remote.get("charge"),
                price_usd=remote["price_cents"] / 100 if remote.get("price_cents") else None)
    return view


def finetunes():
    jobs = [read_json(p) for p in sorted(finetune_root().glob("ftl-*.json"))]
    return sorted((finetune_view(j) for j in jobs if j), key=lambda j: j["created_at"], reverse=True)


def save_model(job_id, data):
    if not re.fullmatch(r"ftl-[a-f0-9]{12}", job_id or ""):
        raise KeyError(job_id)
    path = finetune_root() / f"{job_id}.json"
    job = read_json(path)
    if job is None:
        raise KeyError(job_id)
    if finetune_view(job)["status"] != "completed":
        raise LabError("Wait for the fine-tune to finish before saving its model.")
    job["model_name"] = _text((data or {}).get("name"), "a model name", 60)
    write_json(path, job)
    return finetune_view(job)


# --- fine-tuning worker ------------------------------------------------------------------------------------

def start_finetune_worker():
    with LOCK:
        thread = FT_THREAD["thread"]
        if thread is None or not thread.is_alive():
            FT_THREAD["thread"] = threading.Thread(target=finetune_loop, daemon=True, name="finetune")
            FT_THREAD["thread"].start()


def finetune_loop():
    while True:
        refresh_account(force=True)
        for path in sorted(finetune_root().glob("ftl-*.json")):
            job = read_json(path)
            if not job or job.get("dry_run") or job.get("state") not in FT_ACTIVE:
                continue
            try:
                advance_finetune(path, job)
            except Exception as exc:  # network trouble and the like: keep the state and try again next pass
                job["last_error"] = f"{type(exc).__name__}: {exc}"[:300]
                job["last_error_at"] = now()
                write_json(path, job)
        FT_WAKE.wait(FT_POLL_S)
        FT_WAKE.clear()


def advance_finetune(path, job):
    import dream
    from dream import fine_tuning

    from . import datasets

    client = dream.DreamClient()

    def save(**changes):
        job.update(changes, last_error=None, updated_at=now())
        write_json(path, job)

    def apply_remote(remote):
        checkpoint = remote.get("fine_tuned_model")
        status = remote.get("status")
        if checkpoint:
            state = "completed"
        elif status in ("failed", "cancelled"):
            state = "failed"
        else:
            state = "queued" if status == "queued" else "training"
        save(state=state, job_id=remote.get("id"), model_id=checkpoint,
             error=(remote.get("error") or f"The Dream Labs job was {status}.") if state == "failed" else None,
             remote={k: remote.get(k) for k in ("status", "progress", "queue_position", "price_cents", "charge",
                                                 "charged_cents", "started_at", "finished_at", "notice")})

    while job.get("state") in FT_ACTIVE:
        state = job["state"]
        if state == "preparing":
            folder = path.with_suffix("")
            data = folder / "data"
            if data.exists():
                shutil.rmtree(data)
            folder.mkdir(exist_ok=True)
            chosen = [dict(e, path=Path(e["path"])) for e in job["episodes"]]
            try:
                datasets.write_dataset(data, chosen, [], recipe=dict(
                    description=f"Console fine-tune {job['name']}: {len(chosen)} successful episodes from "
                                + ", ".join(s["name"] for s in job["sources"])))
                datasets.validate(data)
            except (ValueError, OSError, KeyError) as exc:
                save(state="failed", error=f"Could not build a valid dataset: {exc}"[:300])
                return
            save(state="uploading", dataset_path=str(data))
        elif state == "uploading":
            dataset_name = job.get("dataset_upload_name") or f"console-{job['id'][4:]}"
            embodiment = job.get("embodiment") or client.get_embodiments()[0].name
            save(dataset_upload_name=dataset_name, embodiment=embodiment)
            found = [d for d in client.get_datasets() if d.name.endswith("/" + dataset_name)]
            dataset = (found[0] if found and found[0].status not in ("failed", "uploading")
                       else client.upload_dataset(job["dataset_path"], dataset_name, embodiment))
            save(state="processing", dataset_id=dataset.id, dataset_name=dataset.name, dataset_status=dataset.status)
        elif state == "processing":
            dataset = client.get_dataset_status(job["dataset_id"])
            if dataset.status == "processed":
                save(state="submitting", dataset_status=dataset.status)
            elif dataset.status == "failed":
                save(state="failed", dataset_status=dataset.status,
                     error=f"Dream Labs could not process the dataset: {dataset.error}"[:300])
                return
            else:
                save(dataset_status=dataset.status)
                return
        elif state == "submitting":
            match = next((j for j in fine_tuning.list()
                          if j.get("suffix") == job["suffix"] and j.get("dataset") == job["dataset_name"]), None)
            if match is None:
                try:
                    match = client.finetune(job["dataset_name"], job["suffix"], steps=job["steps"], lr_schedule="cosine")
                except dream.DreamServerError as exc:
                    if getattr(exc, "retryable", False):
                        raise
                    save(state="failed", error=f"Dream Labs refused the job ({getattr(exc, 'code', 'error')}): {exc}"[:300])
                    return
                save(submitted_at=now())
            apply_remote(match)
            refresh_account(force=True)
        else:  # queued / training
            apply_remote(client.get_finetuning_status(job["job_id"]))
            return


# --- account ---------------------------------------------------------------------------------------------------

def refresh_account(force=False):
    """Cache the account's fine-tuning jobs and the training queue (Dream Labs has no balance endpoint)."""
    if not force and time.time() - ACCOUNT["at"] < FT_POLL_S:
        return
    with ACCOUNT_LOCK:
        if not force and time.time() - ACCOUNT["at"] < FT_POLL_S:
            return
        ACCOUNT["at"] = time.time()
        if not execution.credential_source():
            ACCOUNT.update(error="No Dream API key is configured.")
            return
        try:
            from dream import fine_tuning
            jobs, queue = fine_tuning.list(), fine_tuning.queue()
        except Exception as exc:
            ACCOUNT.update(error=f"{type(exc).__name__}: {exc}"[:200])
            return
        ACCOUNT.update(jobs=jobs, queue=queue, error=None, updated_at=now())


def account():
    start_finetune_worker()
    refresh_account()
    jobs = ACCOUNT["jobs"] or []
    charged = sum(j.get("charged_cents") or 0 for j in jobs if j.get("charge") == "charged") / 100
    held = sum(j.get("price_cents") or 0 for j in jobs if j.get("charge") == "held") / 100
    try:
        budget = float(os.environ["DREAM_FINETUNE_BUDGET_USD"])
    except (KeyError, ValueError):
        budget = None
    return dict(
        balance_api=False,
        note="Dream Labs does not publish an account balance; these totals add up your fine-tuning jobs' charges.",
        charged_usd=round(charged, 2), held_usd=round(held, 2), budget_usd=budget,
        remaining_usd=round(budget - charged - held, 2) if budget is not None else None,
        usd_per_step=USD_PER_STEP, jobs=len(jobs),
        active=sum(j.get("status") in ("queued", "running") for j in jobs),
        models=[dict(id=j["fine_tuned_model"], suffix=j.get("suffix"), finished_at=j.get("finished_at"))
                for j in jobs if j.get("fine_tuned_model")],
        queue=ACCOUNT["queue"], updated_at=ACCOUNT["updated_at"], error=ACCOUNT["error"])


def meta():
    from dream_harness import MODULES, STEERING_MODULES, describe

    return dict(scenes=SCENES, controllers=CONTROLLERS, models=models(),
                harness=dict(modules=list(MODULES), steering=list(STEERING_MODULES), settings=describe()),
                defaults=dict(sim_seconds=60, rows_per_reply=24, jitter_cm=2.0, max_usd=5, trials_per_seed=1),
                usd_per_call=USD_PER_CALL)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--trial", nargs=4, metavar=("EXPERIMENT", "SEED", "TRIAL", "BUDGET_USD"), required=True)
    args = parser.parse_args()
    exp, seed_text, trial_text, budget = args.trial
    run_one_trial(exp, int(seed_text), int(trial_text), float(budget))
