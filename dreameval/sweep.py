"""Settings sweep: every (prompt x actions-per-reply) config runs the same seeded trials, so configs are paired.

Results append to runs/<name>/results.jsonl (resumable: finished (config, seed) pairs are skipped).
`python sweep.py summary runs/<name>` prints the table again.

Example:
  python sweep.py run --name orange1 --trials 8 --actions 48 16 \
      --prompt "put orange into the bowl" --prompt "pick up the orange and put it in the bowl"
"""

import argparse
import json
import math
import sys
import time
import warnings
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

warnings.filterwarnings("ignore")
HERE = Path(__file__).parent

_env = None


def _worker(job):
    """Run one trial in a worker process (one YamEnv per process)."""
    global _env
    import warnings as w

    w.filterwarnings("ignore")
    import runner
    import yam_env

    import scenes

    scene = job.get("scene", "stock")
    if _env is None or _env[0] != scene:
        _env = (scene, scenes.make_env(scene))
    return runner.run_trial(_env[1], **job)


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def mode_of(r):
    sup = r.get("supervised")
    return sup if isinstance(sup, str) else "supervised" if sup else "plain"


def key_of(r):
    return (r["task"], r["actions"], r["sim_seconds"], r["jitter_cm"], r["model"], mode_of(r))


def summary(run_dir):
    rows = [json.loads(l) for l in (Path(run_dir) / "results.jsonl").read_text().splitlines() if l.strip()]
    groups = defaultdict(list)
    for r in rows:
        groups[key_of(r)].append(r)
    print(f"\n{len(rows)} trials in {run_dir}\n")
    hdr = f"{'prompt':<45} {'mode':<10} {'act':>3} {'n':>3} {'success':>16} {'lifted':>16} {'touched':>8} {'calls':>6} {'$/trial':>8}  outcomes"
    print(hdr)
    print("-" * len(hdr))
    for (task, actions, secs, jit, model, mode), rs in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][5])):
        n = len(rs)
        ok = [r for r in rs if r["outcome"] != "error"]
        s = sum(r["success"] for r in rs)
        lifted = sum(r["lifted_row"] is not None for r in rs)
        touched = sum(r["first_contact_row"] is not None for r in rs)
        lo, hi = wilson(s, n)
        llo, lhi = wilson(lifted, n)
        calls = sum(r["calls"] for r in ok) / max(1, len(ok))
        cost = sum(r["est_cost_usd"] for r in rs) / n
        outc = ", ".join(f"{k}:{v}" for k, v in Counter(r["outcome"] for r in rs).most_common())
        print(
            f"{task[:45]:<45} {mode:<10} {actions:>3} {n:>3} {s:>2}/{n:<2} [{lo:.0%}-{hi:.0%}] {lifted:>2}/{n:<2} [{llo:.0%}-{lhi:.0%}] "
            f"{touched:>3}/{n:<3} {calls:>6.1f} {cost:>8.4f}  {outc}"
        )
    total = sum(r["est_cost_usd"] for r in rows)
    print(f"\nEstimated total API cost: ${total:.2f}  (published Dream-1 rate; check platform balance)")
    errs = [r for r in rows if r["error"]]
    if errs:
        print(f"{len(errs)} errored trials, e.g.: {errs[0]['error']}")


