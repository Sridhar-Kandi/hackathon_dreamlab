"use strict";

const byId = id => document.getElementById(id);
const form = byId("setup-form");
const active = new Set(["queued", "running", "stopping"]);
const state = { runs: [], request: 0, review: null, latest: null, detail: null };
const labels = {
  success: "Passed", succeeded: "Verified", failure: "Failed", task_failed: "Failed",
  queued: "Queued", running: "Running", stopping: "Stopping", completed: "Finished",
  completed_with_errors: "Finished with errors", cancelled: "Cancelled", interrupted: "Interrupted",
  pending: "Pending", error: "Error", incomplete: "Incomplete", blocked: "Blocked",
  not_started: "Not started", not_reached: "Not reached", ready: "Ready",
  task_timeout: "Step time limit reached", final_placement_lost: "Final placement check failed",
  never_touched: "No target contact", touched_no_lift: "Contact without a verified lift",
  wrong_destination: "Wrong destination", fell_off_table: "Object fell off the table",
  lifted_missed_goal: "Object lifted but missed its destination", at_goal_not_settled: "Object did not settle",
  contact: "Gripper contacted target", lift: "Lift verified", step_started: "Step started",
  step_succeeded: "Placement verified", step_failed: "Step failed", step_interrupted: "Step interrupted",
  request_started: "Model request started", request_completed: "Model reply validated", attempt_error: "Attempt error"
};
const stepNames = { "orange-bowl": "Orange in bowl", "banana-plate": "Banana on plate" };
const sceneNames = { stock: "Stock tabletop", racks: "Tube racks", hold_fill: "Cup and tube", blocks2: "Two-block scene" };

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
  if (["success","succeeded","ready"].includes(key)) tone = " good";
  if (["running","queued","stopping"].includes(key)) tone = " active";
  if (["blocked","interrupted","cancelled","completed_with_errors"].includes(key)) tone = " warn";
  if (["failure","task_failed","error"].includes(key)) tone = " bad";
  return element("span",label(key),"status" + tone);
}
function panel(title, ...children) {
  const node = element("section",null,"panel");
  const heading = element("div",null,"panel-heading");
  heading.append(element("h2",title));
  node.append(heading,...children);
  return node;
}
function box(text) { return element("p",text,"empty"); }
function seconds(value) { return Number.isFinite(value) ? value.toFixed(1) + " s" : "—"; }
function runDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
}
function table(headers, rows) {
  const wrapper = element("div",null,"table-wrap");
  const node = element("table");
  const head = node.createTHead().insertRow();
  for (const title of headers) {
    const cell = element("th",title);
    cell.scope = "col";
    head.append(cell);
  }
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
function stepStates(run, trial, plan) {
  const result = {};
  const lookingAtLiveTrial = !trial && active.has(run?.status);
  for (const step of plan?.steps || []) {
    if (lookingAtLiveTrial) {
      const events = (run.events || []).filter(event => event.step_id === step.id);
      if (events.some(event => event.kind === "step_succeeded")) result[step.id] = "succeeded";
      else if (events.some(event => event.kind === "step_failed")) result[step.id] = "task_failed";
      else if (events.some(event => event.kind === "step_interrupted")) result[step.id] = "interrupted";
      else if (events.some(event => event.kind === "step_started")) result[step.id] = "running";
      else result[step.id] = "pending";
      continue;
    }
    if (!trial) continue;
    const verified = trial.ordered_steps?.find(entry => entry.id === step.id);
    if (verified) result[step.id] = verified.status === "pending" ? "not_reached" : verified.status;
    else if (plan.steps.length === 1) result[step.id] = trial.status;
  }
  return result;
}
function renderConnection(health) {
  const holder = byId("connection");
  const missing = health.missing_dependencies || [];
  holder.replaceChildren(status(missing.length ? "blocked" : "ready"),
    element("p",missing.length ? "The local Python environment is missing " + missing.join(", ") + "." :
      "The simulator packages are installed. Run the camera and state check before starting."));
}
function renderWorkspace() {
  const main = state.runs.find(run => run.task_id === "orange-banana" && run.sim_seconds > 1) ||
    state.runs.find(run => run.task_id === "orange-banana");
  const run = state.latest?.run?.id === main?.id ? state.latest?.run : main;
  const trials = state.latest?.run?.id === run?.id ? state.latest?.trials : [];
  const trial = active.has(run?.status) ? null : trials?.at(-1);
  const plan = run?.plan || state.defaultPlan;
  const states = stepStates(run,trial,plan);
  byId("procedure-steps").replaceChildren(stepList(plan,states));
  const overall = trial?.status || run?.status || "not_started";
  const old = byId("procedure-status");
  const badge = status(overall);
  badge.id = old.id;
  old.replaceWith(badge);
  const verified = Object.values(states).filter(value => value === "succeeded").length;
  const footer = byId("procedure-footer");
  footer.replaceChildren(element("strong",plan ? verified + " of " + plan.steps.length + " placements verified" : "Checking procedure…"));
  if (trial) {
    footer.append(element("span","Seed " + trial.seed));
    footer.append(element("span",seconds(trial.sim_s) + " simulated"));
    if (trial.status === "FAILURE") footer.append(element("span",label(trial.outcome)));
    footer.append(link("Inspect trial",trialLink(run,trial),"text-link"));
  }
  const rows = [];
  for (const run of state.runs) {
    for (const trial of (state.results || []).filter(entry => entry.experiment_id === run.id)) {
      const steps = trial.ordered_steps || [{id:run.task_id,status:trial.status,evidence:trial}];
      for (const step of steps) {
        const observed = step.evidence;
        const failed = trial.events.find(event => event.step_id === step.id && event.kind === "step_failed");
        const issue = failed?.reason === "final_placement_lost" ? "Final placement check failed" :
          !observed ? "Step never started" : observed.success ? "—" :
          observed.first_contact_row == null ? "Before target contact" :
          observed.lifted_row == null ? "Before verified lift" : "Before settled placement";
        const end = step.status === "pending" ? "not_reached" : step.status;
        const stage = value => !observed ? "—" : value != null ? "Verified" : "Unverified";
        const procedure = run.task_id !== "orange-banana" ? "Single placement" : run.sim_seconds === 1 ?
          "Two steps · short limit" : "Two steps";
        rows.push([procedure,stepNames[step.id] || run.name,link(String(trial.seed),trialLink(run,trial),"text-link"),
          stage(observed?.first_contact_row),stage(observed?.lifted_row),
          stage(observed?.goal_row),status(end), trial.error || issue]);
      }
    }
  }
  byId("fresh-results").replaceChildren(rows.length ?
    table(["Procedure","Placement","Seed","Contact","Lift","Settle","Step result","Where it stopped"],rows) :
    box("No results yet. Start a local run to collect measured outcomes."));
}
function renderRunLog() {
  const rows = state.runs.map(run => {
    const metrics = run.metrics;
    return [link(run.name,runLink(run),"text-link"),run.source,runDate(run.created_at),
      status(run.status),metrics.successes + " / " + metrics.valid];
  });
  byId("run-list").replaceChildren(rows.length ? table(["Procedure","Controller","Started","Run status","Passed / graded"],rows) :
    box("No runs recorded. The log updates when a new simulation starts."));
}
function compareOptions() {
  const baseline = byId("baseline");
  const changed = byId("changed");
  const ready = state.runs.filter(run => run.trial_ids.length);
  byId("comparison-form").hidden = ready.length < 2;
  if (ready.length < 2) {
    byId("comparison").replaceChildren(box("Record at least two runs to compare their trial outcomes."));
    return;
  }
  for (const [select,fallback] of [[baseline,ready[1].id],[changed,ready[0].id]]) {
    const value = select.value;
    select.replaceChildren();
    for (const run of ready) addOption(select,run.id,run.name + " · " + run.source + " · " + run.id.slice(-5));
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
      panel("Run settings",config),panel("Trial pairs",table(["Seed","Baseline","Comparison","Pair status"],rows)));
  } catch (error) { holder.replaceChildren(box(error.message)); }
}
async function loadRuns() {
  const [index,results] = await Promise.all([api("/api/experiments"),api("/api/results")]);
  state.runs = index.experiments;
  state.results = results.trials;
  renderRunLog();
  const main = state.runs.find(run => run.task_id === "orange-banana" && run.sim_seconds > 1) ||
    state.runs.find(run => run.task_id === "orange-banana");
  if (main) state.latest = await loadRun(main.id);
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
function trialDetails(run, trial) {
  const result = facts([["Trial seed",trial.seed],["Result",label(trial.status)],
    ["Recorded outcome",trial.error || label(trial.outcome)],["Simulated duration",seconds(trial.sim_s)],
    ["Elapsed wall time",seconds(trial.wall_s)],["Model calls",trial.calls]]);
  const media = trial.recording_url ? element("img",null,"playback") : box("No camera recording was saved for this trial.");
  if (trial.recording_url) {
    media.src = trial.recording_url;
    media.alt = "Recorded multi-camera playback for trial seed " + trial.seed;
  }
  const children = [panel("Trial result",result,stepList(run.plan,stepStates(run,trial,run.plan)),rawResult(trial))];
  const measurements = (trial.ordered_steps || []).filter(step => step.evidence).map(step => [
    stepNames[step.id] || label(step.id),seconds(step.evidence.goal_row == null ? null : (step.evidence.goal_row + 1)/20),
    step.evidence.max_lift_cm == null ? "—" : step.evidence.max_lift_cm + " cm",label(step.evidence.ended_at)
  ]);
  if (measurements.length) children.push(panel("Placement measurements",
    table(["Step","Time to settle","Maximum lift","Final location"],measurements)));
  const events = element("ol",null,"event-list");
  for (const entry of trial.events || []) {
    const step = stepNames[entry.step_id];
    events.append(element("li",seconds(entry.sim_s) + " · " + label(entry.kind) +
      (step ? " · " + step : "") + (entry.reason ? " · " + label(entry.reason) : "")));
  }
  if (events.children.length) children.push(panel("Simulation events",events));
  const columns = element("div",null,"workspace-grid");
  const stack = element("div",null,"stack");
  stack.append(...children);
  columns.append(stack,panel("Camera playback",media));
  return columns;
}
function renderRun(run, trials, chosen) {
  byId("run-title").textContent = run.name;
  byId("run-subtitle").textContent = run.source + " · " + runDate(run.created_at) + " · " + run.id;
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
  const selected = trials.find(row => row.id === chosen);
  const slots = (run.slots || []).map(slot => {
    const trial = trials.find(row => row.id === slot.id);
    return [slot.seed,status(trial?.status || slot.status),trial ? label(trial.outcome) : "—",
      seconds(trial?.sim_s),trial ? link("Inspect",trialLink(run,trial),"text-link") : "—"];
  });
  const statusPanel = panel("Trial log",slots.length ? table(["Seed","Trial status","Outcome","Simulation time","Details"],slots) :
    box("Waiting for simulation results."));
  const children = [statusPanel];
  if (selected) children.push(trialDetails(run,selected));
  else {
    const summary = panel("Procedure progress",stepList(run.plan,stepStates(run,trials.at(-1),run.plan)));
    if (active.has(run.status)) {
      summary.replaceChildren(summary.firstElementChild,stepList(run.plan,stepStates(run,null,run.plan)),
        facts([["Current seed",run.current_seed],["Simulated time",seconds(run.live?.sim_s)],
          ["Model replies",run.live?.completed ?? 0]]));
    } else if (graded) {
      summary.append(element("p",run.metrics.successes + " of " + run.metrics.valid + " graded trials passed.","section-copy"));
    } else if (run.message) summary.append(element("p",run.message,"section-copy"));
    children.unshift(summary);
  }
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
  byId("readiness").replaceChildren(box("Check setup and camera inputs for the selected procedure."));
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
  } else controls.append(box("Enable Save synchronized training samples when configuring a two-step run."));
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
async function route() {
  const token = ++state.request;
  const [hash,id,trial] = location.hash.slice(1).split("/");
  const page = ["workspace","setup","runs","run","compare","datasets"].includes(hash) ? hash : "workspace";
  state.page = page;
  for (const section of document.querySelectorAll("[data-view]")) section.hidden = section.dataset.view !== page;
  for (const nav of document.querySelectorAll("[data-tab]")) {
    const activePage = page === "run" ? "runs" : page === "setup" ? "workspace" : page;
    if (nav.dataset.tab === activePage) nav.setAttribute("aria-current","page");
    else nav.removeAttribute("aria-current");
  }
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
  } catch (error) { notice(error.message); }
}
byId("review").onclick = () => setupAction("review");
byId("check").onclick = () => setupAction("check");
byId("workspace-check").onclick = async () => {
  const control = byId("workspace-check");
  const holder = byId("connection");
  control.disabled = true;
  holder.textContent = "Checking arms and camera frames…";
  try { renderChecks(holder,await api("/api/preflight",{model:"oracle"})); }
  catch (error) { holder.replaceChildren(box(error.message)); }
  finally { control.disabled = false; }
};
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
    const [catalog,health,review] = await Promise.all([
      api("/api/catalog"),api("/api/health"),api("/api/plans/preview",{model:"oracle"})
    ]);
    state.tasks = catalog.tasks;
    state.defaults = {...catalog.defaults,model:"oracle"};
    state.defaultPlan = review.plan;
    for (const task of catalog.tasks.filter(task => task.scene === "stock")) addOption(form.elements.task,task.id,task.label);
    for (const model of catalog.models) addOption(form.elements.model,model,model === "oracle" ? "Scripted simulator" : "Dream-1");
    defaults(state.defaults);
    renderConnection(health);
    await loadRuns();
    await route();
  } catch (error) { notice(error.message); }
  finally { byId("loading").hidden = true; }
}
initialize();
setInterval(async () => {
  if (document.hidden || state.polling) return;
  const working = state.detail?.run?.status || state.latest?.run?.status;
  if (!active.has(working) && !state.runs.some(run => active.has(run.status))) return;
  state.polling = true;
  try {
    await loadRuns();
    if (state.page === "run") await route();
  } catch (error) { notice(error.message); }
  finally { state.polling = false; }
},1800);
