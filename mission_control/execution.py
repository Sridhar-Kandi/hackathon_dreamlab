"""Local launch, preflight and cancellation for the existing dreameval runner."""

import argparse
import base64
from collections import deque
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from uuid import uuid4

from . import plans


BASE_MODEL = "dreamlabs/dream-1-beta"
USD_PER_REPLY = 3 / 2250
ALLOCATIONS = {"connectivity": 8, "primary": 20, "paired": 36, "secondary": 8, "demo": 12, "reserve": 36}
CAMERAS = {"top": "overhead", "left": "wrist_l", "right": "wrist_r"}
PRESETS = [
    (plans.COMPOUND, "Tabletop placement sequence", "stock", "orange", "inside_bowl", plans.DEFAULT_INSTRUCTION),
    ("orange-bowl", "Single placement · Orange in bowl", "stock", "orange", "inside_bowl", "Put the orange into the bowl."),
    ("banana-plate", "Single placement · Banana on plate", "stock", "banana", "on_plate", "Put the banana on the plate."),
    ("tube-racks", "Tube sorting", "racks", "red_tube", "in:red_rack", "Put the red tube in the red rack and the blue tube in the blue rack."),
    ("hold-fill", "Two-arm cup and tube placement", "hold_fill", "red_tube", "in:cup", "Hold the cup up with the left arm and put the red tube into it with the right arm."),
    ("block-stack", "Two-block stack", "blocks2", "red_block", "on:blue_block", "Put the red block on the blue block."),
]
ACTIVE = {}
LOCK = threading.RLock()
ACTIVE_STATES = {"queued", "running", "stopping"}
ATTEMPT_TIMEOUT = 600


class AdmissionError(ValueError):
    pass


def tasks():
    return [dict(id=key, label=label, scene=scene, target=obj, goal=goal,
                 instruction=prompt, model=BASE_MODEL, models=[BASE_MODEL, "oracle"])
            for key, label, scene, obj, goal, prompt in PRESETS]


def engine_dir():
    return Path(os.environ.get("DREAMEVAL_DIR", Path(__file__).resolve().parents[1] / "dreameval")).resolve()


def results_dir():
    return engine_dir() / ".mission-control" / "runs"


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def validate_config(payload):
    if not isinstance(payload, dict):
        raise ValueError("Send an experiment configuration as a JSON object.")
    allowed = {"task_id", "scene", "model", "instruction", "actions", "trials", "sim_seconds",
               "seed", "seed0", "seeds", "jitter_cm", "record", "max_usd", "purpose", "max_credits",
               "request_cap", "record_episode"}
    if set(payload) - allowed:
        raise ValueError("The configuration contains an unsupported setting.")
    task = next((t for t in tasks() if t["id"] == payload.get("task_id", plans.COMPOUND)), None)
    if task is None:
        raise ValueError("Choose a supported task.")
    if payload.get("scene", task["scene"]) != task["scene"]:
        raise ValueError("The selected task requires the " + task["scene"] + " scene.")
    if "seed" in payload and "seed0" in payload and payload["seed"] != payload["seed0"]:
        raise ValueError("The starting seed is ambiguous.")
    model = payload.get("model", BASE_MODEL)
    if model not in (BASE_MODEL, "oracle"):
        raise ValueError("Choose the supported Dream-1 model or the scripted oracle.")
    instruction = payload.get("instruction", task["instruction"])
    if not isinstance(instruction, str) or not 1 <= len(instruction.strip()) <= 400 or not instruction.isprintable():
        raise ValueError("Enter a single-line instruction between 1 and 400 characters.")
    if "dl_live_" in instruction or "DREAM_API_KEY" in instruction:
        raise ValueError("Remove credentials from the instruction.")
    config = dict(task_id=task["id"], scene=task["scene"], instruction=instruction.strip(), model=model)
    for name, default, low, high, integer in [
        ("actions", 24, 1, 48, True), ("trials", 1, 1, 20, True),
        ("seed0", payload.get("seed", 0), 0, 2**31 - 20, True),
        ("sim_seconds", 60, 1, 420, False), ("jitter_cm", 0, 0, 2, False),
        ("max_credits", 8, 0, 120, False), ("max_usd", 1, 0, 100, False),
        ("request_cap", 60, 1, 8400, True),
    ]:
        val = payload.get(name, default)
        if type(val) not in (int, float) or not low <= val <= high or (integer and type(val) != int):
            raise plans.InvalidPlan(f"{name} must be {'an integer' if integer else 'a number'} between {low} and {high}.", name)
        config[name] = val
    config["record"] = payload.get("record", True)
    config["record_episode"] = payload.get("record_episode", False)
    config["purpose"] = payload.get("purpose", "connectivity")
    if (type(config["record"]) is not bool or type(config["record_episode"]) is not bool
            or config["purpose"] not in tuple(ALLOCATIONS)):
        raise ValueError("Choose a valid recording setting and testing allocation.")
    if config["record_episode"] and task["id"] != plans.COMPOUND:
        raise plans.InvalidPlan("Episode recording requires the compound preset.", "record_episode")
    seeds = payload.get("seeds", list(range(config["seed0"], config["seed0"] + config["trials"])))
    if (not isinstance(seeds, list) or len(seeds) != config["trials"]
            or any(type(seed) is not int or not 0 <= seed < 2**31 for seed in seeds)
            or len(set(seeds)) != len(seeds)):
        raise plans.InvalidPlan("Provide one distinct nonnegative integer seed per trial.", "seeds")
    config["seeds"] = seeds
    return config


