/* Overview hero and the animated page backdrop.
   Backdrop: a drafting grid with registration crosses; orange signal pulses run along the grid lines
   and the dots near the pointer light up. Hero: static headline, live stats and pipeline.
   The 3D arm lives in hero3d.js. */
(function () {
  const gsap = window.gsap;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animate = Boolean(gsap) && !reduced;

  /* ---------- Backdrop ---------- */
  const canvas = document.getElementById("backdrop");
  const ctx = canvas.getContext("2d");
  const CELL = 32;
  const grid = document.createElement("canvas");
  const pointer = { x: -999, y: -999 };
  let width = 0, height = 0, dpr = 1, pulses = [];

  function drawGrid() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    for (const c of [canvas, grid]) {
      c.width = width * dpr;
      c.height = height * dpr;
    }
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    const g = grid.getContext("2d");
    g.scale(dpr, dpr);
    g.strokeStyle = "rgba(22,20,15,.045)";
    g.lineWidth = 1;
    g.beginPath();
    for (let x = .5; x < width; x += CELL) { g.moveTo(x, 0); g.lineTo(x, height); }
    for (let y = .5; y < height; y += CELL) { g.moveTo(0, y); g.lineTo(width, y); }
    g.stroke();
    g.fillStyle = "rgba(22,20,15,.16)";
    g.strokeStyle = "rgba(22,20,15,.22)";
    for (let i = 0; i * CELL < width; i++) {
      for (let j = 0; j * CELL < height; j++) {
        const x = i * CELL + .5, y = j * CELL + .5;
        if (i % 4 === 0 && j % 4 === 0) {
          g.beginPath();
          g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 5); g.lineTo(x, y + 5);
          g.stroke();
        } else g.fillRect(x - .75, y - .75, 1.5, 1.5);
      }
    }
  }

  function newPulse() {
    const horizontal = Math.random() < .5;
    const lane = Math.floor(Math.random() * ((horizontal ? height : width) / CELL)) * CELL + .5;
    const forward = Math.random() < .5;
    const span = horizontal ? width : height;
    return { horizontal, lane, forward, pos: forward ? -80 : span + 80, speed: 60 + Math.random() * 90, length: 70 + Math.random() * 90 };
  }

  function frame(dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(grid, 0, 0, width, height);
    for (const p of pulses) {
      p.pos += (p.forward ? 1 : -1) * p.speed * dt;
      const tail = p.pos - (p.forward ? p.length : -p.length);
      const [x1, y1, x2, y2] = p.horizontal ? [tail, p.lane, p.pos, p.lane] : [p.lane, tail, p.lane, p.pos];
      const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
      gradient.addColorStop(0, "rgba(255,90,31,0)");
      gradient.addColorStop(1, "rgba(255,90,31,.55)");
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.fillStyle = "rgba(255,90,31,.8)";
      ctx.fillRect(x2 - 1.5, y2 - 1.5, 3, 3);
    }
    const span = p => p.horizontal ? width : height;
    pulses = pulses.map(p => (p.pos < -200 || p.pos > span(p) + 200) ? newPulse() : p);
    if (pointer.x > -999) {
      const reach = 130;
      const i0 = Math.max(0, Math.floor((pointer.x - reach) / CELL)), i1 = Math.ceil((pointer.x + reach) / CELL);
      const j0 = Math.max(0, Math.floor((pointer.y - reach) / CELL)), j1 = Math.ceil((pointer.y + reach) / CELL);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const x = i * CELL + .5, y = j * CELL + .5;
          const d = Math.hypot(x - pointer.x, y - pointer.y);
          if (d > reach) continue;
          const k = 1 - d / reach;
          ctx.fillStyle = `rgba(255,90,31,${(.55 * k).toFixed(3)})`;
          const s = 1.5 + 2.5 * k;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
      }
    }
  }

  drawGrid();
  if (animate) {
    pulses = Array.from({ length: 14 }, () => { const p = newPulse(); p.pos = Math.random() * (p.horizontal ? width : height); return p; });
    let last = performance.now(), acc = 0;
    // About 30 frames a second is plenty for a backdrop and keeps the laptop free for the simulator.
    const loop = now => {
      requestAnimationFrame(loop);
      acc += now - last; last = now;
      if (document.hidden || acc < 33) return;
      frame(Math.min(acc, 100) / 1000);
      acc = 0;
    };
    requestAnimationFrame(loop);
    window.addEventListener("pointermove", e => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });
    document.addEventListener("pointerleave", () => { pointer.x = pointer.y = -999; });
  } else frame(0);
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { drawGrid(); if (!animate) frame(0); }, 150); });

  /* ---------- Live data ---------- */
  function count(key, value) {
    for (const node of document.querySelectorAll(`[data-count="${key}"]`)) {
      node.textContent = Math.round(value).toLocaleString() + (node.dataset.suffix || "");
    }
  }
  const pretty = key => key.replaceAll("_", " ");
  const metric = (stage, text) => { document.querySelector(`[data-stage="${stage}"] .pl-metric`).textContent = text; };
  const getJSON = path => fetch(path).then(r => r.ok ? r.json() : null).catch(() => null);
  const totals = (summary, arm) => summary.levels.flatMap(l => l.arms).filter(a => !arm || a.arm === arm)
    .reduce((t, a) => ({ passed: t.passed + a.passed, graded: t.graded + a.graded }), { passed: 0, graded: 0 });

  async function refresh() {
    const list = await getJSON("/api/ladder");
    if (!list) return;
    const have = name => list.collections.includes(name);
    const [profile, teacher, evaluation] = await Promise.all(["profile", "c2-teacher", "eval"].map(n => have(n) ? getJSON("/api/ladder/" + n) : null));
    let trials = 0, calls = 0;
    for (const d of [profile, evaluation]) if (d) { trials += d.summary.trials; calls += d.summary.calls; }
    count("trials", trials);
    count("calls", calls);
    if (profile) {
      const t = totals(profile.summary);
      metric("profile", `${t.passed}/${t.graded} passed`);
      const failures = {};
      for (const a of profile.summary.levels.flatMap(l => l.arms)) {
        for (const [k, v] of Object.entries(a.outcomes)) if (k !== "success" && k !== "error") failures[k] = (failures[k] || 0) + v;
      }
      const top = Object.entries(failures).sort((a, b) => b[1] - a[1])[0];
      const failed = Object.values(failures).reduce((s, v) => s + v, 0);
      if (top) metric("diagnose", `${failed} failures · top: ${pretty(top[0])}`);
    }
    if (teacher) {
      const t = totals(teacher.summary);
      metric("teach", `${t.passed}/${t.graded} demos clean`);
    }
    const jobs = list.finetunes || [];
    if (jobs.length) {
      const done = jobs.filter(j => j.checkpoint).length;
      metric("finetune", done ? `${done}/${jobs.length} checkpoints ready` : `${jobs.length} jobs training`);
      const bars = document.querySelector('[data-stage="finetune"] .pl-bars');
      bars.replaceChildren(...jobs.map(j => {
        const row = document.createElement("div");
        row.className = "pl-bar";
        const share = j.checkpoint ? 1 : (j.step || 0) / (j.total_steps || 1000);
        row.innerHTML = `<span>${j.suffix.startsWith("c1") ? "C1" : "C2"}</span><i><b></b></i><span>${Math.round(share * 100)}%</span>`;
        row.querySelector("b").style.width = share * 100 + "%";
        return row;
      }));
    }
    if (evaluation) {
      const a = totals(evaluation.summary, "stock"), b = totals(evaluation.summary, "tuned");
      count("rateA", a.graded ? 100 * a.passed / a.graded : 0);
      count("rateB", b.graded ? 100 * b.passed / b.graded : 0);
      metric("prove", `A ${a.passed}/${a.graded} · B ${b.passed}/${b.graded}`);
    }
  }
  refresh();
  setInterval(() => { if (!document.hidden && !document.querySelector('[data-view="workspace"]').hidden) refresh(); }, 60000);
})();