def run(a):
    run_dir = HERE / "runs" / a.name
    run_dir.mkdir(parents=True, exist_ok=True)
    out = run_dir / "results.jsonl"
    done = set()
    if out.exists():
        for l in out.read_text().splitlines():
            if l.strip():
                r = json.loads(l)
                if r["outcome"] != "error":
                    done.add((key_of(r), r["seed"]))
    jobs = []
    for seed in range(a.seed0, a.seed0 + a.trials):  # seed-major order: configs advance together
        for prompt in a.prompt:
            for actions in a.actions:
              for mode in a.modes:
                job = dict(
                    task=prompt,
                    target=a.target,
                    goal=a.goal,
                    actions=actions,
                    sim_seconds=a.sim_seconds,
                    seed=seed,
                    jitter_cm=a.jitter_cm,
                    model=a.model,
                    supervise={"plain": False, "supervised": True}.get(mode, mode),
                    max_retries=a.max_retries,
                    retry_prompt=a.retry_prompt,
                    scene=a.scene,
                    sequence=a.sequence.split(",") if a.sequence else None,
                )
                if a.record:
                    slug = "".join(c if c.isalnum() else "_" for c in prompt)[:40]
                    job["record"] = str(run_dir / "frames" / f"{slug}_a{actions}_{mode}_s{seed}.gif")
                k = (job["task"], actions, a.sim_seconds, a.jitter_cm, a.model, mode)
                if (k, seed) not in done:
                    jobs.append(job)
    (run_dir / "config.json").write_text(json.dumps(vars(a), indent=2))
    if a.open:
        import os
        import report

        page = report.write(run_dir, running=True)
        os.startfile(page) if hasattr(os, "startfile") else None
    print(f"{len(jobs)} trials to run ({len(done)} already done), {a.workers} workers -> {out}", flush=True)
    t0 = time.monotonic()
    with ProcessPoolExecutor(max_workers=a.workers) as pool, out.open("a") as f:
        futures = {pool.submit(_worker, j): j for j in jobs}
        for i, fut in enumerate(as_completed(futures), 1):
            j = futures[fut]
            try:
                r = fut.result()
            except Exception as exc:  # worker crash
                r = {**j, "outcome": "error", "success": False, "error": repr(exc)[:300], "calls": 0,
                     "est_cost_usd": 0, "first_contact_row": None, "lifted_row": None}
            f.write(json.dumps(r) + "\n")
            f.flush()
            print(
                f"[{i}/{len(jobs)} {time.monotonic() - t0:5.0f}s] act={r['actions']:>2} seed={r['seed']} "
                f"{r['outcome']:<20} lift={r.get('max_lift_cm')}cm calls={r['calls']} '{r['task'][:40]}'"
                + (f" ERR {r['error'][:80]}" if r.get("error") else ""),
                flush=True,
            )
            if "UNAUTHORIZED" in str(r.get("error") or ""):
                # Key disabled (e.g. credits ran out): stop instead of burning the queue as errors.
                print("API key refused (DA-1000); cancelling the rest. Errored trials rerun on resume.", flush=True)
                for other in futures:
                    other.cancel()
                break
    summary(run_dir)
    import report

    print(f"Report: {report.write(run_dir, running=False)}")


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--name", required=True)
    r.add_argument("--prompt", action="append", required=True)
    r.add_argument("--actions", type=int, nargs="+", default=[48])
    r.add_argument("--trials", type=int, default=6)
    r.add_argument("--seed0", type=int, default=0)
    r.add_argument("--target", default="orange")
    r.add_argument("--goal", default="inside_bowl")
    r.add_argument("--sim-seconds", type=float, default=40)
    r.add_argument("--jitter-cm", type=float, default=2)
    r.add_argument("--model", default="dreamlabs/dream-1-beta")
    r.add_argument("--workers", type=int, default=2)
    r.add_argument("--record", action="store_true", help="save a GIF per trial under runs/<name>/frames/")
    r.add_argument("--modes", nargs="+", default=["plain"], choices=["plain", "supervised", "grasp", "assist", "assist_adaptive", "adaptive", "assist_place", "place_only", "stepwise"])
    r.add_argument("--max-retries", type=int, default=2)
    r.add_argument("--scene", default="stock")
    r.add_argument("--sequence", help="ordered steps, e.g. apple:inside_bowl,orange:inside_bowl")
    r.add_argument("--retry-prompt", help="prompt for the supervisor's fresh session after a wrong-object grab")
    r.add_argument("--open", action="store_true", help="open the live report in the browser")
    s = sub.add_parser("summary")
    s.add_argument("run_dir")
    a = p.parse_args()
    if a.cmd == "run":
        run(a)
    else:
        summary(a.run_dir)


if __name__ == "__main__":
    sys.exit(main())