def preview(payload):
    config = validate_config(payload)
    preset = next(t for t in tasks() if t["id"] == config["task_id"])
    plan = plans.review(config, preset)
    rate = quote() if config["model"] != "oracle" else None
    requests = 0 if config["model"] == "oracle" else config["request_cap"] * config["trials"]
    return {"config": config, "plan": plan, "estimate": {
        "max_requests": requests, "max_credits": rate[0] * requests / 1e6 if rate else None,
        "usd": round(USD_PER_REPLY * requests, 4),
    }}


def quote():
    """An operator supplies a current provider-confirmed upper bound for this exact account/model."""
    if os.environ.get("MISSION_CONTROL_LIVE") != "1":
        return None
    try:
        q = json.loads(Path(os.environ["MISSION_CONTROL_QUOTE"]).read_text(encoding="utf-8"))
        rate = Decimal(str(q["max_credits_per_sdk_call"]))
        allowance = Decimal(str(q["available_testing_credits"]))
        valid_until = datetime.fromisoformat(q["expires_at"])
        valid = (q["model"] == BASE_MODEL and q["currency"] == "hackathon_testing_credits"
                 and q["other_sdk_operations_free"] is True and q["includes_sdk_retries"] is True
                 and isinstance(q["provider_reference"], str) and q["provider_reference"].strip()
                 and valid_until > datetime.now(timezone.utc) and 0 < rate <= allowance <= 120
                 and rate.as_tuple().exponent >= -6 and allowance.as_tuple().exponent >= -6)
        if valid:
            return int(rate * 1_000_000), int(allowance * 1_000_000)
    except (OSError, KeyError, ValueError, TypeError, InvalidOperation, OverflowError):
        pass
    return None


def budget():
    rate = quote()
    reserved = 0
    ledger = engine_dir() / ".mission-control" / "spend.sqlite3"
    if ledger.exists():
        with sqlite3.connect(ledger) as db:
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='requests'").fetchone():
                reserved = db.execute("SELECT coalesce(sum(microcredits),0) FROM requests").fetchone()[0]
    return {"testing_limit": 120, "training_limit": 1000, "protected_reserve": 36,
            "allocations": ALLOCATIONS, "unit": "credits", "price_verified": bool(rate),
            "live_enabled": bool(rate), "account_balance": None, "estimated_usd_per_call": USD_PER_REPLY,
            "reserved_credit_upper_bound": reserved / 1e6,
            "credit_upper_bound_per_call": rate[0] / 1e6 if rate else None,
            "details": "USD estimate uses $3 per 2,250 Dream-1 replies. Hackathon credit pricing and balance require separate provider confirmation."}


def credential_source():
    """Report the SDK credential source without returning the credential."""
    key = os.environ.get("DREAM_API_KEY")
    if key is not None:
        return "DREAM_API_KEY" if key.strip() else None
    try:
        sim_key = Path.home() / ".config" / "dream-yam-sim" / "credentials.json"
        if sim_key.is_file() and json.loads(sim_key.read_text(encoding="utf-8")).get("api_key"):
            return "Dream YAM Sim login"
    except (OSError, ValueError, AttributeError):
        pass
    try:
        path = Path(os.environ.get("DREAM_CREDENTIALS", "~/.dreamlabs/credentials")).expanduser()
        for line in path.read_text(encoding="utf-8").splitlines():
            name, sep, value = line.removeprefix("export ").partition("=")
            if sep and name.strip() == "DREAM_API_KEY" and " ".join(shlex.split(value, comments=True)).strip():
                return "Dream Labs credentials file"
    except (OSError, ValueError):
        pass
    return None


