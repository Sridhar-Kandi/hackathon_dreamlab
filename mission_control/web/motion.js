/* Motion layer for the console: navbar indicator, page entrances and Ladder reveals.
   Everything here is decoration; if GSAP is missing or the viewer prefers reduced motion,
   the page works and simply does not animate. */
(function () {
  const gsap = window.gsap;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const enabled = () => Boolean(gsap) && !reduced.matches;
  const tabOrder = ["workspace","flow","runs","ladder","compare","datasets"];
  let lastIndex = 0;

  /* Navbar: one sliding bar under the active link and one soft highlight that follows the pointer. */
  const nav = document.querySelector(".topbar nav");
  const bar = document.createElement("span");
  bar.className = "nav-indicator";
  const hover = document.createElement("span");
  hover.className = "nav-hover";
  nav.prepend(hover, bar);

  function place(target, link, instant) {
    const box = { x: link.offsetLeft, width: link.offsetWidth };
    if (!enabled() || instant) {
      if (gsap) gsap.set(target, box);
      else Object.assign(target.style, { transform: `translateX(${box.x}px)`, width: box.width + "px" });
      return;
    }
    gsap.to(target, { ...box, duration: .55, ease: "expo.out", overwrite: true });
  }

  function moveIndicator(instant) {
    const active = nav.querySelector('a[aria-current="page"]');
    if (!active) {
      bar.style.opacity = "0";
      return;
    }
    bar.style.opacity = "1";
    if (!enabled() || instant) return place(bar, active, true);
    // A quick stretch toward the destination before settling reads as the bar travelling, not jumping.
    const from = bar.offsetWidth ? gsap.getProperty(bar, "x") : active.offsetLeft;
    const to = active.offsetLeft;
    const left = Math.min(from, to);
    const right = Math.max(from + bar.offsetWidth, to + active.offsetWidth);
    gsap.timeline({ overwrite: true })
      .to(bar, { x: left, width: right - left, duration: .18, ease: "power2.in" })
      .to(bar, { x: to, width: active.offsetWidth, duration: .45, ease: "expo.out" });
  }

  for (const link of nav.querySelectorAll("a")) {
    link.addEventListener("pointerenter", () => {
      const first = hover.style.opacity !== "1";
      hover.style.opacity = "1";
      place(hover, link, first);
    });
  }
  nav.addEventListener("pointerleave", () => { hover.style.opacity = "0"; });
  window.addEventListener("resize", () => moveIndicator(true));

  /* Topbar tightens and gains a shadow once the page scrolls. */
  const topbar = document.querySelector(".topbar");
  const onScroll = () => topbar.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* The primary button leans toward the pointer a little. */
  const cta = document.getElementById("new-run");
  if (cta) {
    cta.addEventListener("pointermove", event => {
      if (!enabled()) return;
      const r = cta.getBoundingClientRect();
      gsap.to(cta, { x: (event.clientX - r.left - r.width / 2) * .18, y: (event.clientY - r.top - r.height / 2) * .3,
                     duration: .3, ease: "power3.out" });
    });
    cta.addEventListener("pointerleave", () => enabled() && gsap.to(cta, { x: 0, y: 0, duration: .6, ease: "elastic.out(1, .4)" }));
  }

  /* What should cascade in when a view appears, in reading order. */
  const pieces = ".page-header, .stage, .section-head, #legend > *, .panel, .ladder-level, .comparison-fields, .empty, .back";

  function cascade(root, fromX) {
    // The Ladder results animate themselves (revealLadder), so a page entrance leaves them alone.
    const own = node => !node.closest("[hidden]") && (root.id === "ladder-content" || !node.closest("#ladder-content"));
    const items = [...root.querySelectorAll(pieces)].filter(own);
    const rows = [...root.querySelectorAll("tbody tr")].filter(own).slice(0, 40);
    const tl = gsap.timeline();
    tl.fromTo(items, { autoAlpha: 0, x: fromX, y: 14 },
              { autoAlpha: 1, x: 0, y: 0, duration: .55, ease: "power3.out", stagger: .06, clearProps: "transform,opacity,visibility" });
    if (rows.length) {
      tl.fromTo(rows, { autoAlpha: 0, y: 8 },
                { autoAlpha: 1, y: 0, duration: .35, ease: "power2.out", stagger: .018, clearProps: "transform,opacity,visibility" }, .15);
    }
    return tl;
  }

  /* Called by the router after a view is shown. `changed` is false for background refreshes. */
  function enterView(page, changed) {
    const tab = page === "run" ? "runs" : page;
    if (!changed || !enabled()) return;
    const index = tabOrder.indexOf(tab);
    const direction = index < 0 || index === lastIndex ? 0 : index > lastIndex ? 1 : -1;
    if (index >= 0) lastIndex = index;
    const view = document.querySelector(`[data-view="${page}"]`);
    if (view) cascade(view, direction * 28);
  }

  /* Ladder results: bars grow from zero, confidence bands fade in, the seed grid ripples outward. */
  function revealLadder(root) {
    if (!enabled()) return;
    cascade(root, 0);
    for (const fill of root.querySelectorAll(".rate-fill")) {
      gsap.from(fill, { width: 0, duration: 1.1, ease: "power3.out", delay: .25 });
    }
    gsap.from(root.querySelectorAll(".rate-ci"), { autoAlpha: 0, scaleX: .2, duration: .6, ease: "back.out(2)", delay: .7, stagger: .04 });
    for (const grid of root.querySelectorAll(".seed-grid")) {
      const cells = grid.querySelectorAll(".grid-cell, .grid-seed, button");
      gsap.from(cells, { autoAlpha: 0, scale: .85, duration: .4, ease: "back.out(1.6)", stagger: { each: .008, from: "start" },
                         clearProps: "transform,opacity,visibility" });
    }
  }

  /* Side-by-side video: panes slide up one after another. */
  function revealPanes(holder) {
    if (!enabled()) return;
    gsap.fromTo(holder, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: .5, ease: "power3.out", clearProps: "transform,opacity,visibility" });
    gsap.from(holder.querySelectorAll(".sbs-pane"), { autoAlpha: 0, y: 30, scale: .97, duration: .6, ease: "power3.out", stagger: .09, delay: .1,
                                                       clearProps: "transform,opacity,visibility" });
  }

  /* First paint: the bar drops in and the links follow. */
  if (enabled()) {
    gsap.from(topbar, { yPercent: -100, duration: .7, ease: "expo.out" });
    gsap.from(nav.querySelectorAll("a"), { autoAlpha: 0, y: -10, duration: .5, ease: "power3.out", stagger: .05, delay: .2 });
    gsap.from(".brand span", { rotate: -180, duration: .9, ease: "elastic.out(1, .5)", delay: .3 });
  }

  window.motion = { enterView, revealLadder, revealPanes, moveIndicator };
})();
