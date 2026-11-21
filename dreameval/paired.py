"""Paired comparison of every mode against plain in a run dir: per-seed outcomes, discordant pairs, exact McNemar p.

    python paired.py runs/<name>
"""
import json
import math
import sys
from collections import Counter


def mode(r):
    s = r.get("supervised")
    return s if isinstance(s, str) else "supervised" if s else "plain"


def mcnemar(b, c):
    if not b + c:
        return 1.0
    return min(1.0, 2 * sum(math.comb(b + c, i) for i in range(min(b, c) + 1)) / 2 ** (b + c))


rows = [json.loads(l) for l in open(sys.argv[1] + "/results.jsonl") if l.strip()]
by = {}
for r in rows:
    if r["outcome"] != "error":
        by.setdefault(r["seed"], {})[mode(r)] = r
modes = sorted({m for v in by.values() for m in v}, key=lambda m: (m != "plain", m))

print(f"{'seed':<5}" + "".join(f"{m:<34}" for m in modes))
for s in sorted(by):
    cells = []
    for m in modes:
        r = by[s].get(m)
        if not r:
            cells.append("-")
            continue
        iv = [f"{i['reason'][:5]}@{i['row'] // 20}" for i in r.get("interventions", [])
              if i.get("reason") not in (None, "latch_release")]
        cells.append(f"{r['outcome'][:18]} {' '.join(iv[:3])}")
    print(f"{s:<5}" + "".join(f"{c[:33]:<34}" for c in cells))

print()
for m in modes:
    rs = [v[m] for v in by.values() if m in v]
    n = len(rs)
    k = sum(r["success"] for r in rs)
    lift = sum(r["lifted_row"] is not None for r in rs)
    calls = sum(r["calls"] for r in rs) / max(1, n)
    cost = sum(r["est_cost_usd"] for r in rs)
    line = f"{m:<16} success {k:>2}/{n:<2}  lifted {lift:>2}/{n:<2}  calls/trial {calls:5.1f}  ${cost:.2f}"
    if m != "plain":
        pairs = [v for v in by.values() if m in v and "plain" in v]
        b = sum(v["plain"]["success"] and not v[m]["success"] for v in pairs)
        c = sum(v[m]["success"] and not v["plain"]["success"] for v in pairs)
        line += f"  vs plain: +{c} / -{b}  McNemar p={mcnemar(b, c):.3f}"
    line += "  " + ", ".join(f"{o}:{x}" for o, x in Counter(r["outcome"] for r in rs).most_common())
    print(line)