def reserve_call(run_id, config, *, check_only=False, count=1):
    """Debit the conservative ceiling before every request, including uncertain or failed calls."""
    rate = quote()
    if not rate:
        raise RuntimeError("BUDGET_STOPPED: authorization or provider quote unavailable")
    unit, allowance = rate
    purpose = config["purpose"]
    ledger_dir = engine_dir() / ".mission-control"
    ledger_dir.mkdir(exist_ok=True)
    with sqlite3.connect(ledger_dir / "spend.sqlite3") as db:
        db.execute("CREATE TABLE IF NOT EXISTS requests (run TEXT, purpose TEXT, microcredits INTEGER)")
        db.execute("BEGIN IMMEDIATE")
        total, group, experiment, calls = db.execute(
            "SELECT coalesce(sum(microcredits),0), "
            "coalesce(sum(CASE WHEN purpose=? THEN microcredits END),0), "
            "coalesce(sum(CASE WHEN run=? THEN microcredits END),0), count(CASE WHEN run=? THEN 1 END) "
            "FROM requests", (purpose, run_id, run_id)).fetchone()
        ceiling = unit * count
        if (total + ceiling > min(120_000_000, allowance)
                or group + ceiling > ALLOCATIONS[purpose] * 1_000_000
                or experiment + ceiling > config["max_credits"] * 1_000_000
                or (calls + count) * USD_PER_REPLY > config["max_usd"]):
            raise RuntimeError("BUDGET_STOPPED: bounded usage exceeds the authorized limit")
        if not check_only:
            db.execute("INSERT INTO requests VALUES (?,?,?)", (run_id, purpose, unit))


def import_engine():
    sys.path.insert(0, str(engine_dir()))
    import runner
    import scenes
    return runner, scenes


def missing_simulator_dependencies():
    return [name for name in ("dream", "mujoco", "dream_examples", "numpy", "PIL")
            if importlib.util.find_spec(name) is None]


def probe(scene):
    import numpy as np
    from PIL import Image
    runner, scenes = import_engine()
    dc = runner.dc
    env = scenes.make_env(scene)
    try:
        def check(name, okay, detail):
            return {"name": name, "status": "ok" if okay else "blocked", "detail": detail}
        checks = []
        state = env.state()
        good_state = all(np.shape(state.get(side)) == (7,) and np.isfinite(state[side]).all()
                         for side in ("left", "right"))
        checks.append(check("Robot state", good_state, "Both arms require six finite joint positions and one gripper value."))
        windows = {name: deque(maxlen=dc.FRAMES) for name in CAMERAS}
        start_time = env.data.time
        for step in range((dc.FRAMES - 1) * dc.FRAME_EVERY_STEPS + 1):
            env.step(state["left"], state["right"])
            if step % dc.FRAME_EVERY_STEPS == 0:
                runner.capture(env, windows)
        for name, role in CAMERAS.items():
            okay = dc.VIDEO_ROLES.get(name) == role and len(windows[name]) == dc.FRAMES and env.data.time > start_time
            if okay:
                for jpeg in windows[name]:
                    with Image.open(io.BytesIO(base64.b64decode(jpeg, validate=True))) as frame:
                        okay = okay and frame.size == tuple(dc.FRAME_SIZE) and frame.mode == "RGB" and bool(frame.getbbox())
            unique = len(set(windows[name]))
            checks.append(check(role, okay, f"{len(windows[name])} frames rendered as simulation advanced, {unique} distinct. Checked role, JPEG, dimensions and nonblack pixels."))
        dc.observation(env, windows, "Preflight", BASE_MODEL, station=BASE_MODEL in dc.POSE_MODELS)
        return checks
    finally:
        env.close()


