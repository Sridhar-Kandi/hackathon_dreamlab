"use strict";

const byId = id => document.getElementById(id);
const form = byId("setup-form");
const active = new Set(["queued", "running", "stopping"]);
const state = { runs: [], results: [], request: 0, review: null, detail: null, stageTrial: null, players: {} };
const labels = {
  success: "Passed", succeeded: "Passed", failure: "Failed", task_failed: "Failed",
  queued: "Queued", running: "Running", stopping: "Stopping", completed: "Finished",
  completed_with_errors: "Finished with errors", cancelled: "Cancelled", interrupted: "Interrupted",
  pending: "Pending", error: "Error", incomplete: "Incomplete", blocked: "Blocked",
  not_started: "Not started", not_reached: "Not reached", ready: "Ready",
  task_timeout: "Step time limit reached", final_placement_lost: "Final placement check failed",
  never_touched: "No target contact", touched_no_lift: "Contact without a verified lift",
  wrong_destination: "Wrong destination", fell_off_table: "Object fell off the table",
  lifted_missed_goal: "Object lifted but missed its destination", at_goal_not_settled: "Object did not settle",
  contact: "Gripper contacted target", lift: "Lift verified", step_started: "Step started",
  step_succeeded: "Placement settled", step_failed: "Step failed", step_interrupted: "Step interrupted",
  request_started: "Model request started", request_completed: "Model reply validated", attempt_error: "Attempt error"
};
const stepNames = { "orange-bowl": "Orange → bowl", "banana-plate": "Banana → plate" };
const sceneNames = { stock: "Stock tabletop", racks: "Tube racks", hold_fill: "Cup and tube", blocks2: "Two-block scene" };
const columnTips = {
  Procedure: "What the trial asked for. Single placement: one object to one destination. Two steps: orange into the bowl, then banana onto the plate in the same trial; the banana step starts only after the orange has settled. The limit is the most simulated time the trial may use.",
  Controller: "Who moved the arms. Scripted: a local controller that reads true object positions, no Dream-1 calls and no credits. Dream-1: the hosted model, driven only by the three camera views.",
  Seed: "Fixes the starting positions. Two runs with the same seed start from the same scene, so their trials can be compared one to one.",
  Placement: "The object and destination checked in this row. A two-step trial has one row per step.",
  Contact: "Simulated time when a gripper first touched the object. 'not seen' means the step ran but this never happened.",
  Lift: "Simulated time when the object was held at least 5 cm above its start for five control steps (0.25 s) while in contact.",
  Settle: "Simulated time when the object was at its destination, clear of both arms and moving under 3 cm/s for one second. This is the pass condition.",
  Result: "Passed: the settle check was met. Failed: the step ran but did not settle in time. Not reached: an earlier step failed, so this step never started.",
  "Where it stopped": "The first stage the step did not reach, read from the physics measurements."
};

function label(value) {
  const key = String(value ?? "").toLowerCase();
  if (!key) return "—";
  return labels[key] || key.charAt(0).toUpperCase() + key.slice(1).replaceAll("_", " ");
}
function element(name, text, className) {
  const node = document.createElement(name);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function link(text, href, className) {
  const node = element("a", text, className);
  node.href = href;
  return node;
}
function status(code) {
  const key = String(code).toLowerCase();
  let tone = "";
  if (["success","succeeded","ready","completed"].includes(key)) tone = " good";
  if (["running","queued","stopping"].includes(key)) tone = " active";
  if (["blocked","interrupted","cancelled","completed_with_errors"].includes(key)) tone = " warn";
  if (["failure","task_failed","error"].includes(key)) tone = " bad";
  if (["not_reached","pending","not_started"].includes(key)) tone = " idle";
  return element("span",label(key),"status" + tone);
}
function panel(title, ...children) {
  const node = element("section",null,"panel");
  node.append(element("h2",title),...children);
  return node;
}
function box(text) { return element("p",text,"empty"); }
function seconds(value) { return Number.isFinite(value) ? value.toFixed(1) + " s" : "—"; }
function runDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
}
function headerCell(title) {
  const cell = element("th");
  cell.scope = "col";
  if (columnTips[title]) {
    const tip = element("span",title,"tip");
    tip.tabIndex = 0;
    tip.dataset.tip = columnTips[title];
    cell.append(tip);
  } else cell.textContent = title;
  return cell;
}
function table(headers, rows) {
  const wrapper = element("div",null,"table-wrap");
  const node = element("table");
  const head = node.createTHead().insertRow();
  for (const title of headers) head.append(headerCell(title));
  const body = node.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) {
      const cell = row.insertCell();
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value ?? "—";
    }
  }
  wrapper.append(node);
  return wrapper;
}
function facts(items) {
  const list = element("dl",null,"facts");
  for (const [name,value] of items) {
    const row = element("div");
    row.append(element("dt",name),element("dd",value ?? "—"));
    list.append(row);
  }
  return list;
}
async function api(path, body) {
  const options = {cache:"no-store"};
  if (body !== undefined) Object.assign(options,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const response = await fetch(path,options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}
function notice(text) {
  byId("notice").textContent = text || "";
  byId("notice").hidden = !text;
}
function addOption(select, value, text) { select.add(new Option(text,value)); }
function runPath(id) { return "/api/experiments/" + encodeURIComponent(id); }
function runLink(run) { return "#run/" + encodeURIComponent(run.id); }
function trialLink(run, trial) { return runLink(run) + "/" + encodeURIComponent(trial.id); }
function controllerName(run) { return run?.model === "oracle" ? "Scripted" : "Dream-1"; }
function procedureName(run) { return run.task_id === "orange-banana" ? "Two steps" : "Single placement"; }
function newestFirst(runs) { return [...runs].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))); }

