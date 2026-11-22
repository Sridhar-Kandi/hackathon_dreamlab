"""Index the current console's results, retaining every recorded attempt."""

import re
from collections import defaultdict
from pathlib import PureWindowsPath
from statistics import median

from dreameval.report import mcnemar_p

from . import execution


def classification(row):
    code = row.get("stop_code")
    if code in {"cancelled", "interrupted"}:
        return code.upper()
    if row.get("error") or row.get("outcome") == "error":
        return "ERROR"
    if row.get("success") is True:
        return "SUCCESS"
    if row.get("success") is False:
        return "FAILURE"
    return "INCOMPLETE"


def metrics(rows):
    statuses = [classification(row) for row in rows]
    passed, failed = statuses.count("SUCCESS"), statuses.count("FAILURE")
    measured = [row["rows"] / 20 for row in rows if isinstance(row.get("rows"), int)]
    return dict(successes=passed, failures=failed, valid=passed + failed,
                errors=statuses.count("ERROR"), cancelled=statuses.count("CANCELLED"),
                interrupted=statuses.count("INTERRUPTED"), incomplete=statuses.count("INCOMPLETE"),
                median_sim_s=median(measured) if measured else None)


class Catalog:
    def __init__(self, runs):
        self.trials, self.media, self.by_run = {}, {}, {}
        for path in sorted(runs.glob("mc-*/results.jsonl")):
            if path.resolve().is_relative_to(runs.resolve()):
                self.load_run(path)

    def load_run(self, path):
        run_id = path.parent.name
        slots = defaultdict(list)
        for row in execution.read_lines(path):
            slots[row["seed"]].append(row)
        latest = []
        trial_ids = []
        for seed, attempts in slots.items():
            row = attempts[-1]
            latest.append(row)
            trial_id = f"{run_id}-{seed}"
            attempt_id = row.get("attempt_id", "")
            events = []
            if re.fullmatch(r"[a-f0-9]{32}", attempt_id):
                events = execution.read_lines(path.parent / "attempts" / attempt_id / "events.jsonl")
            filename = PureWindowsPath(str(row.get("recording") or "")).name
            media = path.parent / "frames" / filename
            url = None
            if filename and media.suffix.lower() in (".gif", ".mp4") and media.is_file() and media.resolve().is_relative_to(path.parent.resolve()):
                self.media[trial_id] = media
                url = f"/media/{trial_id}"
            self.trials[trial_id] = {
                **row, "id": trial_id, "experiment_id": run_id, "status": classification(row),
                "events": events, "instruction": row["task"],
                "sim_s": row["rows"] / 20 if isinstance(row.get("rows"), int) else None,
                "recording_url": url, "recording_kind": media.suffix.lower().lstrip(".") if url else None,
                "attempt_history": attempts,
            }
            trial_ids.append(trial_id)
        self.by_run[run_id] = dict(trial_ids=trial_ids, metrics=metrics(latest))

    def compare(self, aid, bid, groups):
        a,b = groups[aid],groups[bid]
        if aid==bid:
            raise ValueError("Choose two different configurations.")
        controls = ("scene","target","goal","sequence","jitter_cm","sim_seconds")
        changes = [dict(field=key, baseline=a.get(key), candidate=b.get(key))
                   for key in (*controls, "instruction", "model", "mode", "actions", "request_cap")
                   if a.get(key) != b.get(key)]
        incompatible = any(change["field"] in controls for change in changes) or len(changes) > 1
        left, right = ({self.trials[tid]["seed"]: self.trials[tid] for tid in group["trial_ids"]}
                       for group in (a, b))
        pairs = []
        for seed in sorted(set(left) | set(right) | set(a.get("seeds", [])) | set(b.get("seeds", []))):
            first, second = left.get(seed), right.get(seed)
            reason = None
            fa, fb = (trial.get("initial_state_fingerprint") if trial else None for trial in (first, second))
            if incompatible:
                reason = "Experiments have different controls or change multiple settings."
            elif not first or not second:
                reason = "Missing or pending trial."
            elif any(trial["status"] not in ("SUCCESS", "FAILURE") for trial in (first, second)):
                reason = "One or both trials lack a valid grade."
            elif fa != fb:
                reason = "Reset fingerprints differ or one is missing."
            elif a["run"] != b["run"] and not fa:
                reason = "Independent sweeps lack verified matching resets."
            pairs.append(dict(seed=seed, baseline=first and first["id"], candidate=second and second["id"],
                              baseline_status=first and first["status"], candidate_status=second and second["status"],
                              excluded=reason))
        matched = [pair for pair in pairs if not pair["excluded"]]
        both = sum(pair["baseline_status"] == pair["candidate_status"] == "SUCCESS" for pair in matched)
        only_a = sum(pair["baseline_status"] == "SUCCESS" and pair["candidate_status"] == "FAILURE" for pair in matched)
        only_b = sum(pair["candidate_status"] == "SUCCESS" and pair["baseline_status"] == "FAILURE" for pair in matched)
        common = [pair["seed"] for pair in matched]
        if incompatible:
            note = "Different controls or multiple changed settings. Group results are descriptive."
        elif not common:
            note = "No verified shared resets with valid grades. Group results are descriptive."
        else:
            note = "Matched reset fingerprints. The experiments ran in separate batches."
        return dict(a=a,b=b,matched=len(common),only_a=only_a,only_b=only_b,both=both,
                    neither=len(common)-both-only_a-only_b,p=mcnemar_p(only_a,only_b) if common else None,
                    source=a["source"]+" / "+b["source"],note=note,seeds=common,
                    paired_a_successes=both+only_a,paired_b_successes=both+only_b,
                    changes=changes,pairs=pairs,level="paired" if common else "descriptive")