def preflight(payload, run_id="", trials=None):
    reviewed = preview(payload)
    c = reviewed["config"]
    engine = engine_dir()
    checks = []
    def add(name, valid, detail):
        checks.append({"name": name, "status": "ok" if valid else "blocked", "detail": detail})
    present = all((engine / f).is_file() for f in ("runner.py", "sweep.py", "scenes.py", "detectors.py"))
    add("Evaluation engine", present, "Located dreameval." if present else "Point DREAMEVAL_DIR to the checkout's dreameval directory.")
    missing = missing_simulator_dependencies()
    deps = not missing
    add("Simulator dependencies", deps, f"Missing {', '.join(missing)}. See the simulator setup in README." if missing else "Dream SDK, YAM assets and MuJoCo are installed.")
    if engine.is_dir():
        free = shutil.disk_usage(engine).free
        add("Result storage", os.access(engine, os.W_OK) and free >= 64 * 1024**2,
            f"{free / 1024**3:.1f} GiB free in the engine filesystem.")
    if c["model"] != "oracle":
        source = credential_source()
        add("Credentials", bool(source), f"Found via {source}. Service authentication is unchecked." if source else "Supply a key using --prompt-key or the SDK credentials file.")
        rate = quote()
        add("Live authorization and credit price", bool(rate), "Requires operator authorization and a current provider-confirmed credit ceiling.")
        if rate and present:
            try:
                count = c["request_cap"] * (c["trials"] if trials is None else trials)
                reserve_call(run_id, c, check_only=True, count=count)
                add("Experiment allowance", True, "The configured request cap fits the verified local allowance.")
            except (OSError, RuntimeError, sqlite3.Error):
                add("Experiment allowance", False, "The request cap exceeds an allowance, or the spending ledger is unavailable.")
    if present and deps:
        try:
            proc = subprocess.run([sys.executable, "-m", "mission_control.execution", "--probe", c["scene"]],
                                  capture_output=True, timeout=45)
            checks.extend(json.loads(proc.stdout))
        except (ValueError, OSError, subprocess.TimeoutExpired):
            add("Camera and state probe", False, "The YAM scene could not render a complete model observation. Check the simulator install and graphics backend.")
    else:
        for role in CAMERAS.values():
            checks.append({"name": role, "status": "unchecked", "detail": "Awaiting a local simulator render."})
    return {**reviewed, "ready": all(item["status"] == "ok" for item in checks), "checks": checks}


def run_dir(run_id):
    if not isinstance(run_id, str) or not re.fullmatch(r"mc-[a-f0-9]{12}", run_id):
        raise ValueError("Unknown Mission Control experiment.")
    return results_dir() / run_id


def write_atomic(path, text):
    pending = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    pending.write_text(text, encoding="utf-8")
    pending.replace(path)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def status(run_id):
    try:
        return read_json(run_dir(run_id) / "status.json")
    except FileNotFoundError as exc:
        raise KeyError(run_id) from exc


def update(run_id, **changes):
    current = status(run_id)
    current.update(changes, updated_at=now())
    write_atomic(run_dir(run_id) / "status.json", json.dumps(current))
    return current


def jobs():
    found = []
    for path in sorted(results_dir().glob("mc-*/status.json"), reverse=True):
        try:
            found.append(status(path.parent.name))
        except (ValueError, OSError):
            continue
    return sorted(found, key=lambda j: j["created_at"], reverse=True)


@contextmanager
def exclusive(name):
    """Hold an OS lock until this process closes its file handle."""
    folder = engine_dir() / ".mission-control"
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / name).open("a+b") as handle:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def slot_rows(folder):
    results = {}
    for row in read_lines(folder / "results.jsonl"):
        results[row["seed"]] = row
    return results


def read_lines(path):
    try:
        rows = path.read_bytes().splitlines(keepends=True)
    except FileNotFoundError:
        return []
    return [json.loads(line) for line in rows if line.endswith(b"\n") and line.strip()]