/* Step timing: events carry simulated seconds; older single-step rows only carry row indices (50 ms each). */
function trialSteps(run, trial) {
  if (trial.ordered_steps?.length) return trial.ordered_steps;
  return [{id:run.plan?.steps?.[0]?.id || run.task_id, status:trial.status === "SUCCESS" ? "succeeded" : "task_failed", evidence:trial}];
}
function stepTimes(trial, step) {
  const events = (trial.events || []).filter(event => event.step_id === step.id);
  const at = kind => events.find(event => event.kind === kind)?.sim_s;
  const start = at("step_started") ?? 0;
  const fromRow = row => Number.isInteger(row) ? start + (row + 1) / 20 : null;
  const evidence = step.evidence || {};
  return {
    start, contact: at("contact") ?? fromRow(evidence.first_contact_row),
    lift: at("lift") ?? fromRow(evidence.lifted_row),
    settle: at("step_succeeded") ?? (evidence.success ? fromRow(evidence.goal_row) : null),
    failed: at("step_failed")
  };
}
function stepResult(step) {
  if (!step.evidence || step.status === "pending") return "not_reached";
  if (step.status === "succeeded" || step.evidence.success) return "succeeded";
  return "task_failed";
}

/* Recording player: the video's clock is simulated time, so event times seek directly. */
function player(run, trial) {
  const cached = state.players[trial.id];
  if (cached) return cached;
  const root = element("div",null,"player");
  if (!trial.recording_url) {
    const empty = element("div","No camera recording was saved for this trial.","no-media");
    state.players[trial.id] = empty;
    return empty;
  }
  const screen = element("div",null,"screen");
  const isVideo = trial.recording_kind === "mp4";
  const media = element(isVideo ? "video" : "img");
  media.src = trial.recording_url;
  if (isVideo) Object.assign(media,{muted:true,loop:true,autoplay:true,playsInline:true,preload:"auto"});
  media.setAttribute("aria-label","Camera recording, trial seed " + trial.seed);
  screen.append(media);
  if (isVideo) {
    screen.append(element("span","OVERHEAD · model input","cam top"),element("span","LEFT WRIST","cam left"),
      element("span","RIGHT WRIST","cam right"));
  }
  const passed = trial.status === "SUCCESS";
  screen.append(element("span",passed ? "Passed" : label(trial.outcome),"verdict" + (passed ? "" : " fail")));
  root.append(screen);
  const total = trial.sim_s || 1;
  const steps = trialSteps(run,trial);
  const track = element("div",null,"track");
  track.append(element("div",null,"track-bar"));
  const fill = element("div",null,"track-fill");
  const head = element("div",null,"playhead");
  track.append(fill);
  const pct = t => Math.min(100,Math.max(0,100 * t / total)) + "%";
  for (const step of steps) {
    const times = stepTimes(trial,step);
    if (!step.evidence) continue;
    const span = element("div",stepNames[step.id] || label(step.id),"track-step");
    span.style.left = pct(times.start);
    track.append(span);
    const marks = [["contact","C",times.contact],["lift","L",times.lift],
      times.settle != null ? ["settle","S",times.settle] : ["fail","✕",times.failed]];
    for (const [kind,short,time] of marks) {
      if (time == null) continue;
      const mark = element("button",null,"marker " + kind);
      mark.type = "button";
      mark.style.left = pct(time);
      mark.dataset.short = short;
      mark.title = (stepNames[step.id] || "") + " · " + kind + " at " + seconds(time);
      mark.setAttribute("aria-label",mark.title);
      if (isVideo) mark.onclick = event => { event.stopPropagation(); seek(time); };
      track.append(mark);
    }
  }
  track.append(head);
  const clock = element("span","0.00 / " + total.toFixed(2) + " s","clock");
  const toggle = element("button","Pause");
  toggle.type = "button";
  const rate = element("button","1×","rate");
  rate.type = "button";
  const rates = [1,0.5,0.25,2];
  function seek(time) {
    if (!isVideo) return;
    media.currentTime = Math.min(Math.max(time,0),media.duration || total);
  }
  if (isVideo) {
    toggle.onclick = () => { if (media.paused) media.play(); else media.pause(); };
    media.onplay = () => { toggle.textContent = "Pause"; };
    media.onpause = () => { toggle.textContent = "Play"; };
    rate.onclick = () => {
      const next = rates[(rates.indexOf(media.playbackRate) + 1) % rates.length];
      media.playbackRate = next;
      rate.textContent = next + "×";
    };
    let dragging = false;
    const fromPointer = event => {
      const box = track.getBoundingClientRect();
      seek(total * (event.clientX - box.left) / box.width);
    };
    track.onpointerdown = event => { dragging = true; track.setPointerCapture(event.pointerId); fromPointer(event); };
    track.onpointermove = event => { if (dragging) fromPointer(event); };
    track.onpointerup = () => { dragging = false; };
    const tick = () => {
      if (!root.isConnected && state.players[trial.id] !== root) return;
      const time = media.currentTime || 0;
      head.style.left = fill.style.width = pct(time);
      clock.textContent = time.toFixed(2) + " / " + total.toFixed(2) + " s";
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } else {
    toggle.disabled = rate.disabled = true;
    clock.textContent = total.toFixed(2) + " s · GIF";
  }
  const controls = element("div",null,"controls");
  controls.append(toggle,clock,track,rate);
  root.append(controls);
  root.seek = seek;
  state.players[trial.id] = root;
  return root;
}

const legendItems = [
  ["Procedure","<b>Single placement</b>: one object, one destination. <b>Two steps</b>: orange into the bowl, then banana onto the plate in one trial. The limit is the simulated time allowed."],
  ["Controller","<b>Scripted</b>: local controller using true object positions, no credits. <b>Dream-1</b>: the hosted model, seeing only the cameras."],
  ["Seed","Fixes the starting positions. Same seed, same start: trials can be compared one to one."],
  ["Contact · Lift · Settle","Simulated seconds when each stage was first measured. <b>Settle</b> (at the destination, arms clear, still for 1 s) is the pass condition."],
  ["Marks","<b>not seen</b>: the step ran, the stage never happened. <b>—</b>: the step never started."],
  ["Result","<b>Passed</b> settled in time · <b>Failed</b> ran out of time · <b>Not reached</b> an earlier step failed."]
];
function renderLegend() {
  const list = element("dl",null,"legend");
  for (const [term,text] of legendItems) {
    const row = element("div");
    const description = element("dd");
    description.innerHTML = text;
    row.append(element("dt",term),description);
    list.append(row);
  }
  byId("legend").replaceChildren(list);
}

function stageCell(time, ran) {
  const cell = element("td",null,"stage-cell");
  if (!ran) cell.append(element("span","—","na"));
  else if (time == null) cell.append(element("span","not seen","no"));
  else cell.textContent = seconds(time);
  return cell;
}
function whereStopped(step, times, trial) {
  if (trial.error) return trial.error;
  if (!step.evidence) return "Step never started";
  if (times.settle != null) return "—";
  const failed = (trial.events || []).find(event => event.step_id === step.id && event.kind === "step_failed");
  if (failed?.reason === "final_placement_lost") return "Final placement check failed";
  const cause = failed?.reason === "task_timeout" ? "Time limit · " : "";
  if (times.contact == null) return cause + "never touched the object";
  if (times.lift == null) return cause + "touched, never lifted";
  return cause + "lifted, never settled";
}
function selectStage(run, trial) {
  state.stageTrial = trial.id;
  renderStage();
  for (const row of document.querySelectorAll("#fresh-results tr[data-trial]")) {
    row.classList.toggle("selected",row.dataset.trial === trial.id);
  }
}
function defaultStageTrial() {
  for (const run of newestFirst(state.runs)) {
    const trials = state.results.filter(trial => trial.experiment_id === run.id && trial.recording_url);
    const best = trials.find(trial => trial.status === "SUCCESS") || trials[0];
    if (best) return best;
  }
  return null;
}
function renderStage() {
  const trial = state.results.find(entry => entry.id === state.stageTrial) || defaultStageTrial();
  const holder = byId("stage-player");
  const caption = byId("stage-caption");
  if (!trial) {
    caption.textContent = "";
    holder.replaceChildren(box("No recordings yet. Run a task with camera recording on, then its video appears here."));
    return;
  }
  state.stageTrial = trial.id;
  const run = state.runs.find(entry => entry.id === trial.experiment_id);
  caption.replaceChildren(document.createTextNode([procedureName(run),controllerName(run),"seed " + trial.seed,
    runDate(trial.started_at || run.created_at)].join(" · ") + " · "),link("Trial details",trialLink(run,trial),"text-link"));
  const node = player(run,trial);
  if (holder.firstChild !== node) holder.replaceChildren(node);
}
function renderWorkspace() {
  renderStage();
  const wrapper = table(["Procedure","Controller","Seed","Placement","Contact","Lift","Settle","Result","Where it stopped"],[]);
  const body = wrapper.querySelector("tbody");
  for (const run of newestFirst(state.runs)) {
    const trials = state.results.filter(entry => entry.experiment_id === run.id).sort((a,b) => a.seed - b.seed);
    for (const trial of trials) {
      const steps = trialSteps(run,trial);
      steps.forEach((step, index) => {
        const row = body.insertRow();
        row.dataset.trial = trial.id;
        row.className = (index === 0 ? "group-start" : "") + (trial.id === state.stageTrial ? " selected" : "");
        row.onclick = () => { selectStage(run,trial); byId("stage-title").scrollIntoView({behavior:"smooth"}); };
        if (index === 0) {
          const procedure = row.insertCell();
          procedure.rowSpan = steps.length;
          procedure.append(element("div",procedureName(run)),element("small",run.sim_seconds + " s limit","na"));
          const controller = row.insertCell();
          controller.rowSpan = steps.length;
          controller.textContent = controllerName(run);
          const seed = row.insertCell();
          seed.rowSpan = steps.length;
          const seedLink = link(String(trial.seed),trialLink(run,trial),"text-link");
          seedLink.onclick = event => event.stopPropagation();
          seed.append(seedLink);
        }
        const times = stepTimes(trial,step);
        const ran = Boolean(step.evidence);
        row.insertCell().textContent = stepNames[step.id] || run.name;
        row.append(stageCell(times.contact,ran),stageCell(times.lift,ran),stageCell(times.settle,ran));
        row.insertCell().append(status(stepResult(step)));
        row.insertCell().textContent = whereStopped(step,times,trial);
      });
    }
  }
  byId("fresh-results").replaceChildren(body.rows.length ? wrapper :
    box("No results yet. Start a run to collect measured outcomes."));
}
function renderRunLog() {
  const rows = newestFirst(state.runs).map(run => {
    const metrics = run.metrics;
    return [link(run.name,runLink(run),"text-link"),controllerName(run),runDate(run.created_at),
      status(run.status),metrics.successes + " / " + metrics.valid];
  });
  byId("run-list").replaceChildren(rows.length ? table(["Procedure","Controller","Started","Run status","Passed / graded"],rows) :
    box("No runs recorded. The log updates when a new simulation starts."));
}
function compareOptions() {
  const baseline = byId("baseline");
  const changed = byId("changed");
  const ready = newestFirst(state.runs).filter(run => run.trial_ids.length);
  byId("comparison-form").hidden = ready.length < 2;
  if (ready.length < 2) {
    byId("comparison").replaceChildren(box("Record at least two runs to compare their trial outcomes."));
    return;
  }
  for (const [select,fallback] of [[baseline,ready[1].id],[changed,ready[0].id]]) {
    const value = select.value;
    select.replaceChildren();
    for (const run of ready) addOption(select,run.id,run.name + " · " + controllerName(run) + " · " + runDate(run.created_at));
    select.value = ready.some(run => run.id === value) ? value : fallback;
  }
}
async function compareRuns(event) {
  event.preventDefault();
  const holder = byId("comparison");
  const search = new URLSearchParams({baseline:byId("baseline").value,candidate:byId("changed").value});
  try {
    const compare = await api("/api/comparison?" + search);
    const config = compare.changes.length ? table(["Setting","Baseline","Comparison"],compare.changes.map(row =>
      [label(row.field),row.baseline == null ? "—" : String(row.baseline),row.candidate == null ? "—" : String(row.candidate)])) :
      box("The recorded run settings match.");
    const rows = compare.pairs.map(pair => [pair.seed,
      pair.baseline ? link(label(pair.baseline_status),trialLink(compare.a,{id:pair.baseline})) : "—",
      pair.candidate ? link(label(pair.candidate_status),trialLink(compare.b,{id:pair.candidate})) : "—",
      pair.excluded || "Matched"]);
    const overview = facts([
      ["Baseline passed / graded",compare.a.metrics.successes + " / " + compare.a.metrics.valid],
      ["Comparison passed / graded",compare.b.metrics.successes + " / " + compare.b.metrics.valid],
      ["Matched trials",compare.matched]
    ]);
    holder.className = "stack";
    holder.replaceChildren(panel("Outcome summary",overview,element("p",compare.note,"section-copy")),
      panel("Changed settings",config),panel("Trial pairs",table(["Seed","Baseline","Comparison","Pair status"],rows)));
  } catch (error) { holder.replaceChildren(box(error.message)); }
}
async function loadRuns() {
  const [index,results] = await Promise.all([api("/api/experiments"),api("/api/results")]);
  state.runs = index.experiments;
  state.results = results.trials;
  renderRunLog();
  renderWorkspace();
  if (state.page === "compare") compareOptions();
}
async function loadRun(id) {
  const path = runPath(id);
  const [run,list] = await Promise.all([api(path),api(path+"/trials")]);
  return {run,trials:list.trials};
}
function rawResult(trial) {
  const details = element("details");
  details.className = "raw-result";
  details.append(element("summary","Original result and attempt history"),
    element("pre",JSON.stringify(trial.attempt_history,null,2)));
  return details;
}
function stepList(plan, states = {}) {
  const list = element("ol",null,"step-list");
  for (const step of plan?.steps || []) {
    const item = element("li");
    const copy = element("div");
    copy.append(element("h3",step.instruction.replace(/\.$/,"")),element("p",step.criterion));
    item.append(copy,status(states[step.id] || "not_started"));
    list.append(item);
  }
  return list;
}
function trialDetails(run, trial, video) {
  const steps = trialSteps(run,trial);
  const states = Object.fromEntries(steps.map(step => [step.id,stepResult(step)]));
  const result = facts([["Seed",trial.seed],["Result",label(trial.status)],
    ["Recorded outcome",trial.error || label(trial.outcome)],["Simulated duration",seconds(trial.sim_s)],
    ["Wall time",seconds(trial.wall_s)],["Model calls",trial.calls]]);
  const measurements = steps.filter(step => step.evidence).map(step => {
    const times = stepTimes(trial,step);
    return [stepNames[step.id] || label(step.id),seconds(times.contact),seconds(times.lift),seconds(times.settle),
      step.evidence.max_lift_cm == null ? "—" : step.evidence.max_lift_cm + " cm",label(step.evidence.ended_at)];
  });
  const events = element("ol",null,"event-list");
  for (const entry of trial.events || []) {
    const item = element("li");
    const time = element("button",seconds(entry.sim_s));
    time.type = "button";
    time.title = "Jump the recording to this moment";
    time.onclick = () => video.seek?.(entry.sim_s);
    const step = stepNames[entry.step_id];
    item.append(time,element("span",label(entry.kind) + (step ? " · " + step : "") + (entry.reason ? " · " + label(entry.reason) : "")));
    events.append(item);
  }
  const left = element("div",null,"stack");
  left.append(panel("Measurements",measurements.length ?
    table(["Placement","Contact","Lift","Settle","Max lift","Ended at"],measurements) : box("No measurements recorded.")));
  if (events.children.length) left.append(panel("Simulation events",events));
  const right = panel("Trial",result,stepList(run.plan,states),rawResult(trial));
  const columns = element("div",null,"split");
  columns.append(left,right);
  return columns;
}
function renderRun(run, trials, chosen) {
  byId("run-title").textContent = run.name;
  byId("run-subtitle").textContent = controllerName(run) + " · " + runDate(run.created_at) + " · " + run.id;
  const actions = byId("run-actions");
  actions.replaceChildren(status(run.status));
  const graded = (run.metrics?.valid || 0) > 0;
  if (trials.length) actions.append(link("Download results",runPath(run.id)+"/export","button"));
  if (["queued","running","interrupted","completed_with_errors","blocked"].includes(run.status)) {
    const verb = active.has(run.status) ? "cancel" : "resume";
    const control = element("button",verb === "cancel" ? "Stop run" : "Resume run");
    control.onclick = async () => {
      control.disabled = true;
      try { await api(runPath(run.id)+"/"+verb,{}); await route(); }
      catch (error) { notice(error.message); control.disabled = false; }
    };
    actions.append(control);
  }
  actions.append(cloneButton(run));
  const holder = byId("run-content");
  holder.className = "stack";
  const selected = trials.find(row => row.id === chosen) || trials.find(row => row.recording_url) || trials[0];
  const slots = (run.slots || []).map(slot => {
    const trial = trials.find(row => row.id === slot.id);
    const seed = trial ? link(String(slot.seed),trialLink(run,trial),"text-link") : String(slot.seed);
    return [seed,status(trial?.status || slot.status),trial ? label(trial.outcome) : "—",seconds(trial?.sim_s)];
  });
  const children = [];
  if (selected) {
    const video = player(run,selected);
    children.push(video,trialDetails(run,selected,video));
  } else {
    const summary = panel("Procedure progress",stepList(run.plan));
    if (active.has(run.status)) {
      summary.append(facts([["Current seed",run.current_seed],["Simulated time",seconds(run.live?.sim_s)],
        ["Model replies",run.live?.completed ?? 0]]));
    } else if (graded) {
      summary.append(element("p",run.metrics.successes + " of " + run.metrics.valid + " graded trials passed.","section-copy"));
    } else if (run.message) summary.append(element("p",run.message,"section-copy"));
    children.push(summary);
  }
  children.push(panel("Trials in this run",slots.length ? table(["Seed","Status","Outcome","Simulated time"],slots) :
    box("Waiting for simulation results.")));
  holder.replaceChildren(...children);
}
function defaults(config) {
  const fields = form.elements;
  fields.task.value = config.task_id;
  applyPreset();
  for (const [key,value] of Object.entries(config)) {
    const input = fields[key];
    if (!input) continue;
    if (input.type === "checkbox") input.checked = value;
    else input.value = value;
  }
  fields.model.value = config.model;
}
function applyPreset() {
  const fields = form.elements;
  const task = state.tasks?.find(item => item.id === fields.task.value);
  if (!task) return;
  fields.instruction.value = task.instruction;
  fields.scene.replaceChildren(new Option(sceneNames[task.scene] || task.scene,task.scene));
  fields.record_episode.disabled = task.id !== "orange-banana";
  if (fields.record_episode.disabled) fields.record_episode.checked = false;
  clearReview();
}
function cloneButton(run) {
  const button = element("button","Use run settings");
  button.onclick = () => {
    state.parent = run;
    defaults(run);
    form.elements.trials.readOnly = true;
    form.elements.seed0.readOnly = true;
    location.hash = "setup";
  };
  return button;
}
function configuration() {
  const data = new FormData(form);
  const fields = form.elements;
  const config = {task_id:data.get("task"),scene:data.get("scene"),model:data.get("model"),
    instruction:data.get("instruction").trim(),purpose:data.get("purpose"),record:fields.record.checked,
    record_episode:fields.record_episode.checked};
  for (const name of ["trials","actions","sim_seconds","seed0","jitter_cm","request_cap","max_credits","max_usd"]) {
    config[name] = Number(data.get(name));
  }
  if (state.parent) config.seeds = state.parent.seeds;
  return config;
}
function clearReview() {
  state.review = null;
  byId("launch").disabled = true;
  byId("setup-status").replaceChildren();
  byId("plan-preview").replaceChildren(box("Review the procedure to see its steps, limits and seed list."));
  byId("readiness").replaceChildren(box("Checks dependencies, robot state and the three camera inputs for this procedure."));
}
function showReview(report) {
  const credits = report.estimate.max_credits;
  byId("plan-preview").replaceChildren(stepList(report.plan),facts([
    ["Seeds",report.config.seeds.join(", ")],["Step time limit",report.plan.steps.map(step => seconds(step.max_rows/20)).join(" / ")],
    ["Maximum model requests",report.estimate.max_requests],
    ["Testing credits",report.config.model === "oracle" ? "0" : credits ?? "Quote required"]
  ]));
}
function renderChecks(holder, report) {
  const list = element("ul",null,"readiness-list");
  for (const check of report.checks) {
    const item = element("li");
    item.append(element("strong",check.name + " · " + (check.status === "ok" ? "Pass" : label(check.status))),
      element("p",check.detail));
    list.append(item);
  }
  holder.replaceChildren(status(report.ready ? "ready" : "blocked"),list);
}
async function setupAction(action) {
  if (!form.reportValidity() || state.pending) return;
  const body = configuration();
  const snapshot = JSON.stringify(body);
  const holder = byId("setup-status");
  state.pending = true;
  byId("launch").disabled = true;
  holder.textContent = action === "start" ? "Starting simulation…" : "Checking procedure…";
  try {
    if (action === "start") {
      if (!state.review || state.review.snapshot !== snapshot) throw new Error("Review the current procedure before starting.");
      const run = await api("/api/experiments",{config:body,plan_hash:state.review.plan.hash,
        idempotency_key:state.review.key,parent_id:state.parent?.id ?? null});
      clearReview();
      state.parent = null;
      form.elements.trials.readOnly = false;
      form.elements.seed0.readOnly = false;
      location.hash = runLink(run);
      await loadRuns();
    } else {
      const review = await api(action === "check" ? "/api/preflight" : "/api/plans/preview",body);
      if (JSON.stringify(configuration()) !== snapshot) return;
      const key = state.review?.plan.hash === review.plan.hash ? state.review.key : crypto.randomUUID();
      state.review = {...review,key,snapshot};
      showReview(review);
      if (action === "check") renderChecks(byId("readiness"),review);
      holder.textContent = review.ready === false ? "Simulation is blocked. Review the readiness checks." : "";
    }
  } catch (error) { holder.textContent = error.message; }
  finally {
    state.pending = false;
    byId("launch").disabled = !state.review || state.review.ready === false;
  }
}
async function loadDatasets() {
  const holder = byId("dataset-content");
  const data = await api("/api/datasets");
  const controls = element("div",null,"training-controls");
  const feedback = element("p",null,"section-copy");
  feedback.setAttribute("role","status");
  function field(name, kind, placeholder) {
    const wrapper = element("label");
    const input = element("input");
    input.type = kind;
    input.placeholder = placeholder || "";
    wrapper.append(document.createTextNode(name),input);
    return [wrapper,input];
  }
  function action(text, name, body) {
    const button = element("button",text);
    button.onclick = async () => {
      button.disabled = true;
      feedback.textContent = "Working…";
      try {
        const result = await api("/api/datasets/" + name,body());
        await loadDatasets();
        byId("dataset-content").querySelector("[role=status]").textContent =
          result.job_id ? "Dream Labs job " + result.job_id : "Dataset " + result.id + " updated.";
      } catch (error) { feedback.textContent = error.message; }
      finally { button.disabled = false; }
    };
    return button;
  }
  const episodeInputs = [];
  const rows = data.episodes.map(episode => {
    const input = element("input");
    input.type = "checkbox";
    input.disabled = !episode.eligible;
    input.value = episode.id;
    input.setAttribute("aria-label","Select episode with seed " + episode.seed);
    episodeInputs.push(input);
    return [input,episode.seed,label(episode.source),episode.frames,episode.eligible ? "Eligible" : episode.reasons.join(" ")];
  });
  if (rows.length) {
    const [heldLabel,held] = field("Evaluation seeds to keep out of training","text","e.g. 42, 43");
    controls.append(table(["Include","Seed","Controller","Samples","Eligibility"],rows),heldLabel,
      action("Prepare and validate locally","prepare",() => ({
        episode_ids:episodeInputs.filter(input => input.checked).map(input => input.value),
        held_out_seeds:held.value.split(",").map(value => value.trim()).filter(Boolean).map(Number)
      })));
  } else controls.append(box("No episodes yet. Turn on 'Save synchronized training samples' when configuring a two-step run."));
  const cards = data.prepared.map(record => {
    const detail = facts([["Dataset",record.id],["Local validation","Passed"],["Episodes",record.episodes],
      ["Dream Labs dataset",record.remote_status ? label(record.remote_status) : "Awaiting upload"],
      ["Training job",record.job_id || label(record.job_status)],["Checkpoint",record.checkpoint]]);
    const buttons = element("div",null,"training-controls");
    if (!record.remote_id) {
      const [embodimentLabel,embodiment] = field("Dream Labs YAM embodiment","text","account/name");
      buttons.append(embodimentLabel,action("Upload to Dream Labs","upload",() => ({
        dataset_id:record.id,embodiment:embodiment.value.trim()
      })));
    }
    if (record.remote_id) buttons.append(action("Refresh Dream Labs status","refresh",() => ({dataset_id:record.id})));
    if (record.remote_status === "processed" && !record.job_started) {
      const [stepLabel,steps] = field("Training steps","number","500");
      steps.min = "500";
      steps.max = "10000";
      steps.step = "100";
      steps.value = "500";
      const price = element("label",null,"check");
      const confirm = element("input");
      confirm.type = "checkbox";
      price.append(confirm,document.createTextNode("I verified the price in Dream Labs and authorize the charge for these steps."));
      const train = action("Start fine-tuning","train",() => ({
        dataset_id:record.id,steps:Number(steps.value),confirm_charge:confirm.checked
      }));
      train.disabled = true;
      confirm.onchange = () => { train.disabled = !confirm.checked; };
      steps.oninput = () => { confirm.checked = false; train.disabled = true; };
      buttons.append(stepLabel,price,train);
    }
    return panel("Validated dataset",detail,buttons);
  });
  const account = data.credentials_present ? "Dream Labs credentials are configured in this server." :
    "Start the server with --prompt-key to upload or train. Local validation works without credentials.";
  holder.replaceChildren(panel("Choose successful episodes",controls),panel("Dream Labs",element("p",account,"section-copy"),feedback),...cards);
  holder.className = "stack";
}
/* Difficulty ladder: versions of the robot on identical seeds. */
const armNames = {
  teacher: "Scripted teacher", stock: "A · Stock (48 rows)", tuned: "B · Harness-tuned (24 rows)",
  "ft-naive": "C1 · Fine-tuned, naive data", "ft-harness": "C2 · Fine-tuned, harness-chosen data"
};
function armName(arm) { return armNames[arm] || arm; }
function percent(value) { return value == null ? "—" : Math.round(100 * value) + "%"; }
function rateBar(arm) {
  const wrap = element("div",null,"rate-cell");
  const bar = element("div",null,"rate-bar");
  const fill = element("div",null,"rate-fill");
  fill.style.width = percent(arm.rate);
  bar.append(fill);
  if (arm.ci) {
    const band = element("div",null,"rate-ci");
    band.style.left = percent(arm.ci[0]);
    band.style.width = Math.max(0,Math.round(100 * (arm.ci[1] - arm.ci[0]))) + "%";
    bar.append(band);
  }
  wrap.append(element("strong",arm.passed + "/" + arm.graded),bar,
    element("small",percent(arm.rate) + (arm.ci ? " (" + percent(arm.ci[0]) + "–" + percent(arm.ci[1]) + ")" : "")));
  return wrap;
}
function ladderLevel(name, level, trials) {
  const section = element("section",null,"ladder-level");
  const head = element("div",null,"section-head");
  head.append(element("h2",level.level + " · " + level.name),element("span",level.sim_seconds + " s limit · “" + level.task + "”","na"));
  section.append(head);
  const scoreRows = level.arms.map(arm => [
    armName(arm.arm),
    arm.clean ? "yes" : element("span","no · " + arm.steering.join("; "),"no"),
    rateBar(arm), percent(arm.mean_progress),
    arm.median_calls == null ? "—" : String(Math.round(arm.median_calls)),
    seconds(arm.median_success_s), arm.cost_per_success == null ? "—" : "$" + arm.cost_per_success.toFixed(2),
    Object.entries(arm.outcomes).map(([k,v]) => label(k) + " " + v).join(" · "),
    ["contact","lift","settle"].map(stage => stage[0].toUpperCase() + " " + seconds(arm.stages[stage].median_s) +
      " (" + arm.stages[stage].reached + "/" + arm.stages[stage].of + ")").join("  ")
  ]);
  section.append(table(["Version","Clean","Passed","Progress","Calls","Time to success","$ / success","Where trials ended","Stage timing"],scoreRows));
  if (level.pairs.length) {
    const pairRows = level.pairs.map(p => [armName(p.baseline) + " → " + armName(p.candidate),p.pairs,p.both,
      p.only_candidate,p.only_baseline,p.neither,p.change_pts == null ? "—" : (p.change_pts > 0 ? "+" : "") + Math.round(p.change_pts) + " pts",
      p.p.toFixed(3)]);
    const pairs = element("div",null,"ladder-pairs");
    pairs.append(element("h3","Matched on identical seeds"),
      table(["Comparison","Pairs","Both pass","Only candidate","Only baseline","Both fail","Change","p (McNemar)"],pairRows));
    section.append(pairs);
  }
  const arms = level.arms.map(arm => arm.arm);
  const grid = element("div",null,"seed-grid");
  grid.style.gridTemplateColumns = "6ch repeat(" + arms.length + ", minmax(0, 1fr))";
  grid.append(element("span","Seed","grid-head"),...arms.map(arm => element("span",armName(arm),"grid-head")));
  const viewer = element("div",null,"side-by-side");
  for (const [seed,cells] of Object.entries(level.seeds)) {
    const seedButton = element("button",seed,"grid-seed");
    seedButton.type = "button";
    seedButton.onclick = () => showSideBySide(viewer,name,level,seed,cells,arms);
    grid.append(seedButton);
    for (const arm of arms) {
      const cell = cells[arm];
      const mark = element("button",null,"grid-cell " + (!cell ? "empty-cell" : cell.success ? "pass" : "fail"));
      mark.type = "button";
      mark.textContent = !cell ? "" : cell.success ? "✓" + (cell.progress_of > 1 ? " " + cell.progress + "/" + cell.progress_of : "") :
        label(cell.outcome) + (cell.progress_of > 1 ? " · " + cell.progress + "/" + cell.progress_of : "");
      if (cell?.video) mark.classList.add("has-video");
      mark.onclick = seedButton.onclick;
      grid.append(mark);
    }
  }
  const gridWrap = element("div",null,"ladder-grid");
  gridWrap.append(element("h3","Every seed, every version (click a row for side-by-side video)"),grid);
  section.append(gridWrap,viewer);
  return section;
}
function showSideBySide(holder, name, level, seed, cells, arms) {
  const panes = element("div",null,"sbs-panes");
  const videos = [];
  for (const arm of arms) {
    const cell = cells[arm];
    const pane = element("figure",null,"sbs-pane");
    const caption = element("figcaption");
    caption.append(element("strong",armName(arm)),
      element("span",!cell ? "not run" : cell.success ? "passed" : label(cell.outcome),cell?.success ? "ok" : "no"));
    if (cell?.video) {
      const video = element("video");
      Object.assign(video,{muted:true,playsInline:true,preload:"auto",src:"/ladder-media/" + encodeURIComponent(name) + "/" + encodeURIComponent(cell.trial)});
      videos.push(video);
      pane.append(video,caption);
    } else pane.append(element("div","No video recorded for this trial","no-media"),caption);
    panes.append(pane);
  }
  const controls = element("div",null,"controls");
  const toggle = element("button","Play all");
  const clock = element("span","0.00 s","clock");
  const track = element("input");
  Object.assign(track,{type:"range",min:0,max:level.sim_seconds,step:0.05,value:0});
  track.className = "sbs-track";
  toggle.onclick = () => {
    const playing = videos.some(v => !v.paused);
    for (const v of videos) playing ? v.pause() : v.play().catch(() => {});
    toggle.textContent = playing ? "Play all" : "Pause all";
  };
  track.oninput = () => { for (const v of videos) v.currentTime = Math.min(Number(track.value),v.duration || 0); };
  const tick = () => {
    if (!holder.isConnected || !videos.length) return;
    const t = Math.max(...videos.map(v => v.currentTime || 0));
    clock.textContent = t.toFixed(2) + " s";
    if (document.activeElement !== track) track.value = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  controls.append(toggle,clock,track,element("span",videos.length + " video" + (videos.length === 1 ? "" : "s"),"rate"));
  holder.replaceChildren(element("h3","Seed " + seed + " · same start for every version"),panes,controls);
  window.motion?.revealPanes(holder);
  holder.scrollIntoView({behavior:"smooth",block:"start"});
}
const finetuneArms = {"c1-naive": "ft-naive", "c2-harness": "ft-harness"};
function finetunePanel(jobs) {
  if (!jobs.length) return null;
  const rows = jobs.map(job => {
    const steps = job.step == null ? (job.phase ? label(job.phase) : "—") : job.step + " / " + job.total_steps;
    const mix = Object.entries(job.mix).map(([key,count]) => count + " " + key.replace("scripted_teacher","teacher").replace("model_generated","Dream-1 own")).join(" · ");
    return [armName(finetuneArms[job.suffix] || job.suffix), status(job.status || "pending"), steps,
      job.loss == null ? "—" : job.loss.toFixed(4), job.price_cents == null ? "—" : "$" + (job.price_cents / 100).toFixed(0),
      job.checkpoint || "training…", (job.episodes ?? "—") + " episodes: " + mix, runDate(job.updated_at || job.submitted_at)];
  });
  const notes = jobs.filter(job => job.recipe).map(job => element("p",armName(finetuneArms[job.suffix] || job.suffix) + ": " + job.recipe,"section-copy"));
  return panel("Fine-tuning",
    table(["Version","Status","Step","Loss","Price","Checkpoint","Training data","Updated"],rows), ...notes);
}
async function loadLadder() {
  const select = byId("ladder-collection");
  const list = await api("/api/ladder");
  const finetunes = finetunePanel(list.finetunes || []);
  byId("ladder-finetunes").replaceChildren(...(finetunes ? [finetunes] : []));
  const current = select.value;
  select.replaceChildren();
  for (const name of list.collections) addOption(select,name,name);
  if (!list.collections.length) {
    byId("ladder-content").replaceChildren(box("No ladder experiments yet. Run python -m mission_control.ladder run …"));
    return;
  }
  select.value = list.collections.includes(current) ? current : (list.collections.includes("eval") ? "eval" : list.collections.at(-1));
  const data = await api("/api/ladder/" + encodeURIComponent(select.value));
  const s = data.summary;
  const totals = element("p",s.trials + " trials · " + s.calls + " model calls · about $" + s.cost_usd.toFixed(2) +
    " · start variation ±" + s.jitter_cm + " cm","section-copy");
  byId("ladder-content").replaceChildren(totals,...s.levels.map(level => ladderLevel(data.name,level,data.trials)));
  window.motion?.revealLadder(byId("ladder-content"));
}
byId("ladder-collection").onchange = () => loadLadder().catch(error => notice(error.message));

async function route() {
  const token = ++state.request;
  const [hash,id,trial] = location.hash.slice(1).split("/").map(decodeURIComponent);
  const page = ["workspace","flow","setup","runs","run","ladder","compare","datasets"].includes(hash) ? hash : "workspace";
  const viewKey = page + "/" + (id || "");
  const changed = state.viewKey !== viewKey;
  state.viewKey = viewKey;
  state.page = page;
  for (const section of document.querySelectorAll("[data-view]")) section.hidden = section.dataset.view !== page;
  for (const nav of document.querySelectorAll("[data-tab]")) {
    const activePage = page === "run" ? "runs" : page === "setup" ? "" : page;
    if (nav.dataset.tab === activePage) nav.setAttribute("aria-current","page");
    else nav.removeAttribute("aria-current");
  }
  window.motion?.moveIndicator(!changed);
  for (const video of document.querySelectorAll("[data-view][hidden] video")) video.pause();
  notice("");
  try {
    if (page === "run" && id) {
      const data = await loadRun(id);
      if (token !== state.request) return;
      state.detail = data;
      renderRun(data.run,data.trials,trial);
    }
    if (page === "workspace") renderWorkspace();
    if (page === "runs") renderRunLog();
    if (page === "compare") compareOptions();
    if (page === "datasets") await loadDatasets();
    if (page === "ladder") await loadLadder();
    if (page === "flow") window.flow?.render();
    if (token === state.request) window.motion?.enterView(page, changed);
    for (const video of document.querySelectorAll("[data-view]:not([hidden]) video")) video.play().catch(() => {});
  } catch (error) { notice(error.message); }
}
byId("review").onclick = () => setupAction("review");
byId("check").onclick = () => setupAction("check");
byId("new-run").onclick = () => {
  if (!state.parent) return;
  state.parent = null;
  form.elements.trials.readOnly = false;
  form.elements.seed0.readOnly = false;
  defaults(state.defaults);
};
byId("task").onchange = () => {
  state.parent = null;
  form.elements.trials.readOnly = false;
  form.elements.seed0.readOnly = false;
  applyPreset();
};
form.oninput = clearReview;
form.onsubmit = event => { event.preventDefault(); setupAction("start"); };
byId("comparison-form").onsubmit = compareRuns;
window.onhashchange = () => {
  route();
  window.scrollTo(0,0);
};
async function initialize() {
  try {
    const catalog = await api("/api/catalog");
    state.tasks = catalog.tasks;
    state.defaults = {...catalog.defaults,model:"oracle"};
    for (const task of catalog.tasks.filter(task => task.scene === "stock")) addOption(form.elements.task,task.id,task.label);
    for (const model of catalog.models) addOption(form.elements.model,model,model === "oracle" ? "Scripted simulator" : "Dream-1");
    defaults(state.defaults);
    renderLegend();
    await loadRuns();
    await route();
  } catch (error) { notice(error.message); }
}
initialize();
setInterval(async () => {
  if (document.hidden || state.polling) return;
  const working = state.detail?.run?.status;
  if (!active.has(working) && !state.runs.some(run => active.has(run.status))) return;
  state.polling = true;
  try {
    await loadRuns();
    if (state.page === "run") await route();
  } catch (error) { notice(error.message); }
  finally { state.polling = false; }
},1800);
