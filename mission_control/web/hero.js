/* Overview hero and the animated page backdrop.
   Backdrop: a drafting grid with registration crosses; orange signal pulses run along the grid lines
   and the dots near the pointer light up. Hero: a two-link arm solved by inverse kinematics picks the
   orange and places it in the bowl; the stats and pipeline read the live ladder data. */
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

  /* ---------- Arm (two-link inverse kinematics) ---------- */
  const SHOULDER = { x: 100, y: 248 }, L1 = 165, L2 = 150;
  const $ = id => document.getElementById(id);
  const parts = ["link1", "link1-in", "link2", "link2-in", "shoulder", "elbow", "gripper", "finger-l", "finger-r", "orange",
                 "arm-trace", "arm-glow", "ro-j1", "ro-j2", "ro-tcp", "ro-grip", "ro-phase"].reduce((o, id) => (o[id] = $(id), o), {});
  const tcp = { x: 180, y: 150, grip: 1 };
  const orange = { x: 240, y: 286, held: false, opacity: 1 };
  const trace = [];

  function solve(x, y) {
    const dx = x - SHOULDER.x, dy = y - SHOULDER.y;
    const d = Math.min(Math.hypot(dx, dy), L1 + L2 - 1);
    const cos2 = (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2);
    const t2 = Math.acos(Math.max(-1, Math.min(1, cos2)));
    const base = Math.atan2(dy, dx);
    const k = Math.atan2(L2 * Math.sin(t2), L1 + L2 * Math.cos(t2));
    // Of the two solutions, keep the one with the elbow raised (smaller y on screen).
    const a = base - k, b = base + k;
    const ea = SHOULDER.y + L1 * Math.sin(a), eb = SHOULDER.y + L1 * Math.sin(b);
    const t1 = ea < eb ? a : b;
    const elbow = { x: SHOULDER.x + L1 * Math.cos(t1), y: SHOULDER.y + L1 * Math.sin(t1) };
    const end = { x: SHOULDER.x + d * Math.cos(base), y: SHOULDER.y + d * Math.sin(base) };
    return { t1, t2: ea < eb ? t2 : -t2, elbow, end };
  }

  const setLine = (node, a, b) => { node.setAttribute("x1", a.x); node.setAttribute("y1", a.y); node.setAttribute("x2", b.x); node.setAttribute("y2", b.y); };

  function drawArm() {
    const s = solve(tcp.x, tcp.y);
    setLine(parts.link1, SHOULDER, s.elbow); setLine(parts["link1-in"], SHOULDER, s.elbow);
    setLine(parts.link2, s.elbow, s.end); setLine(parts["link2-in"], s.elbow, s.end);
    parts.shoulder.setAttribute("cx", SHOULDER.x); parts.shoulder.setAttribute("cy", SHOULDER.y);
    parts.elbow.setAttribute("cx", s.elbow.x); parts.elbow.setAttribute("cy", s.elbow.y);
    parts.gripper.setAttribute("transform", `translate(${s.end.x} ${s.end.y})`);
    const open = 4 + 9 * tcp.grip;
    parts["finger-l"].setAttribute("x", -open - 5);
    parts["finger-r"].setAttribute("x", open);
    if (orange.held) { orange.x = s.end.x; orange.y = s.end.y + 32; }
    parts.orange.setAttribute("cx", orange.x); parts.orange.setAttribute("cy", orange.y);
    parts["arm-glow"].setAttribute("cx", s.end.x); parts["arm-glow"].setAttribute("cy", s.end.y + 20);
    trace.push(`${s.end.x.toFixed(1)},${(s.end.y + 24).toFixed(1)}`);
    if (trace.length > 70) trace.shift();
    parts["arm-trace"].setAttribute("d", "M" + trace.join("L"));
    parts["ro-j1"].textContent = (-s.t1 * 180 / Math.PI).toFixed(1) + "°";
    parts["ro-j2"].textContent = (-s.t2 * 180 / Math.PI).toFixed(1) + "°";
    // 100 SVG units are drawn as 0.10 m on the dimension line.
    parts["ro-tcp"].textContent = Math.round(s.end.x - SHOULDER.x) + ", " + Math.round(SHOULDER.y - s.end.y);
    parts["ro-grip"].textContent = Math.round(tcp.grip * 100) + "%";
  }

  const phase = name => () => { parts["ro-phase"].textContent = name; };
  drawArm();
  if (animate) {
    const tl = gsap.timeline({ repeat: -1, repeatDelay: .6, defaults: { ease: "power2.inOut" }, onUpdate: drawArm });
    tl.call(phase("reach"))
      .to(tcp, { x: 240, y: 200, duration: 1.1 })
      .call(phase("descend"))
      .to(tcp, { y: 254, duration: .7, ease: "power1.out" })
      .call(phase("grasp"))
      .to(tcp, { grip: 0, duration: .35 })
      .call(() => { orange.held = true; })
      .call(phase("lift"))
      .to(tcp, { y: 170, duration: .7, ease: "power2.out" })
      .call(phase("transfer"))
      .to(tcp, { x: 390, y: 180, duration: 1.2 })
      .to(tcp, { y: 222, duration: .55, ease: "power1.out" })
      .call(phase("release"))
      .call(() => { orange.held = false; })
      .to(tcp, { grip: 1, duration: .3 })
      .to(orange, { y: 258, duration: .35, ease: "bounce.out" }, "<")
      .call(phase("settle ✓"))
      .to(tcp, { x: 330, y: 150, duration: .8 })
      .call(phase("home"))
      .to(tcp, { x: 180, y: 150, duration: 1 })
      .to(orange, { opacity: 0, duration: .3, onUpdate: () => parts.orange.setAttribute("opacity", orange.opacity) }, "<")
      .call(() => { orange.x = 240; orange.y = 286; orange.opacity = 1; parts.orange.setAttribute("opacity", 1); })
      .fromTo(parts.orange, { attr: { r: 0 } }, { attr: { r: 14 }, duration: .4, ease: "back.out(2)", immediateRender: false });
    // Only animate while the hero is on screen.
    new IntersectionObserver(([entry]) => entry.isIntersecting ? tl.resume() : tl.pause()).observe($("hero-title").closest(".hero"));
  }

  /* ---------- Headline and entrance ---------- */
  const title = $("hero-title");
  function splitWords(node) {
    const out = [];
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.append(part); continue; }
          const mask = document.createElement("span"); mask.className = "word";
          const inner = document.createElement("span"); inner.textContent = part;
          mask.append(inner); frag.append(mask); out.push(inner);
        }
        child.replaceWith(frag);
      } else out.push(...splitWords(child));
    }
    return out;
  }
  if (animate) {
    const words = splitWords(title);
    const intro = gsap.timeline({ delay: .35 });
    intro.from(".hero-eyebrow", { autoAlpha: 0, y: 10, duration: .5, ease: "power3.out" })
      .from(words, { yPercent: 110, duration: .8, ease: "expo.out", stagger: .045 }, "-=.2")
      .from(".hero-lede, .hero-actions", { autoAlpha: 0, y: 16, duration: .6, ease: "power3.out", stagger: .1 }, "-=.5")
      .from(".hero-stats > div", { autoAlpha: 0, y: 16, duration: .5, ease: "power3.out", stagger: .08 }, "-=.4")
      .from(".hero-arm", { autoAlpha: 0, scale: .96, duration: .9, ease: "power3.out" }, .3)
      .from(".pipeline li", { autoAlpha: 0, y: 24, duration: .6, ease: "power3.out", stagger: .08 }, "-=.6");
  }

  /* Signal running along the pipeline. */
  const pipeline = document.querySelector(".pipeline");
  const runner = document.createElement("span");
  runner.className = "pl-runner";
  pipeline.append(runner);
  if (animate) {
    gsap.fromTo(runner, { left: "0%", autoAlpha: 0 }, { left: "100%", autoAlpha: 1, duration: 4.5, ease: "none", repeat: -1,
      onUpdate() {
        const at = this.progress();
        pipeline.querySelectorAll("li").forEach((li, i) => li.classList.toggle("lit", Math.abs(at - (i + .5) / 5) < .1));
      } });
  }

  /* ---------- Live data ---------- */
  const counters = {};
  function count(key, value) {
    for (const node of document.querySelectorAll(`[data-count="${key}"]`)) {
      const suffix = node.dataset.suffix || "";
      const from = counters[key] ?? 0;
      counters[key] = value;
      if (!animate) { node.textContent = Math.round(value).toLocaleString() + suffix; continue; }
      const box = { v: from };
      gsap.to(box, { v: value, duration: 1.6, ease: "power3.out", onUpdate: () => { node.textContent = Math.round(box.v).toLocaleString() + suffix; } });
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
        const fill = row.querySelector("b");
        if (animate) gsap.fromTo(fill, { width: 0 }, { width: share * 100 + "%", duration: 1.4, ease: "power3.out", delay: .4 });
        else fill.style.width = share * 100 + "%";
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