def recover():
    for job in jobs():
        if job["status"].lower() not in ACTIVE_STATES:
            continue
        run_id = job["id"]
        folder = run_dir(run_id)
        committed = slot_rows(folder)
        if job["status"].lower() == "stopping":
            state = "cancelled"
        elif all(seed in committed and committed[seed].get("outcome") != "error"
                 for seed in job["config"].get("seeds", range(job["config"]["seed0"],
                      job["config"]["seed0"] + job["config"]["trials"]))):
            state = "completed"
        else:
            state = "interrupted"
        active = job.get("active_attempt")
        if active and not any(row.get("attempt_id") == active["id"] for row in read_lines(folder / "results.jsonl")):
            config = job["config"]
            saved = read_json(folder / "config.json")
            row = dict(task=config["instruction"], model=config["model"], actions=config["actions"],
                       scene=config["scene"], target=saved["target"], goal=saved["goal"], seed=active["seed"],
                       jitter_cm=config["jitter_cm"], sim_seconds=config["sim_seconds"], sequence=saved.get("sequence"),
                       outcome="error", success=False, stop_code=state, error="Dashboard exited during the attempt.",
                       attempt_id=active["id"], attempt_number=active["number"], started_at=active["started_at"],
                       ended_at=now())
            output = folder / "results.jsonl"
            write_atomic(output, "".join(json.dumps(item) + "\n" for item in [*read_lines(output), row]))
            committed[row["seed"]] = row
        update(run_id, status=state, current_seed=None, active_attempt=None,
               completed=sum(row["outcome"] != "error" for row in committed.values()),
               errors=sum(row["outcome"] == "error" for row in committed.values()),
               message="Recovered committed results after a dashboard restart.")


def progress(job):
    active = job.get("active_attempt")
    if not active:
        return job
    folder = run_dir(job["id"]) / "attempts" / active["id"]
    try:
        snapshot = read_json(folder / "heartbeat.json")
    except FileNotFoundError:
        snapshot = None
    return {**job, "live": snapshot,
            "events": read_lines(folder / "events.jsonl")[-60:]}


