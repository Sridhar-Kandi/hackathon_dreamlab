"""Writes runs/<name>/report.html: per-config success rates, outcome breakdown, paired comparison, and the trial GIFs.

Self-contained HTML (no network). While a sweep is running the page refreshes itself every 8 s.
`python report.py runs/<name>` rebuilds it by hand.
"""

import html
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

## Outcomes in a fixed order, each with a fixed color (reference categorical palette; color follows the outcome).
OUTCOMES = [
    ("success", "Success", "#008300", "#0ca30c"),
    ("touched_no_lift", "Touched, no lift", "#eb6834", "#d95926"),
    ("wrong_object", "Wrong object", "#e87ba4", "#d55181"),
    ("wrong_destination", "Wrong destination", "#6250d6", "#9085e9"),
    ("lifted_missed_goal", "Lifted, missed goal", "#2a78d6", "#3987e5"),
    ("at_goal_not_settled", "At goal, not settled", "#1baf7a", "#199e70"),
    ("never_touched", "Never touched", "#eda100", "#c98500"),
    ("fell_off_table", "Fell off table", "#e34948", "#e66767"),
    ("partial", "Partial (some steps)", "#1baf7a", "#199e70"),
    ("wrong_order", "Wrong order", "#e87ba4", "#d55181"),
    ("undone", "Done, then undone", "#6250d6", "#9085e9"),
    ("error", "Error", "#898781", "#898781"),
]
LABEL = {k: l for k, l, _, _ in OUTCOMES}


def wilson(k, n, z=1.96):
    if n == 0:
        return 0.0, 0.0
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def mcnemar_p(b, c):
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2**n)


def config_name(r):
    sup = r.get("supervised")
    mode = "grasp-retry" if sup == "grasp" else sup if isinstance(sup, str) else "supervised" if sup else "plain"
    if r.get("model") == "oracle":
        return f"{r['task']} · scripted oracle"
    return f"{r['task']} · {r['actions']} rows/reply · {mode}"


