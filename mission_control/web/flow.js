/* "How it works": the pipeline as a live, animated flow chart, plus what each robot version is.
   Numbers come from the ladder collections and fine-tuning jobs. */
(function () {
  const gsap = window.gsap;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animate = Boolean(gsap) && !reduced;
  const NS = "http://www.w3.org/2000/svg";
  const H = 88;   // default node height in viewBox units

  const nodes = {
    seeds:   { x: 10,   y: 230, w: 180, lane: "shared", title: "Training seeds", lines: ["1000–1999", "start jitter ±2 cm"] },
    profile: { x: 220,  y: 230, w: 200, lane: "c2", title: "01 · Profile", lines: ["base Dream-1, clean mode", "{profile}"] },
    diagnose:{ x: 450,  y: 230, w: 210, lane: "c2", title: "02 · Diagnose", lines: ["{failures} failures labelled", "top: {top}"] },
    teachC2: { x: 690,  y: 230, w: 220, lane: "c2", title: "03 · Teach hard cases", lines: ["{replays} replays of failed starts", "+ {selfs} Dream-1 successes"] },
    ftC2:    { x: 940,  y: 230, w: 190, lane: "c2", title: "04 · Fine-tune C2", lines: ["60 episodes · 1000 steps", "{c2}"] },
    teachC1: { x: 690,  y: 50,  w: 220, lane: "c1", title: "Teacher demos", lines: ["arbitrary seeds 1100–1119", "20 per level, no diagnosis"] },
    ftC1:    { x: 940,  y: 50,  w: 190, lane: "c1", title: "Fine-tune C1", lines: ["60 episodes · 1000 steps", "{c1}"] },
    base:    { x: 690,  y: 410, w: 220, lane: "ab", title: "Base Dream-1", lines: ["A · 48 rows per reply", "B · 24 rows per reply"] },
    heldout: { x: 940,  y: 410, w: 190, lane: "shared", title: "Held-out seeds", lines: ["2000–2019, unseen", "same start, every version"] },
    evaluate:{ x: 1160, y: 140, w: 250, h: 268, lane: "shared", title: "05 · Prove", lines: ["L1 orange · L2 two-step", "L3 stack · L4 Hanoi", "", "A stock    {A}", "B tuned    {B}", "C1 naive   {C1}", "C2 Spotter {C2}", "", "Wilson CI · McNemar pairs"] },
  };
  const edges = [
    ["seeds", "profile", "c2"], ["profile", "diagnose", "c2"], ["diagnose", "teachC2", "c2"], ["teachC2", "ftC2", "c2"], ["ftC2", "evaluate", "c2"],
    ["seeds", "teachC1", "c1"], ["teachC1", "ftC1", "c1"], ["ftC1", "evaluate", "c1"],
    ["base", "evaluate", "ab"], ["heldout", "evaluate", "shared"],
  ];
  const laneColor = { c1: "#c9c3b5", c2: "#ff5a1f", ab: "#7fd18f", shared: "#f3f0e8" };

  const el = (name, attrs = {}, text) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text != null) node.textContent = text;
    return node;
  };
  const height = n => n.h || H;
  function edgePath(a, b) {
    const A = nodes[a], B = nodes[b];
    const x1 = A.x + A.w, y1 = A.y + height(A) / 2;
    const x2 = B.x, y2 = Math.max(B.y + 24, Math.min(B.y + height(B) - 24, y1));
    if (Math.abs(y1 - y2) < 1) return `M${x1} ${y1}H${x2}`;
    const mid = (x1 + x2) / 2;
    return `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
  }

  let built = false, particles = [], values = {};
  function build(holder) {
    const svg = el("svg", { viewBox: "0 0 1420 520", class: "flow-svg", role: "img", "aria-label": "Pipeline from training seeds to held-out evaluation" });
    const laneLabels = [["C1 lane · naive data", 690, 50], ["C2 lane · Spotter-chosen data", 220, 230], ["A / B · base model, no training", 690, 410]];
    for (const [text, x, y] of laneLabels) svg.append(el("text", { x, y: y - 12, class: "flow-lane" }, text));
    const edgeLayer = el("g"), nodeLayer = el("g"), dotLayer = el("g");
    svg.append(edgeLayer, dotLayer, nodeLayer);
    for (const [a, b, lane] of edges) {
      const path = el("path", { d: edgePath(a, b), class: "flow-edge", stroke: laneColor[lane], "data-lane": lane });
      edgeLayer.append(path);
      const length = path.getTotalLength();
      for (let i = 0; i < 2; i++) {
        // A soft halo plus a bright core reads as a glow without an SVG filter, which would re-rasterise every frame.
        const dot = el("g", { opacity: 0 });
        dot.append(el("circle", { r: lane === "c2" ? 9 : 7, fill: laneColor[lane], opacity: .18 }),
                   el("circle", { r: lane === "c2" ? 3.5 : 2.5, fill: laneColor[lane] }));
        dotLayer.append(dot);
        particles.push({ dot, path, length, offset: i / 2, speed: lane === "c2" ? .32 : .24 });
      }
    }
    for (const [id, n] of Object.entries(nodes)) {
      // The outer group holds the position; GSAP animates only the inner one, so it never touches the placement.
      const place = el("g", { transform: `translate(${n.x} ${n.y})` });
      const g = el("g", { class: "flow-node lane-" + n.lane, "data-node": id });
      place.append(g);
      g.append(el("rect", { width: n.w, height: height(n), class: "flow-box" }));
      g.append(el("rect", { width: 4, height: height(n), fill: laneColor[n.lane] }));
      g.append(el("text", { x: 14, y: 26, class: "flow-title" }, n.title));
      n.lines.forEach((line, i) => {
        const t = el("text", { x: 14, y: 48 + i * 19, class: "flow-line" });
        t.dataset.template = line;
        g.append(t);
      });
      nodeLayer.append(place);
    }
    holder.replaceChildren(svg);
    built = true;

    if (animate) {
      const tl = gsap.timeline();
      const order = ["seeds", "profile", "teachC1", "diagnose", "ftC1", "teachC2", "base", "ftC2", "heldout", "evaluate"];
      order.forEach((id, i) => tl.from(svg.querySelector(`[data-node="${id}"]`), { autoAlpha: 0, y: 14, duration: .5, ease: "power3.out" }, i * .12));
      for (const path of svg.querySelectorAll(".flow-edge")) {
        const length = path.getTotalLength();
        tl.fromTo(path, { strokeDasharray: length, strokeDashoffset: length }, { strokeDashoffset: 0, duration: .9, ease: "power2.inOut", clearProps: "strokeDasharray,strokeDashoffset" }, .25 + Math.random() * .6);
      }
      tl.add(() => { flowing = true; });
      // On a slow or busy machine the entrance can be cut short; never leave a box hidden.
      setTimeout(() => {
        flowing = true;
        for (const node of svg.querySelectorAll(".flow-node")) {
          if (getComputedStyle(node).opacity !== "1" && !svg.classList.contains("focusing")) gsap.set(node, { clearProps: "opacity,visibility,transform" });
        }
      }, 2600);
    } else flowing = true;

    // Hovering a node highlights its lane.
    svg.addEventListener("pointerover", event => {
      const g = event.target.closest(".flow-node");
      const lane = g && [...g.classList].find(c => c.startsWith("lane-"))?.slice(5);
      svg.classList.toggle("focusing", Boolean(lane && lane !== "shared"));
      for (const p of svg.querySelectorAll(".flow-edge, .flow-node")) {
        const own = p.dataset.lane || [...p.classList].find(c => c.startsWith("lane-"))?.slice(5);
        p.classList.toggle("focus", own === lane || own === "shared");
      }
    });
    svg.addEventListener("pointerleave", () => svg.classList.remove("focusing"));
  }

  let flowing = false, last = 0;
  if (animate) {
    gsap.ticker.add(time => {
      if (!flowing || document.querySelector('[data-view="flow"]')?.hidden) return;
      const dt = Math.min(time - last, .1); last = time;
      for (const p of particles) {
        p.offset = (p.offset + dt * p.speed) % 1;
        const point = p.path.getPointAtLength(p.offset * p.length);
        p.dot.setAttribute("transform", `translate(${point.x} ${point.y})`);
        p.dot.setAttribute("opacity", Math.sin(p.offset * Math.PI).toFixed(2));
      }
    });
  }

  function fill() {
    for (const t of document.querySelectorAll(".flow-svg [data-template]")) {
      t.textContent = t.dataset.template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "…");
    }
    for (const [key, value] of Object.entries(values)) {
      for (const node of document.querySelectorAll(`[data-flow="${key}"]`)) node.textContent = value;
    }
  }

  const getJSON = path => fetch(path).then(r => r.ok ? r.json() : null).catch(() => null);
  const rate = (summary, arm) => {
    const arms = summary.levels.flatMap(l => l.arms).filter(a => a.arm === arm);
    const passed = arms.reduce((s, a) => s + a.passed, 0), graded = arms.reduce((s, a) => s + a.graded, 0);
    return graded ? `${passed}/${graded} · ${Math.round(100 * passed / graded)}%` : "pending";
  };

  async function refresh() {
    const list = await getJSON("/api/ladder");
    if (!list) return;
    const [profile, evaluation] = await Promise.all(["profile", "eval"].map(n => list.collections.includes(n) ? getJSON("/api/ladder/" + n) : null));
    if (profile) {
      const arms = profile.summary.levels.flatMap(l => l.arms);
      const passed = arms.reduce((s, a) => s + a.passed, 0), graded = arms.reduce((s, a) => s + a.graded, 0);
      values.profile = `${graded} trials · ${passed} passed`;
      const failures = {};
      for (const a of arms) for (const [k, v] of Object.entries(a.outcomes)) if (k !== "success" && k !== "error") failures[k] = (failures[k] || 0) + v;
      values.failures = Object.values(failures).reduce((s, v) => s + v, 0);
      const top = Object.entries(failures).sort((a, b) => b[1] - a[1])[0];
      values.top = top ? top[0].replaceAll("_", " ") : "—";
    }
    for (const job of list.finetunes || []) {
      const key = job.suffix.startsWith("c1") ? "c1" : "c2";
      values[key] = job.checkpoint ? "checkpoint ready ✓" : job.step != null ? `training ${Math.round(100 * job.step / (job.total_steps || 1000))}%` : (job.phase || job.status || "queued");
      if (key === "c2") {
        values.replays = Object.entries(job.mix).filter(([k]) => k.includes("teacher")).reduce((s, [, v]) => s + v, 0);
        values.selfs = Object.entries(job.mix).filter(([k]) => k.includes("model")).reduce((s, [, v]) => s + v, 0);
      }
    }
    if (evaluation) {
      values.A = rate(evaluation.summary, "stock");
      values.B = rate(evaluation.summary, "tuned");
      values.C1 = rate(evaluation.summary, "ft-naive");
      values.C2 = rate(evaluation.summary, "ft-harness");
    }
    fill();
  }

  function render() {
    const holder = document.getElementById("flow-chart");
    if (!built) build(holder);
    refresh();
    if (animate) {
      gsap.from("[data-view=flow] .version-card", { autoAlpha: 0, y: 24, duration: .6, ease: "power3.out", stagger: .08, delay: .6, clearProps: "all" });
    }
  }
  window.flow = { render };
})();