def run_batch(run_id):
    folder = run_dir(run_id)
    saved = read_json(folder / "config.json")
    config = status(run_id)["config"]
    previous = slot_rows(folder)
    try:
        for seed in config["seeds"]:
            if seed in previous and previous[seed]["outcome"] != "error":
                continue
            with LOCK:
                if status(run_id)["status"] == "stopping":
                    break
                if config["model"] != "oracle":
                    reserve_call(run_id, config, check_only=True, count=config["request_cap"])
                attempt_id = uuid4().hex
                attempt_dir = folder / "attempts" / attempt_id
                attempt_dir.mkdir(parents=True)
                attempt = dict(id=attempt_id, seed=seed, started_at=now(),
                               number=1 + sum(r.get("seed") == seed for r in read_lines(folder / "results.jsonl")),
                               watchdog_s=ATTEMPT_TIMEOUT)
                write_atomic(attempt_dir / "claim.json", json.dumps(attempt))
                update(run_id, status="running", current_seed=seed, active_attempt=attempt, message="Simulation in progress.")
                proc = subprocess.Popen([sys.executable, "-m", "mission_control.execution", "--attempt", run_id, attempt_id],
                                        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + ATTEMPT_TIMEOUT
                while proc.poll() is None:
                    if (attempt_dir / "stop").exists():
                        deadline = min(deadline, time.monotonic() + 8)
                    if time.monotonic() >= deadline:
                        proc.kill()
                        break
                    time.sleep(0.2)
                proc.wait()
            finally:
                proc.stdin.close()
            with LOCK:
                stopping = status(run_id)["status"] == "stopping"
                try:
                    row = read_json(attempt_dir / "result.json")
                except FileNotFoundError:
                    row = {"outcome": "error", "success": False,
                           "error": "Attempt cancelled." if stopping else "The attempt exited or exceeded its wall time limit.",
                           "stop_code": "cancelled" if stopping else "worker_exit"}
                row.update(task=config["instruction"], model=config["model"], actions=config["actions"],
                           scene=config["scene"], goal=saved["goal"], target=saved["target"],
                           seed=seed, jitter_cm=config["jitter_cm"], sim_seconds=config["sim_seconds"],
                           config=saved.get("config_hash"), sequence=saved.get("sequence"), attempt_id=attempt_id,
                           attempt_number=attempt["number"], started_at=attempt["started_at"], ended_at=now())
                output = folder / "results.jsonl"
                records = read_lines(output)
                records.append(row)
                write_atomic(output, "".join(json.dumps(item, allow_nan=False) + "\n" for item in records))
                previous[seed] = row
                errors = sum(item["outcome"] == "error" for item in previous.values())
                changes = dict(completed=len(previous) - errors, errors=errors,
                               current_seed=None, active_attempt=None)
                update(run_id, **changes)
                if stopping:
                    break
                if row["outcome"] == "error":
                    code = row.get("stop_code")
                    state = "blocked" if code in ("account", "budget") else "completed_with_errors"
                    update(run_id, status=state, message=row["error"])
                    return
        with LOCK:
            stopped = status(run_id)["status"] == "stopping"
            update(run_id, status="cancelled" if stopped else "completed", active_attempt=None,
                   current_seed=None, message="Experiment cancelled." if stopped else "All scheduled trials finished.")
    except (OSError, RuntimeError, ValueError, sqlite3.Error) as exc:
        with LOCK:
            stopping = status(run_id)["status"] == "stopping"
            code = error_code(exc)
            state = "cancelled" if stopping else ("blocked" if code == "budget" else "interrupted")
            update(run_id, status=state, active_attempt=None, current_seed=None, message=public_error(exc))
    finally:
        with LOCK:
            ACTIVE.pop(run_id, None)


def launch(run_id):
    with LOCK:
        if ACTIVE:
            raise AdmissionError("Wait for the current experiment to finish or cancel it.")
        try:
            with exclusive("attempt.lock"):
                pass
        except OSError as exc:
            raise AdmissionError("The previous worker is still exiting. Try again shortly.") from exc
        worker = threading.Thread(target=run_batch, args=(run_id,), daemon=True)
        ACTIVE[run_id] = worker
        worker.start()
        return status(run_id)


def start(payload):
    if not isinstance(payload, dict):
        raise plans.InvalidPlan("Send an experiment configuration.")
    reviewed = preview(payload.get("config"))
    config, plan = reviewed["config"], reviewed["plan"]
    if payload.get("plan_hash") != plan["hash"]:
        raise AdmissionError("Review the current plan before starting.")
    key = payload.get("idempotency_key")
    if not isinstance(key, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{16,80}", key):
        raise plans.InvalidPlan("A valid creation key is required.", "idempotency_key")
    parent = payload.get("parent_id")
    if parent is not None and (not isinstance(parent, str) or len(parent) > 120):
        raise plans.InvalidPlan("Choose a valid parent experiment.", "parent_id")
    run_id = "mc-" + plans.digest(key)[:12]
    folder = run_dir(run_id)
    with LOCK:
        if (folder / "config.json").exists():
            old = read_json(folder / "config.json")
            if old.get("idempotency_key") != key or old.get("config_hash") != plan["hash"] or old.get("parent_id") != parent:
                raise AdmissionError("This creation key was already used for a different configuration.")
            try:
                return status(run_id)
            except KeyError:
                pass
        if ACTIVE:
            raise AdmissionError("Wait for the current experiment to finish or cancel it.")
        require_ready(preflight(config, run_id))
        preset = next(t for t in tasks() if t["id"] == config["task_id"])
        folder.mkdir(parents=True, exist_ok=True)
        sweep = {**config, "name": run_id, "prompt": [config["instruction"]], "actions": [config["actions"]],
                 "target": preset["target"], "goal": preset["goal"], "modes": ["plain"], "workers": 1,
                 "sequence": [step["id"] for step in plan["steps"]] if config["task_id"] == plans.COMPOUND else [],
                 "plan": plan, "config_hash": plan["hash"], "parent_id": parent, "idempotency_key": key}
        write_atomic(folder / "config.json", json.dumps(sweep, indent=2))
        write_atomic(folder / "status.json", json.dumps(dict(id=run_id, status="queued", config=config,
                     completed=0, errors=0, current_seed=None, active_attempt=None, created_at=now(), updated_at=now())))
        try:
            return launch(run_id)
        except (AdmissionError, OSError):
            update(run_id, status="interrupted", message="The worker could not start.")
            raise


def sequence_steps(steps, row):
    """Per-step evidence from a single-instruction sequence trial, in the shape the console displays."""
    details = row.get("step_details") or []
    done = row.get("progress") or 0
    result = []
    for index, step in enumerate(steps):
        evidence = details[index] if index < len(details) else None
        if evidence is not None:
            evidence = {**evidence, "success": index < done}
        if index < done:
            status = "succeeded"
        elif index == done and row.get("outcome") != "error":
            status = "task_failed"
        else:
            status = "pending"
        # Keep a later step's evidence only if the robot actually touched that object (out of order).
        if status == "pending" and (evidence is None or evidence.get("first_contact_row") is None):
            evidence = None
        result.append({"id": step["id"], "status": status, "evidence": evidence})
    return result


def require_ready(report):
    if not report["ready"]:
        raise AdmissionError(" ".join(item["detail"] for item in report["checks"] if item["status"] == "blocked"))


def cancel(run_id):
    with LOCK:
        job = status(run_id)
        if job["status"] in {"queued", "running"}:
            job = update(run_id, status="stopping", message="Waiting for the current simulator action or request to stop.")
            attempt = job.get("active_attempt")
            if attempt:
                (run_dir(run_id) / "attempts" / attempt["id"] / "stop").touch()
        return job


def resume(run_id):
    with LOCK:
        job = status(run_id)
        if job["status"] in {"queued", "running"}:
            return job
        if job["status"] not in ("interrupted", "blocked", "completed_with_errors", "FAILED", "BUDGET_STOPPED"):
            raise AdmissionError("Resume is available for interrupted or blocked experiments with eligible slots.")
        if ACTIVE:
            raise AdmissionError("Wait for the current experiment to finish or cancel it.")
        config = validate_config(job["config"])
        completed = slot_rows(run_dir(run_id))
        remaining = sum(seed not in completed or completed[seed]["outcome"] == "error" for seed in config["seeds"])
        require_ready(preflight(config, run_id, trials=remaining))
        update(run_id, status="queued", config=config, message="Resuming unfinished seeds.")
        try:
            return launch(run_id)
        except (AdmissionError, OSError):
            update(run_id, status="interrupted", message="The worker could not resume.")
            raise


def public_error(raw):
    msg = str(raw).lower()
    if "budget_stopped" in msg:
        return "Budget limit or expired spending authorization. Review the remaining allocation."
    if error_code(raw) == "account":
        return "DreamAPI access was refused. Check the account and model access before resuming."
    if "timeout" in msg or "timed out" in msg:
        return "The request or trial timed out. Check connectivity and service status."
    if "no_capacity" in msg:
        return "The model service reported no available capacity."
    if "connection" in msg or "network" in msg:
        return "Connection to the model service was interrupted."
    if "malformed" in msg or "shape" in msg or "schema" in msg:
        return "The model observation or action failed validation."
    return "The simulator or model client returned a technical error. Check the local installation."


def error_code(raw):
    message = str(raw).lower()
    if "budget_stopped" in message:
        return "budget"
    if "attempt_cancelled" in message:
        return "cancelled"
    if any(token in message for token in ("da-1000", "unauthorized", "dreamautherror", "quota", "payment_required")):
        return "account"
    if "timeout" in message or "timed out" in message:
        return "timeout"
    return "technical"


def run_attempt(run_id, attempt_id, parent_closed):
    folder = run_dir(run_id)
    if not re.fullmatch(r"[a-f0-9]{32}", attempt_id):
        raise ValueError("Invalid attempt ID.")
    attempt = folder / "attempts" / attempt_id
    saved = read_json(folder / "config.json")
    config = status(run_id)["config"]
    claim = read_json(attempt / "claim.json")
    seed = claim["seed"]
    calls = 0
    started = time.monotonic()
    heartbeat_at = 0
    index = 0
    live = dict(sim_s=0, attempted=0, completed=0, step_id=None, verified_steps=[])

    def checkpoint(sim_s=None):
        nonlocal heartbeat_at
        if sim_s is not None:
            live["sim_s"] = sim_s
        if parent_closed.is_set() or (attempt / "stop").exists():
            raise RuntimeError("ATTEMPT_CANCELLED")
        tick = time.monotonic()
        if tick - started >= ATTEMPT_TIMEOUT - 1:
            raise RuntimeError("wall_timeout")
        if tick - heartbeat_at >= 1:
            heartbeat_at = tick
            write_atomic(attempt / "heartbeat.json", json.dumps({**live, "wall_s": tick - started, "at": now()}))

    def emit(kind, **detail):
        nonlocal index
        index += 1
        live.update({name: detail[name] for name in ("sim_s", "attempted", "completed") if name in detail})
        if kind == "step_started":
            live["step_id"] = detail["step_id"]
        if kind == "step_succeeded":
            live["verified_steps"].append(detail["step_id"])
        with (attempt / "events.jsonl").open("a", encoding="utf-8") as out:
            out.write(json.dumps(dict(sequence=index, attempt_id=attempt_id, kind=kind, wall_time=now(), **detail),
                                 allow_nan=False) + "\n")

    def request():
        nonlocal calls
        checkpoint()
        if calls >= config["request_cap"]:
            raise RuntimeError("BUDGET_STOPPED: request cap reached")
        reserve_call(run_id, config)
        calls += 1

    episode = None
    try:
        with exclusive("attempt.lock"):
            checkpoint()
            runner, scenes = import_engine()
            if config["model"] != "oracle":
                settings = runner.dc.settings()
                if (not settings.get("DREAM_API_KEY") or
                        settings.get("DREAM_GATEWAY_URL", "https://api.dreamlabs.ai").rstrip("/") != "https://api.dreamlabs.ai"):
                    raise RuntimeError("DreamAuthError: configure official gateway access")
                if quote() is None:
                    raise RuntimeError("BUDGET_STOPPED: provider quote expired")
            env = scenes.make_env(config["scene"])
            try:
                if config.get("record_episode"):
                    from .datasets import EpisodeRecorder
                    episode = EpisodeRecorder(attempt / "episode.jsonl")
                recording = folder / "frames" / f"{attempt_id}.mp4" if config["record"] else None
                row = runner.run_trial(
                    env, task=config["instruction"], target=saved["target"], goal=saved["goal"], scene=config["scene"],
                    model=config["model"], seed=seed, actions=config["actions"], sim_seconds=config["sim_seconds"],
                    jitter_cm=config["jitter_cm"], before_request=request, checkpoint=checkpoint, on_event=emit,
                    record=str(recording) if recording else None,
                    on_sample=episode.add if episode else None,
                    normalize_gripper=False,
                    # Clean mode: the robot gets one instruction for the whole trial. Each step is still graded,
                    # but the simulator never tells the robot that a step finished.
                    sequence=[f"{step['target']}:{step['goal']}" for step in saved.get("plan", {}).get("steps", [])]
                    if config["task_id"] == plans.COMPOUND else None,
                )
                if config["task_id"] == plans.COMPOUND:
                    row["ordered_steps"] = sequence_steps(saved["plan"]["steps"], row)
            finally:
                env.close()
    except Exception as exc:
        row = {"outcome": "error", "success": False, "error": str(exc)}
    finally:
        if episode:
            episode.close()

    raw = row.get("error")
    if raw:
        code = error_code(raw)
        row.update(error="Attempt cancelled." if code == "cancelled" else public_error(raw), stop_code=code)
        emit("step_interrupted" if code == "cancelled" else "attempt_error", step_id=live["step_id"],
             sim_s=live["sim_s"], reason=code)
    if episode:
        row["episode"] = {"frames": episode.count, "error": episode.error,
                          "source": "scripted_simulator" if config["model"] == "oracle" else "model_generated"}
    write_atomic(attempt / "result.json", json.dumps(row, allow_nan=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--probe", choices={t["scene"] for t in tasks()})
    mode.add_argument("--attempt", nargs=2, metavar=("RUN", "ATTEMPT"))
    args = parser.parse_args()
    if args.probe:
        missing = missing_simulator_dependencies()
        if missing:
            parser.exit(1, f"Simulator dependencies missing from this interpreter: {', '.join(missing)}. "
                        "Install mission_control/requirements-sim.txt using this interpreter.\n")
        with open(os.devnull, "w") as quiet, redirect_stdout(quiet), redirect_stderr(quiet):
            checks = probe(args.probe)
        print(json.dumps(checks))
        if any(check["status"] != "ok" for check in checks):
            parser.exit(1, "The stock scene probe reported an input blocker.\n")
    else:
        parent_closed = threading.Event()

        def watch_parent():
            try:
                if os.name == "nt":
                    import ctypes
                    import msvcrt
                    from ctypes import wintypes

                    # NumPy imports native code that can need the CRT file table.
                    # A blocking read on stdin can hold its Windows descriptor lock.
                    peek = ctypes.WinDLL("kernel32", use_last_error=True).PeekNamedPipe
                    peek.argtypes = (wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
                                     wintypes.LPDWORD, wintypes.LPDWORD, wintypes.LPDWORD)
                    peek.restype = wintypes.BOOL
                    pipe = msvcrt.get_osfhandle(0)
                    available = wintypes.DWORD()
                    while peek(pipe, None, 0, None, ctypes.byref(available), None) and not available.value:
                        time.sleep(0.2)
                else:
                    os.read(0, 1)
            finally:
                parent_closed.set()
            # A stuck SDK call cannot keep the old worker alive indefinitely.
            time.sleep(8)
            os._exit(1)

        threading.Thread(target=watch_parent, daemon=True).start()
        run_attempt(*args.attempt, parent_closed)