def write(run_dir, running=False):
    run_dir = Path(run_dir)
    path = run_dir / "results.jsonl"
    rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()] if path.exists() else []
    cfg = json.loads((run_dir / "config.json").read_text()) if (run_dir / "config.json").exists() else {}
    planned = None
    if cfg:
        planned = cfg.get("trials", 0) * len(cfg.get("prompt", [])) * len(cfg.get("actions", [])) * len(
            cfg.get("modes", ["plain"])
        )
    groups = defaultdict(list)
    for r in rows:
        groups[config_name(r)].append(r)
    order = sorted(groups, key=lambda k: (groups[k][0]["task"], groups[k][0]["actions"], k))
    e = html.escape

    # ---- per-config cards + stacked outcome bars
    cards, bars = [], []
    for name in order:
        rs = groups[name]
        n = len(rs)
        s = sum(r["success"] for r in rs)
        lo, hi = wilson(s, n)
        lifted = sum(r.get("lifted_row") is not None for r in rs)
        cost = sum(r.get("est_cost_usd", 0) for r in rs)
        calls = sum(r.get("calls", 0) for r in rs) / max(1, n)
        retries = sum(r.get("retries", 0) for r in rs)
        per_success = f"${cost / s:.3f}" if s else "—"
        cards.append(
            f"""<div class="card"><div class="cfg">{e(name)}</div>
<div class="hero">{s}/{n}<span class="pct">{(s / n if n else 0):.0%}</span></div>
<div class="ci" title="95% Wilson interval"><div class="ci-track"><div class="ci-range" style="left:{lo * 100:.1f}%;width:{(hi - lo) * 100:.1f}%"></div>
<div class="ci-dot" style="left:{(s / n if n else 0) * 100:.1f}%"></div></div><span>95% range {lo:.0%}–{hi:.0%}</span></div>
<dl><dt>Lifted</dt><dd>{lifted}/{n}</dd><dt>Calls/trial</dt><dd>{calls:.1f}</dd><dt>Cost/success</dt><dd>{per_success}</dd>
{f'<dt>Retries</dt><dd>{retries}</dd>' if rs[0].get('supervised') else ''}</dl></div>"""
        )
        counts = Counter(r["outcome"] for r in rs)
        segs = []
        for key, label, _, _ in OUTCOMES:
            c = counts.get(key, 0)
            if c:
                segs.append(
                    f'<div class="seg o-{key}" style="flex:{c}" data-tip="{e(label)}: {c}/{n} ({c / n:.0%})">'
                    f'<span>{c if c / n >= 0.08 else ""}</span></div>'
                )
        bars.append(f'<div class="bar-row"><div class="bar-label">{e(name)}</div><div class="bar">{"".join(segs)}</div></div>')

    present = {r["outcome"] for r in rows}
    legend = "".join(
        f'<span class="key"><i class="o-{k}"></i>{e(l)}</span>' for k, l, _, _ in OUTCOMES if k in present
    )

    # ---- paired comparison when exactly two configs share seeds
    paired = ""
    if len(order) == 2:
        a, b = order
        sa = {r["seed"]: r["success"] for r in groups[a]}
        sb = {r["seed"]: r["success"] for r in groups[b]}
        common = sorted(set(sa) & set(sb))
        if common:
            only_a = sum(sa[x] and not sb[x] for x in common)
            only_b = sum(sb[x] and not sa[x] for x in common)
            both = sum(sa[x] and sb[x] for x in common)
            paired = f"""<section><h2>Paired on the same {len(common)} start states</h2>
<p class="paired">Only <b>{e(a)}</b> succeeded: <b>{only_a}</b> · only <b>{e(b)}</b> succeeded: <b>{only_b}</b> ·
both: {both} · neither: {len(common) - only_a - only_b - both} · McNemar exact p = <b>{mcnemar_p(only_a, only_b):.4f}</b></p></section>"""

    # ---- gallery
    tiles = []
    for r in sorted(rows, key=lambda r: (r["outcome"] != "success", r["outcome"], r["seed"])):
        rec = r.get("recording")
        if not rec:
            continue
        rel = Path(rec)
        try:
            rel = rel.resolve().relative_to(run_dir.resolve())
        except ValueError:
            pass
        extra = ""
        if r.get("interventions"):
            extra = " · supervisor: " + ", ".join(
                f"{i.get('object') or i.get('reason')} at {i['row'] / 20:.0f}s" for i in r["interventions"] if "row" in i)
        tiles.append(
            f"""<figure data-outcome="{r['outcome']}"><img loading="lazy" src="{e(rel.as_posix())}" alt="trial seed {r['seed']}">
<figcaption><i class="o-{r['outcome']}"></i><b>{e(LABEL.get(r['outcome'], r['outcome']))}</b> · seed {r['seed']} ·
{'oracle' if r.get('model') == 'oracle' else str(r['actions']) + ' rows/reply'}{' · ' + str(r.get('supervised')) if r.get('supervised') else ''} · lift {r.get('max_lift_cm')} cm{e(extra)}</figcaption></figure>"""
        )
    filters = "".join(
        f'<button data-f="{k}"><i class="o-{k}"></i>{e(l)}</button>' for k, l, _, _ in OUTCOMES if k in present
    )
    gallery = (
        f"""<section><h2>Recorded trials</h2><div class="filters"><button data-f="all" class="on">All</button>{filters}</div>
<div class="gallery">{''.join(tiles)}</div></section>"""
        if tiles
        else ""
    )

    # ---- table view
    trs = "".join(
        f"<tr><td>{e(config_name(r))}</td><td>{r['seed']}</td><td>{e(LABEL.get(r['outcome'], r['outcome']))}</td>"
        f"<td>{r.get('max_lift_cm')}</td><td>{r.get('calls')}</td><td>{r.get('retries', 0)}</td><td>{e(str(r.get('error') or ''))}</td></tr>"
        for r in sorted(rows, key=lambda r: (config_name(r), r["seed"]))
    )

    color_css = "\n".join(
        f".o-{k}{{background:{light}}} @media (prefers-color-scheme:dark){{.o-{k}{{background:{dark}}}}}"
        for k, _, light, dark in OUTCOMES
    )
    total = sum(r.get("est_cost_usd", 0) for r in rows)
    status = (
        f'<span class="live">● running · {len(rows)}{f"/{planned}" if planned else ""} trials · refreshes every 8 s</span>'
        if running
        else f"{len(rows)} trials · finished"
    )
    tasks = sorted({r["task"] for r in rows})
    page = f"""<!doctype html><html><head><meta charset="utf-8">{'<meta http-equiv="refresh" content="8">' if running else ''}
<title>Dream-1 eval · {e(run_dir.name)}</title><style>
:root{{--surface:#fcfcfb;--page:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--line:#e4e3df}}
@media (prefers-color-scheme:dark){{:root{{--surface:#1a1a19;--page:#0d0d0d;--ink:#f0efec;--ink2:#c3c2b7;--muted:#898781;--line:#383835}}}}
*{{box-sizing:border-box}} body{{margin:0;background:var(--page);color:var(--ink);font:14px/1.45 system-ui,Segoe UI,sans-serif}}
main{{max-width:1180px;margin:0 auto;padding:28px 24px 60px}} h1{{font-size:22px;margin:0 0 4px}} h2{{font-size:15px;margin:0 0 12px}}
.sub{{color:var(--ink2)}} .live{{color:var(--ink)}} section{{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:18px;margin-top:18px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}}
.card{{border:1px solid var(--line);border-radius:8px;padding:14px}} .cfg{{color:var(--ink2);font-size:12.5px;min-height:34px}}
.hero{{font-size:34px;font-weight:650;margin:6px 0 2px;font-variant-numeric:tabular-nums}} .pct{{font-size:16px;color:var(--ink2);margin-left:8px;font-weight:500}}
.ci{{font-size:12px;color:var(--muted)}} .ci-track{{position:relative;height:8px;background:var(--line);border-radius:4px;margin:6px 0 4px}}
.ci-range{{position:absolute;top:0;height:8px;background:var(--muted);border-radius:4px;opacity:.55}}
.ci-dot{{position:absolute;top:-2px;width:3px;height:12px;margin-left:-1px;background:var(--ink)}}
dl{{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:10px 0 0;font-size:12.5px}} dt{{color:var(--muted)}} dd{{margin:0;font-variant-numeric:tabular-nums}}
.legend{{display:flex;flex-wrap:wrap;gap:6px 14px;margin-bottom:12px;font-size:12.5px;color:var(--ink2)}}
.key i,figcaption i,.filters i{{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}}
.bar-row{{display:grid;grid-template-columns:300px 1fr;gap:12px;align-items:center;margin:6px 0}} .bar-label{{font-size:12.5px;color:var(--ink2)}}
.bar{{display:flex;height:24px;gap:2px}} .seg{{position:relative;border-radius:2px;min-width:3px;display:flex;align-items:center;justify-content:center}}
.seg span{{font-size:11.5px;color:#fff;font-weight:600}} .seg:hover{{outline:2px solid var(--ink)}}
#tip{{position:fixed;pointer-events:none;background:var(--ink);color:var(--surface);padding:4px 8px;border-radius:4px;font-size:12px;display:none;z-index:5}}
.paired{{margin:0;color:var(--ink2)}} .paired b{{color:var(--ink)}}
.filters{{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}} .filters button{{border:1px solid var(--line);background:none;color:var(--ink2);border-radius:14px;padding:3px 10px;cursor:pointer;font:inherit;font-size:12.5px}}
.filters button.on{{border-color:var(--ink);color:var(--ink)}}
.gallery{{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:14px}} figure{{margin:0}} figure img{{width:100%;border-radius:6px;display:block}}
figcaption{{font-size:12.5px;color:var(--ink2);margin-top:4px}} figcaption b{{color:var(--ink)}}
details summary{{cursor:pointer;color:var(--ink2)}} table{{border-collapse:collapse;width:100%;font-size:12.5px;margin-top:10px}}
td,th{{text-align:left;padding:4px 8px;border-bottom:1px solid var(--line)}} th{{color:var(--muted);font-weight:500}}
{color_css}
</style></head><body><main>
<h1>Dream-1 evaluation · {e(run_dir.name)}</h1>
<div class="sub">{' / '.join(e(t) for t in tasks)} · dream-1-beta · Dream YAM Sim · graded from MuJoCo ground truth · {status} · est. cost ${total:.2f}</div>
<section><h2>Success rate by configuration</h2><div class="cards">{''.join(cards) or '<p class="sub">Waiting for the first trial…</p>'}</div></section>
<section><h2>What happened in each trial</h2><div class="legend">{legend}</div>{''.join(bars)}</section>
{paired}{gallery}
<section><details><summary>All trials as a table</summary><table><tr><th>Configuration</th><th>Seed</th><th>Outcome</th><th>Max lift cm</th><th>Calls</th><th>Retries</th><th>Error</th></tr>{trs}</table></details></section>
</main><div id="tip"></div><script>
const tip=document.getElementById('tip');
document.querySelectorAll('[data-tip]').forEach(el=>{{el.addEventListener('mousemove',ev=>{{tip.textContent=el.dataset.tip;tip.style.display='block';tip.style.left=(ev.clientX+12)+'px';tip.style.top=(ev.clientY+12)+'px'}});el.addEventListener('mouseleave',()=>tip.style.display='none')}});
document.querySelectorAll('.filters button').forEach(b=>b.addEventListener('click',()=>{{document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('on',x===b));
document.querySelectorAll('figure').forEach(f=>f.style.display=(b.dataset.f==='all'||f.dataset.outcome===b.dataset.f)?'':'none')}}));
</script></body></html>"""
    out = run_dir / "report.html"
    out.write_text(page, encoding="utf-8")
    return str(out)


if __name__ == "__main__":
    print(write(sys.argv[1]))
