## 1. Executive Decision

Build **Dream-1 Mission Control**, a local web application for robotics developers who need to answer three questions before adopting a Dream‑1 configuration: **How often does it work? Where does it fail? Which change is worth trying next?**

The primary workflow is **describe the task → review the ordered plan → run → inspect → compare → decide**. The app breaks a supported compound instruction into steps, runs them in one simulation, and advances when the grader confirms the current step. The user can inspect the step that failed and compare configurations on shared starting conditions.

Use **orange into bowl, then banana onto plate** as the first supported compound instruction. Reuse `dreameval`, the stock scene, the stepwise runner pattern, and the existing graders where they fit. Keep the historical single-instruction orange comparison for supporting evidence. Collect demonstrations in parallel and **target submitting one fine-tuning job by H2** once the dataset is accepted and the charge is confirmed. [Project handoff](https://github.com/Sridhar-Kandi/hackathon_dreamlab#readme)

## 2. Requirements and Scope

| Evidence | What it means for the roadmap |
|---|---|
| **Confirmed in the request** | Build a tool that helps people use Dream‑1. Task decomposition is required. Work within 14 hours and separate budgets of 120 simulation/testing credits and 1,000 fine-tuning credits. Collect qualified demonstrations and aim to submit a job by H2. The website uses Poppins, plain copy, a realistic robotics-tool layout, and genuine evidence. |
| **Public project handoff** | The team records the track as building a tool for Dream‑1 users and testing it in simulation. It summarizes organizer pain points around reliability, failure diagnosis, interruptions, camera inputs, and collecting demonstrations without a robot. Use these to rank work. The handoff also records a 16:30 submission deadline and a three-minute demo with two minutes of Q&A. Confirm those logistics at H0. [Project handoff](https://github.com/Sridhar-Kandi/hackathon_dreamlab#readme) |
| **Missing supervisor evidence** | The team has confirmed task decomposition. The complete supervisor message remains unavailable, so other directives and submission requirements should be confirmed at kickoff. |
| **Verified public platform capability** | Dream Labs documents a Python inference client for a developer-owned control loop, a YAM MuJoCo example, and a dataset-to-checkpoint fine-tuning workflow. The platform documentation link led to sign-in, so the public SDK documentation is the basis for the proposed integration. Event-account pricing, entitlements, and training turnaround remain open. [Official library](https://github.com/dreamlabs-co/dreamlabs) · [Official library package](https://pypi.org/project/dreamlabs/) · [Official client documentation](https://pypi.org/project/dreamlabs-client/) |
| **Planning assumptions** | One demo laptop, one active simulation worker, a local browser, and a working checkout available to the future coding agent. The public README is evidence of what the team reports. The target checkout, environment, artifact contents, and reported measurements remain unverified. |

**P0 submission scope** is one supported compound task with verified sequential execution, a validated plan preview, durable file-backed runs, a monitor, evidence-linked replay, and a useful comparison. The first two hours also prioritize a minimal recording, dataset export, validation, and submission path. The main demo remains usable while the training job is pending. **P1** adds richer input diagnostics and dataset review. **P2** covers in-app provider job tracking and advanced showcases. Defer new scenes, custom robot assistance, live video streaming, and physical-robot control.

## 3. Existing Work vs. Missing Work

The following map comes from the public handoff. At H0, the coding agent should map it to the exact branch and classify each artifact as usable, needs a small adapter, or unavailable. [Project handoff and code map](https://github.com/Sridhar-Kandi/hackathon_dreamlab#code-map-dreameval)

| Reported asset | Decision | Work needed |
|---|---|---|
| `runner.py` and Dream YAM Sim integration | Reuse the headless single-trial path | Map validated form values into runner arguments. Add narrow hooks for status, stop checks, and runtime counters where the existing outputs are insufficient. |
| `sweep.py` and `runs/` | Reuse sweep conventions, seed handling, and historical artifacts | Give one component ownership of scheduling live attempts. Import existing config and result records. Keep the current CLI usable and its result files intact. |
| `detectors.py` and task trackers | Reuse authoritative physics grading | Map detector events to a small UI vocabulary. Retain raw detector labels and versions. Add evidence fields only where the runner exposes reliable measurements. |
| `paired.py` and `report.py` | Reuse verified pairing and aggregate calculations. Keep HTML reports as supporting evidence | Check denominator, pairing keys, and missing-result handling before surfacing outputs. Add a configuration diff and seed-level drill-down. |
| GIFs, event logs, and `showcase/` | Reuse genuine recordings and logs | The handoff says most GIFs are outside Git. Locate matching media on the target machine or select verified showcase clips. Package only the demo subset. Show missing media explicitly. |
| `scenes.py`, `bimanual.py`, `hanoi.py` | Register proven presets selectively | Ship the stock fruit scene first. Use advanced scenes as recorded showcases only if media, config, and grading agree. |
| `oracle.py` | Reuse as a local smoke path and a possible source of scripted demonstrations | Mark runs **Scripted simulator**, preserve provenance, and verify whether the recorder captures training-grade data. |
| `assist.py` and probes | Preserve as prior research | Keep simulator-ground-truth assistance out of the standard Dream‑1 evaluation path. Detector access to ground truth is for measurement. |

The H1 outcome is a supported two-step plan mapped to the runner, an initial complete demonstration recording, and a usable historical failure clip. Verify whether the existing recorder captures synchronized state and executed actions. A replay GIF alone is insufficient for training.

## 4. Final Product Specification

**Primary user:** a Dream‑1 developer deciding whether an instruction, model checkpoint, or execution setting is dependable enough for their task. Their first useful session ends with a concrete choice: keep the baseline, try the candidate again, investigate a specific failure, or pause spending until a blocker is resolved.

| Step | Required behavior |
|---|---|
| **1. Configure** | Default to the supported compound preset. Show the editable instruction, available model, scene, trial count, recording toggle, and estimated usage. Default to one trial. Keep action rows, seed, supported jitter, time limits, and request cap under **Advanced**. |
| **2. Review and start** | Parse supported instructions into ordered steps using preset-backed rules. Show each step’s instruction, grader-defined completion rule and time limit. Reject unrecognized or ambiguous steps, unsupported task/scene/model combinations, and out-of-range execution settings before launch. Freeze the reviewed plan and seed manifest, then show the latest usage estimate. If live admission is blocked, preserve the draft and offer **Open recorded runs**. Double submission returns the existing run. |
| **3. Execute and monitor** | Run a trial in one simulator reset. Send Dream‑1 the active step’s instruction and advance only after the physics grader verifies completion. On transition, discard unused actions from the previous step and request fresh actions with current observations. Preserve the scene state. Report the active step, completed steps, and stop reason. A failed or interrupted step stops that trial and leaves later steps pending. Pause the batch on account-wide or repeated infrastructure faults. |
| **4. Inspect** | Open success and failure through the same trial view. A success shows the goal and settling evidence. A task failure shows the last confirmed milestone, the observed stopping condition, and a linked recording if available. An infrastructure error shows a specific recovery action and any recoverable evidence. Unmeasured milestones display **Unknown**. |
| **5. Compare and decide** | **Try a change** clones the configuration, records its parent, and keeps the same seed manifest. Show the changed field before the run starts. Compare matching trial pairs, highlight observed direction and evidence strength, and expose tradeoffs in calls and elapsed time. A failed or missing pair remains visible with the reason it was excluded. |
| **6. Collect and adapt** | Follow the H2 recording, export and submission track in §9. Use CLI and the official platform during the first two hours. A published checkpoint returns to the ordinary experiment form as another model choice. |

For the first compound preset, step 1 requires the orange to settle in the bowl, and step 2 requires the banana to settle on the plate. Confirm both final placements and ordered completion for overall success. The preview displays the mapped goals before launch. Text outside the supported vocabulary receives a specific error and a supported example. Keep failure milestones such as reach and lift in the inspector, where they explain how a planned step progressed.

## 5. Recommended Task Strategy

Choose **Strategy A, existing tasks**. Compose two supported pick-and-place goals in the stock scene to demonstrate decomposition without building a new environment. Keep the historical orange and banana trials as supporting examples. If the stock checkout cannot verify both goals end to end, use one existing scene with two verified sequential goals and document the substitution. Existing repository scenes can have their own reset, detector and reliability requirements. [Project scenes and historical results](https://github.com/Sridhar-Kandi/hackathon_dreamlab#readme) · [Official YAM Sim example](https://pypi.org/project/dreamlabs/#examples)

| Rank | Scenario and support | Evidence and tradeoff | Decision |
|---|---|---|---|
| **1** | **Orange into bowl, then banana onto plate**, stock scene | Combines two reported stock tasks. Both goals give visible physics criteria. Successful end-to-end Dream‑1 execution remains to be verified. | **Primary.** Use the scripted simulator to prove sequencing and collect qualified data. Show genuine Dream‑1 evidence with its actual outcome. |
| **2** | Single-instruction orange and banana, stock scene | The orange archive supports a runtime comparison. The banana archive offers clear wrong-destination evidence. | **Supporting evidence.** Keep the historical cohorts distinct from the compound-task cohort. |
| **3** | Red block onto blue block, then three-block stacking, repository scenes | Moving from fruit to blocks demonstrates reuse. Three blocks add ordered subgoals and support stability checks. The handoff reports some Dream‑1 successes on both. | **Optional advanced showcase.** Prefer one genuine three-block recording with milestone evidence. |
| **4** | Tube sorting into color-coded racks, repository `racks` scene | Two outputs make partial completion visible. Sorting can succeed sequentially, so it offers weak evidence of simultaneous bimanual coordination. The handoff reports low whole-task success. | Defer live use. |
| **5** | Hold a cup while inserting a tube, repository `hold_fill` scene | Genuine overlap requirement, with informative hold and insertion events. Low reported success and higher sensitivity to contact and timing. | Historical appendix only if asked about coordination. |
| **6** | Tower of Hanoi, repository `hanoi` scene | Rich legality and progress signals. The handoff reports zero of six Dream‑1 successes in its single-instruction cohort and a much longer trial horizon. | Exclude from the main demo. |
| **7** | New custom task | A scene builder can support geometry without establishing valid reset distributions, meaningful grades, or policy competence. Each would require separate verification. | Cut at H0. |

**Task definitions for the shortlist**

| Preset | Objects and required observations | Grade and diagnostic evidence | Reuse and risk |
|---|---|---|---|
| **Orange into bowl** | Orange, bowl, any stock distractors, existing robot-state and camera inputs. Evaluator needs object pose, bowl geometry, contacts, and settle signals. | Success when the authoritative grader confirms the orange meets containment and settle criteria. Diagnose wrong object, missed contact/lift, drop, wrong placement, or time limit. Preserve the run’s actual settle interval. | Reuse stock scene, target/goal mapping, and tracker. Low implementation risk once target versions are pinned. |
| **Banana on plate** | Banana, plate, and bowl in the verified stock scene. Evaluator needs banana pose, plate support criteria, bowl containment, and settle signals. | Success when the banana is stably on the plate. Bowl containment can support a wrong-destination diagnosis. Use separate destination evidence for each receptacle. | Reuse stock integration and most of the same inspector. Low engineering risk, high live success risk. |
| **Three-block stack** | Existing block geometry and specific ordered goal. Evaluator needs identities, poses, contact/support relations, and settled subgoals. | Use the existing sequence tracker and final stable relations. Show confirmed milestones such as “2 of 3 subgoals,” where the task defines them, plus wrong order or unstable placement. | Reuse recorded evidence. Avoid adding a live preset if the tracker output requires major adaptation. |

## 6. Complete UI/UX Blueprint

Use three primary navigation entries: **Experiments**, **Compare**, and, if shipped, **Datasets**. Put **New experiment** on the overview. Combine Monitor and Failure Inspector into one experiment page with a selectable trial and a direct trial link. Retain the last selection across refresh. Put run origin, status, and the next available action at the top. On the trial detail, give the camera evidence and failure stage the most space.

Use **Poppins** for headings, body text, and controls. Give the task form, ordered plan, trial table and camera evidence a practical robotics dashboard layout. Use plain labels such as **Review plan**, **Step 1 of 2**, and **Open recording**. Use genuine screenshots and recordings. Omit generic AI copy, AI-styled templates, filler badges, generator signatures and watermarks.

| Screen and effort | User, purpose, and information | Controls and backend data | States and judging value |
|---|---|---|---|
| **1. Experiments overview · P0 · 0.5–0.75 h** | First-time developer or judge. One sentence of purpose, recent runs with date/task/source, grade counts, and a link to the featured genuine comparison. Show the selected budget’s state only when its source is known. | **New experiment**, **Open recorded demo**, filters for task and source. Read run summaries, capabilities, and archive availability. | Empty: start a run or open a prepared archive. Loading: render the shell and then the list. Success: show recent runs. Failure: show storage/read error and retry. Judges see a usable entry point and visible provenance. |
| **2. Task configuration · P0 · 0.75–1.25 h** | Operator creating a batch. Show defaults, scene, estimated usage, and an ordered step preview with each goal and time limit. | Task/scene/model controls, instruction, count, record toggle, seed preview, **Review plan**, **Start experiment**. Submit the reviewed plan ID or hash with the normalized config and idempotency key. | Empty: load presets. Loading: wait for plan preview. Success: launch the reviewed plan. Failure: preserve draft and explain unsupported steps or admission blockers. |
| **3. Experiment monitor · P0 · 1–1.5 h** | Operator waiting on a batch. Show active, completed and pending steps, trial progress, elapsed wall/simulation time, calls, estimated usage, and trial statuses. | **Cancel**, **Resume** when eligible, **Inspect**, **Compare**. Read experiment snapshot, step events, heartbeat, stop reason, and asset state. | Empty: queued. Loading: retain last snapshot. Success: show each confirmed step and resulting grade. Failure: highlight the failed step and keep prior steps visible. |
| **4. Failure inspector · P0 · 1.25–1.75 h** | Developer investigating one result. Show recorded cameras, timeline or event list, last confirmed stage, evidence values, outcome, and one suggested next experiment when justified. | Select trial, replay clip, jump to an event when time mapping exists, **Try a change**, copy trial link. Read event timestamps, raw code, normalized explanation, media manifest, and task criteria. | Empty: select a trial. Loading: fetch trial independently from media. Success: show evidence for graded success or failure. Failure: show partial evidence when a clip or sensor is missing. Judges can see the connection between a label and an observable event. |
| **5. Comparison · P0 · 1.25–1.75 h** | Developer choosing a configuration. Show changed settings, group counts, paired outcomes, call/latency tradeoffs, and report provenance. | Select baseline and candidate, filter discordant pairs, open either trial, **Clone baseline**. Read compatible run configs, fingerprints, metric samples, and pair rows. | Empty: select two runs. Loading: show selected configs while metrics load. Success: show direction and strength. Failure or incompatibility: give the reason and show descriptive counts where valid. Judges see the decision the product supports. |
| **6. Dataset and fine-tuning studio · P1 web view · 0.75–1.25 h** | Developer reviewing demonstrations. Show source, inclusion decision, quantity, recorded channels, validation issues, and recorded job/checkpoint status. | Review eligible episodes, exclusions and validation results. Link to the official platform job. The H2 workflow uses the recorder, local validator and official platform directly. | Empty: explain required recording data. Loading: show local inspection progress. Success: distinguish local validation and provider processing. Failure: give episode-level reasons. |

**Live monitoring** means refreshing execution status about once per second while the page is active. Sim time and wall time are separate, especially while awaiting inference. Show a current task stage only if a detector event has arrived. Display **Waiting for first model reply** when that is the only evidence. Play existing browser-compatible video or GIF after recording is available. GIFs get an event list and, where possible, a matching still. Timestamp seek requires a video asset with a known event-to-clip time mapping. Streaming would require capture, encoding, frame throttling, transport, and reconnection work. Recorded footage plus live status is sufficient for P0.

## 7. Technical Architecture

Reuse the existing Python web app and runner. Use **local JSON and JSONL files** and local media for the MVP. Run one coordinator as the sole writer of experiment state. Keep the draft in the form, the selected trial in the URL, and the approved plan in the run directory. Add SQLite only for a concrete local persistence need. Use hosted storage only if multiple machines need to write the same run history. The official training dataset upload is a separate operation.

```text
Browser pages
    | form submissions and status polling
Python web app + experiment coordinator
    |                         \
    | lifecycle and index      \ read-only history import
    v                           v
JSON/JSONL + local media   Historical configs, results, logs, clips
    ^
    | attempt events, heartbeat, and result references
One isolated trial process
    |                 |
Existing MuJoCo       Existing DreamClient control loop
scenes + graders      -> DreamAPI inference
```

| Component | Owns | Existing connection |
|---|---|---|
| Web pages and JSON API | Form validation feedback, display, polling, replay, comparison links | Normalize routes around the existing task and result concepts. |
| Task registry | Preset IDs, target/success criteria, valid inputs, capability flags | `scenes.py`, `detectors.py`, runner options. Start with a small explicit registry. |
| Plan preview and step execution | Supported instruction mapping, review, verified step transitions, per-step events | Reuse the existing stepwise runner pattern and `SequenceTracker` where applicable. Pass the active step prompt to the existing DreamClient control loop. |
| Coordinator | Admission, seed slots, one active child, stop/recovery state, attempt ownership, spend cap | Reuse seed/config normalization from `sweep.py` where available. Adapt the single-trial entry point so there is one scheduler for web runs. |
| Trial adapter | Invoke the existing runner with an allowlisted parameter mapping, collect coarse events, stage artifacts | `runner.py`, official SDK, stock simulator. Prefer a documented runner hook or a thin wrapper. Use a fixed executable and argument list if calling a CLI. |
| Evaluator and comparison | Normalize evidence and derive summaries and pairs | Existing trackers, `paired.py`, and report calculations after checking semantics. |
| Archive and media | Read historical config/results, verify associations, serve registered media | `runs/` and `showcase/`. Import with explicit provenance. |
| Optional dataset workspace | Local eligibility, manifests, export, optional provider metadata | Verified recorder and official dataset tooling. Independent of live experiment success. |

**Proposed layout.** Keep `dreameval/` and `showcase/`. Add `mission_control/` with `app.py`, `tasks.py`, `experiments.py`, `store.py`, `adapter.py`, `analysis.py`, `archive.py`, `templates/`, and `static/`. Add a dataset module only if that scope ships. Put app state, media, and the compact demo bundle in a documented local data directory. Keep credentials and large media out of tracked files.

### Execution and persistence

1. **Create** the immutable config, reviewed plan, seed manifest, and idempotency key in one atomically published `config.json`. Serialize creation and slot claims through one coordinator. Persist the attempt ID before starting the worker. Rebuild the creation index from run configs on restart.
2. **Run** one isolated process per attempt using the existing reset, camera capture, inference, action application, and grading path. Reset once per trial. Log `step_started`, `step_succeeded` and the applicable stop event with the step ID, simulation timestamp, and evidence. Pass fresh observations and the active instruction after each verified transition. Keep evaluator-only physics state out of model inputs. Let the child write attempt-specific events, while the coordinator appends finalized outcomes to `results.jsonl` and atomically replaces the status snapshot. Reconcile from finalized records on restart and ignore partial trailing event lines.
3. **Complete** an attempt when a grade or infrastructure disposition and its metadata are durably committed. Store media independently as `pending`, `ready`, `missing`, or `failed`. Promote finished media out of staging after verifying its association. A missing clip never changes a valid grade. Reject a late result if the attempt lost ownership. Import historical rows and reconcile retried attempts through explicit IDs.
4. **Stop** cooperatively at the next action boundary or after a bounded request returns. Check for stop before another request and before applying a new response. Show `stopping` while awaiting teardown. For a stalled child, use a finite watchdog and terminate the owned process. In simulation, halt stepping, save available evidence, and reset on the next trial. Treat unconfirmed in-flight usage as potentially chargeable.
5. **Recover** from restart using attempt leases and recorded request deadlines. The child checks a coordinator lease before new work. Resume only after the predecessor has exited or its lease and bounded in-flight grace have expired. Unstarted slots retain their manifest. Retry explicitly selected infrastructure/interrupted slots from a clean reset with a new attempt ID. Preserve graded results and earlier attempts.

**Experiment statuses:** `queued`, `running`, `stopping`, `blocked`, `interrupted`, `completed`, `completed_with_errors`, `cancelled`.
**Attempt statuses:** `queued`, `running`, `succeeded`, `task_failed`, `infra_error`, `interrupted`, `cancelled`. A valid trial that reaches its simulation time limit without success is `task_failed` with reason `task_timeout`. A wall-clock watchdog or request timeout is an infrastructure event. A user cancellation closes pending slots. The user can clone a cancelled experiment if they want to run it again.

### Planned local API contract

| Method and path | Contract |
|---|---|
| `GET /api/catalog` | Presets, effective defaults, allowed combinations and bounds, model choices, local live readiness, resource estimate source. This reads local capability/configuration. |
| `POST /api/plans/preview` | Supported task/scene and compound instruction. Returns ordered step IDs, instructions, goal IDs, limits, and a plan hash. An unsupported clause returns a field-level explanation. |
| `POST /api/experiments` | Validated config, current reviewed plan hash, seed or variation manifest, optional parent ID, and idempotency key. Returns `201` with ID, frozen config, and trial slots. Rejects a stale plan after an instruction edit. |
| `GET /api/experiments` and `GET /api/experiments/{id}` | Paginated/filterable summaries or one config, experiment state, revision, progress, `updated_at`, blocker, and per-trial summaries. |
| `GET /api/trials/{id}` | Current effective result, attempt history, events, evidence, timing and usage fields, and asset IDs. |
| `POST /api/experiments/{id}/cancel` and `/resume` | Idempotent transitions. Cancel returns `stopping` or the existing terminal state. Resume queues eligible work after blockers and attempt ownership are resolved. |
| `GET /api/comparison?baseline=…&candidate=…` | Field diff, comparability level and reasons, separate denominators, paired outcomes, missing pairs, and metrics with sample sizes. |
| `GET /media/{asset_id}` | Serve a registered local asset using a validated path inside the data root. Support browser video seeking where available. |

Use `422` for invalid fields, `409` for conflicting state or a live-admission blocker, and `404` for unknown IDs. Errors carry `code`, a user-facing `message`, affected `fields` when relevant, and a recovery action if available. Redact credentials and private request content from logs and responses.

### Proposed data schema

| Record | Required fields and constraints |
|---|---|
| **Experiment** | ID, source (`live`, `archive`, `scripted`), task/scene/model config, code/SDK/scene/grader versions if available, parent ID, config hash, ordered manifest, status, reason, timestamp and budget reference. |
| **Ordered plan** | Original instruction, version and hash, ordered step IDs, normalized Dream‑1 instructions, registered goal IDs, per-step time limits, and required final-state checks. Store step dispositions and evidence in the attempt events. |
| **Trial slot and attempt** | Unique `(experiment_id, slot_index)` plus seed and replicate index. Initial-state fingerprint or explicit unknown. Each attempt has an ID, attempt number, ownership lease, times, status, outcome and raw reason. One effective graded result per slot. |
| **Event** | Attempt ID, sequence number, event kind, wall time, nullable simulation time and evidence payload. Measurements include units and detector/source ID. Optional media timeline reference. |
| **Media asset** | Asset ID, attempt ID or verified historical identity, camera labels, format, relative path, availability, timing offset if verified. |
| **Usage record** | Attempt ID, simulation or fine-tuning budget, calls attempted/completed, provider-reported usage if available, estimated native-unit usage, reserved amount, uncertain debit, tariff source/date. |
| **Optional episode or job** | Episode origin and quality status, frame/action counts, task, embodiment, split key, validation findings. If used, remote dataset ID, job ID, service status, checkpoint ID and timestamps. |

## 8. Metrics and Failure Analysis

### Evidence and failure taxonomy

Apply the existing grader first. Then explain its outcome from measured events. Represent a milestone as **observed**, **not observed with adequate coverage**, or **unknown**. A detector or recording gap makes evidence unknown. Calculate thresholds in documented simulator units, use sustained conditions to filter transients, and retain the detector version in every result.

| Stage | Measurement and user-facing evidence |
|---|---|
| **Locate** | Camera availability and observable scene state. Display “Required camera frames arrived” or the frame fault. Simulator state establishes object position. A model’s recognition remains unknown. |
| **Reach** | Minimum gripper-to-target distance and threshold crossing when state is available. Show minimum distance, threshold, and timestamp. |
| **Contact** | Gripper or finger contacts with the named object from physics. Separate target contact from distractor contact. |
| **Grasp** | Use the existing grasp signal if verified. Otherwise, describe sustained contact and object motion with the gripper as evidence consistent with a grasp. A gripper-close command alone is insufficient. |
| **Lift** | Existing lift threshold relative to the initial or support height, with duration. Show peak rise and the measured threshold if logged. |
| **Transport / Place** | Movement of the target toward or into a goal region and whether support or containment is detected. Report another destination only if its geometry was actually evaluated. |
| **Release / Settle** | Gripper/object separation or contact loss with support/containment, followed by the grader’s stable interval. If release telemetry is unavailable, show the settling result on its own. |

Use the runner’s authoritative failure label when it has supporting evidence. For derived labels, prefer the most specific **terminal** observation: settled wrong object or destination, a drop after lift with no recovery, target entered without settling, contact without confirmed lift, target never contacted, or task time limit with stage unknown. Preserve earlier events as secondary evidence. An earlier drop that the robot subsequently recovers should remain in the timeline. If evaluation cannot complete because observations, model replies, or physics state are invalid, show the infrastructure disposition and last trusted milestone.

- **Example measurement:** “Contact logged at 9.4 simulation seconds. The orange rose 4 mm. The configured lift threshold was 20 mm.” These numbers are illustrative UI copy. Actual values must come from the selected trial.
- **Example suggested experiment:** “Keep the scene and seeds. Compare a shorter action chunk to check whether more frequent observations change the contact-to-lift outcome.” For a missing camera, the suggested action instead opens the input diagnostic. Suggestions are hypotheses and remain user-triggered.

### Reliability and comparison metrics

Use `S` for successes, `F` for valid task failures, and `N = S + F`. Display graded, infrastructure, cancelled, and pending counts together so the denominator is visible.

| Metric | Definition, inputs, and availability | UI and decision value | Limitation |
|---|---|---|---|
| **P0 Grade counts and success rate** | `S`, `F`, and `S/N` from finalized grades. Return unavailable when `N = 0`. | “7/12 graded succeeded” next to the experiment status breakdown. Shows repeatability. | Invalid or missing attempts can bias the observed cohort. |
| **P0 Failure-stage frequency** | Per-label count and count divided by `F`, using one primary label per graded failure. Show unknown separately. | Sorted bar list linked to trials. Prioritizes inspection. | Depends on detector coverage and label precedence. |
| **P0 Milestone attainment / partial completion** | Observed milestone count over trials with known evidence for that milestone. For ordered tasks, verified subgoals achieved divided by defined subgoals. Available as events arrive or after final grading. | Stage list with counts and per-trial evidence. Distinguishes a grasp problem from a placement problem. | Milestones have different difficulty. Avoid averaging arbitrary stages into a percentage. |
| **P0 Placement duration** | Time from simulation reset to first confirmed terminal success, median across successes. Show simulation time and sample count. | Compare speed among successful trials. | Conditioned on success. Show success rate alongside it. |
| **P0 Seed results and paired effect** | For `M` complete pairs, show both succeed, candidate alone succeeds (`W`), baseline alone succeeds (`L`), and both fail. Matched delta is `100 × (W − L)/M` percentage points. For unpaired cohorts, show group rates and mark any difference descriptive. | Side-by-side counts and a per-seed table. Helps identify regression and its conditions. | Missing pairs can bias the matched subset. Fixed seeds do not guarantee deterministic service responses. |
| **P0 Uncertainty, using verified report code where possible** | Per-arm 95% Wilson interval from `S` and `N`. Wilson uses center `(p + z²/(2N))/(1 + z²/N)` and half-width `z√(p(1−p)/N + z²/(4N²))/(1 + z²/N)`, with `z = 1.96`. Show when `N > 0`. | Compact interval next to `S/N`. Indicates how noisy the estimate is. | Individual-arm intervals do not test the paired difference. Trial dependence or a narrow scene distribution limits interpretation. |
| **P1 Exact paired evidence** | If pair identity and independent seed units are credible, two-sided exact McNemar via the binomial distribution on `W + L` discordant pairs. Available after complete pairs. Show zero discordant pairs as no observed change in that sample. | Expandable evidence detail. Useful when the team must defend a directional result. | Exploratory tuning, sample selection, and multiple comparisons limit the claim. |

**Fair comparison protocol.** Fix the task, initial-state manifest, grader, horizon, camera configuration, controller mode, and checkpoint except for the field under study. Compare action chunk, prompt wording, or model separately. For an intentionally varied scene, record the factor, share the base reset factors where meaningful, and use descriptive results if start-state correspondence cannot be shown. For new cohorts, interleave A/B trials with balanced order if the H8 P1 launcher ships. Otherwise use adjacent batches in one session and disclose batch order. Verify effective settings and start-state identity. Historical runs with seeds but incomplete provenance can show **Seed-aligned historical runs** with a descriptive delta. Predeclare the count and practically meaningful effect before a fresh comparison. Show **candidate higher**, **candidate lower**, or **tied in this sample** alongside **insufficient evidence** when warranted. Never infer a universal default from one scene.

### Runtime and cost metrics

| Metric | Definition, source, and timing | Display and decision value | Limitation |
|---|---|---|---|
| **P0 Model calls** | Count attempted and completed inference calls from client instrumentation, using transport-level counts when observable. Available as requests occur. | Per trial and per run. Explains the compute tradeoff of shorter chunks. | Client calls or attempts can differ from provider-billed units. |
| **P0 Time to first valid response** | Wall time from first inference dispatch to first usable model response, including any intervening wait. Null if no response. | Monitor and trial detail. Exposes startup/first-response problems. | Report timeout separately from successful response latency. |
| **P0 Median API latency** | Median measured request round trip for valid responses, with sample size. | Compare responsiveness between configurations. | Includes transport and provider time in that instrumented boundary. |
| **P1 p95 API latency** | 95th percentile of the same samples using one documented percentile convention. Surface with sample size and a small-sample flag. | Shows whether occasional slow replies dominate perceived delay. | Omit the percentile when sampling is too sparse to be helpful. |
| **P0 Simulation and wall duration** | Simulation time from reset to stop, and elapsed wall time from worker start to terminal result. Queue wait is separate if shown. | Explains long runs and time lost waiting for replies. | Failed and cancelled attempts may supply only partial durations. |
| **P0 Timeout and request failure rates** | Task timeouts `÷ N`, infrastructure timeouts per started attempt, and failed observed requests `÷` attempted observed requests. Show counts with ratios. | Distinguishes task difficulty, infrastructure instability, and input errors. | Hidden SDK retries may obscure individual request failures. Label the measurement scope. |
| **P0 Estimated and total usage** | Before launch, planned slots times a conservative per-attempt bound in the documented unit. Afterward, sum provider-observed or estimated usage across all charged attempts, including retries and interrupted work. | Break down estimate, actual if exposed, and unresolved usage. Supports the next spending decision. | A published dollar tariff does not establish the hackathon credit conversion. |
| **P0 Remaining local authorization** | Verified authorization less confirmed debits, outstanding reservations, and unresolved possible charges. Show the platform balance separately only when available. | Admission meter and reason when a run is blocked. | Reflects local tracking and the freshness of the verified starting authorization. |
| **P1 Usage per success** | Total experiment usage in one verified unit `÷ S`. Return unavailable if `S = 0` or cost evidence is incomplete. | Shows the operational cost of obtaining a successful result. | Sensitive to cohort size and cancellations. |

For the compound task, show **verified steps completed / planned**, the first incomplete step, and the measured completion time for each step. Overall success requires all ordered step checks and the final goal checks. To evaluate decomposition, compare the compound plan with a direct instruction on matched seeds and identical final grading criteria. Keep model, scene, action chunk, and total allowed trial horizon fixed. For a real fine-tune, reuse the same success, matched-seed, duration, call, and usage metrics. Add checkpoint ID, dataset size, and provider job status.

## 9. Demonstration Collection and Fine-Tuning Strategy

The proposed pipeline needs a branch after failure inspection. **A failed trial is diagnostic evidence.** Its rejected action sequence is unsuitable as a positive imitation target. A failure can identify a reset condition worth recording again, or a point from which a qualified controller or operator can demonstrate a recovery with valid observations and corrective actions.

| Data source | Use and eligibility |
|---|---|
| Failed rollout, event log, or aggregate result | Debugging, failure grouping, and choosing conditions to recreate. A metric row or rendered GIF lacks the aligned supervision needed for training. |
| Successful Dream‑1 rollout | Candidate only if original observations and executed actions were synchronized and the behavior passes quality review. Label as **model-generated**. A task-grade success alone is insufficient. |
| Corrective demonstration | Recreate the initial or failure state and record actions that actually achieve the correction. Prefer a clean successful episode for the initial dataset. Use recovery segments only if their context and boundaries satisfy the target recipe. |
| Scripted simulator demonstration | Use the existing oracle if it produces credible successful behavior and supports complete recording. Label it **scripted / simulator**, record the controller version, review action smoothness, and confirm the event account accepts this data source before training. |

**Recording and training workflow**

1. **Record** instruction, episode boundaries, embodiment, synchronized camera streams, robot state, timestamps, actions actually applied, and outcome. Preserve source and camera/action conventions. Keep intended chunks separate from rows executed in the simulator.
2. **Curate** successful, complete, diverse episodes. Review clips and associated action/state records. Group resets and related episodes so training and held-out evaluation are disjoint. Record why each omitted episode was excluded.
3. **Export and validate locally.** Select the LeRobot version accepted by the pinned SDK and event environment. Verify camera keys, video timing, monotonic timestamps, feature widths, action units and ordering, task and step labels, episode indices, and embodiment mappings. Validate one complete episode early to surface blocking format issues. Use the provider’s local validator for the final dataset. A manifest alone cannot be submitted as training data. [Official dataset and client documentation](https://pypi.org/project/dreamlabs-client/)
4. **Use the supported platform flow.** Select or register the matching embodiment, upload, persist the remote dataset ID, and wait for processing success. Submit one authorized, quoted job and persist its job ID. Poll at a modest interval and expose the provider’s terminal reason. Enable model selection after the provider publishes a usable checkpoint ID. On an ambiguous submission result, reconcile the existing job by account history before any second request. [Official fine-tuning workflow](https://pypi.org/project/dreamlabs-client/)
5. **Validate** the checkpoint against the base model on held-out paired starts, using the same settings and grader. Report actual grade counts and tradeoffs. Keep training data performance and held-out evidence separate.

**Target one fine-tuning submission by H2.** Start collecting data at kickoff, in parallel with the decomposition work. Use the existing runner and official tooling so the website can continue after submission.

| Time from kickoff | Data and training outcome |
|---|---|
| **0–30 min** | Confirm that the account accepts the target embodiment and scripted simulator data. Confirm required data quantity, format and credit quote. Start recording successful demonstrations and capture one complete sample. |
| **30–90 min** | Exercise the two-step sequence, review successful recordings, reserve disjoint evaluation seeds, and export and validate the dataset locally. Start provider upload as early as the validated dataset is ready. |
| **90–120 min** | Wait for provider processing. Submit one job by H2 once the dataset is accepted, the quoted spend fits the training allocation, and the team has reserved held-out evaluation capacity. Record dataset and job IDs. |

If a prerequisite is still open at H2, record the blocker and continue the product. Keep the main demo independent of provider turnaround. Use one task, one dataset version, one supported recipe, and one checkpoint. [Official job workflow](https://pypi.org/project/dreamlabs-client/)

If a submitted job remains pending at H11, freeze the presentation claim at its actual status and proceed with the base-model demo. A change to rows executed per reply changes how the application uses the model’s outputs. Fine-tuning changes the model checkpoint.

## 10. Credit Allocation

These allocations are **credit ceilings**, not run counts. Before the first paid batch, the future agent should verify the event-specific billing unit, failure/retry billing, and either a conservative per-attempt bound or an approved known ceiling. Use existing evidence first. The public model price and historical dollar estimates cannot provide the credit conversion. [Dream Labs public pricing context](https://dreamlabs.ai/research/dream-1/#running-the-model-costs-just-3-per-hour-for-dream-1-or-2-per-hour-for-dream-1-flash)

### Budget A — 120 simulation/testing credits

| Use | Credits | Release rule |
|---|---:|---|
| Integration smoke | 8 | Exercise local/scripted paths first. Admit the smallest genuine Dream‑1 trial the verified 8-credit cap covers. |
| Primary evaluation | 20 | Fill gaps in orange evidence after inspecting recorded results. Avoid recreating an already adequate baseline. |
| Controlled comparison | 36 | Prioritize complete direct-instruction versus ordered-plan pairs on the compound task. Use the existing 24-vs-48 archive for action-chunk evidence. Reserve both arms before starting each new pair. |
| Secondary task | 8 | First use archived banana results. Spend for a genuine recording only if it materially improves evidence. |
| Final demo and rehearsal | 12 | Reserve for one bounded rehearsal and one bounded live start when the quote fits. Preserve local playback as the presentation fallback. |
| Emergency reserve | 36 | Held for recovery or an evidence gap. If fine-tuning goes ahead and validation is charged here, explicitly reserve it before job submission. |
| **Total** | **120** | |

When a credible bound is known, convert a bucket to at most `floor(bucket / conservative per-attempt credits)`. Use the combined bound for complete A/B pairs. Include setup or retry charges where applicable. Enforce the local limit before starting each attempt. If the installed client reliably exposes enforceable per-request limits, also stop before issuing a request that would exceed authorization. Otherwise admit only whole attempts with a verified upper bound and keep unresolved charges reserved. When the unit or bound is unknown, continue with recorded and scripted workflows while live admission stays blocked.

### Budget B — 1,000 fine-tuning credits

| Use | Provisional allocation in training credits |
|---|---:|
| One quoted training job, including known charged preparation | 800 |
| Validation, if charged to this budget | 150 |
| Uncommitted contingency | 50 |
| **Total authorized** | **1,000** |

Use the account’s quote for upload/processing if applicable and the selected job recipe. If validation belongs to Budget A, keep its Budget B allocation unspent. Stop before submission if cost is uncertain, the quote exceeds the cap, the dataset has blocking validation issues, or there is no credible time for held-out evaluation. The allocation buys no assumed number of steps.

## 11. Fourteen-Hour Execution Plan

H0 is team kickoff. Use the handoff’s wall-clock submission time only after confirming it. If H14 is 16:30 Berlin time, H0 is 02:30, feature freeze at H10.5 is 13:00, and H13.5 is 16:00. Effort estimates throughout describe engineering time for a developer familiar with the stack. The table assumes two developers where work can overlap.

**Owners:** **A** runner, decomposition, and file persistence. **B** plan preview, comparison, and presentation. **C** recording, export, and fine-tuning submission. With two developers, B handles the data track during the first two hours and starts the full web views afterward. Difficulty is low, medium, or high relative to this hackathon.

| Time | Objective and exact work | Owner, dependency, difficulty | Deliverable and acceptance | Risk and fallback |
|---|---|---|---|---|
| **H0–H1** | Map the two stock goals to existing detectors and stepwise runner. Agree the plan and local run-file formats. In parallel, verify account eligibility and billing and capture the first complete demonstration. | A/C, existing checkout and event terms, **high** | Two registered goals and one full episode, or a specific recorder/provider blocker. | Use a verified existing trajectory or keep recording locally while the blocker is resolved. |
| **H1–H2** | Exercise one continuous scripted two-step trial. Complete the export, local validation and upload, and target one official job submission by H2. If a third owner is available, build plan preview and identify one archive clip in parallel. | A/B/C, registered goals, recorder and provider status, **high** | First step advances only after its grader passes, both goals have evidence, and the training job is submitted or has an explicit blocker. | Use the supported runner path and official platform directly. Defer web studio work. |
| **H2–H3** | Wire plan preview, task validation, immutable seed slots, JSON/JSONL storage, creation, and budget admission. | A/B, step runner and file contract, **high** | Valid preset creates one durable experiment and duplicate submission maps to its original ID. Unsupported instructions fail before any launch. | Use one preset, one worker, and simple polling. |
| **H3–H4** | Connect one child attempt, event/heartbeat intake, and monitor polling. Run a minimal paid smoke only if covered by verified authorization. | A/B, validated config and runner mapping, **high** | One Dream‑1 trial reaches a valid grade or presents a truthful, actionable infrastructure outcome. Monitor reflects state without browser reload. | Keep the genuine archive available. Poll coarse states if per-stage events require invasive changes. |
| **H4–H5** | Implement stop, retry/resume rules, ownership leases, and result reconciliation. B adds grade counts and recovery controls. | A/B, worker lifecycle and persistence, **high** | Cancel stops scheduling and preserves prior results. Restart retains results and can resume eligible work with no duplicate grade. | If force teardown is still being stabilized, cap the trial and use cooperative cancellation with an honest `stopping` state. |
| **H5–H6** | Finish media registration, source labels, and event evidence on the trial page. Link one observed failure and one success to the appropriate camera asset or real still. | B with A, trial contract and archive manifest, **medium** | Judge can open and interpret a genuine failed trial, even with the network disconnected. | GIF plus evidence list, or verified still plus events. Skip video conversion and synchronized seek if unnecessary. |
| **H6–H7** | Build comparison response and page using existing pairing/statistics where compatible. Add config diff, membership counts, pair drill-down, and clone action. | A/B, normalized records and task versions, **high** | Actual A/B files produce explainable denominators and seed outcomes. A mismatched run shows why the comparison is limited. | Show paired wins/losses and descriptive metrics with provenance. Cut new statistical methods. |
| **H7–H8** | Complete the P0 walk-through, including step preview and verified transitions. Review stop behavior, usage, evidence links and local playback. | A/B, P0 screens and lifecycle, **medium** | Review plan → run → inspect → clone → compare works. A failed step cannot advance and offline playback works. | Cut P1 if P0 is outstanding. |
| **H8–H9** | If P0 is green, run a matched direct-instruction versus ordered-plan comparison within the verified budget. Add an input diagnostic if it fills an evidence gap. | A/B, stable P0 and compatible grades, **medium** | Same scene, seeds and final criteria. Any scale or incompatibility limit is visible. | Keep the historical orange comparison separate from the compound-task demo. |
| **H9–H10** | Finalize genuine demo evidence and error copy. Apply Poppins and check copy and recordings against the website requirements. Surface dataset/job status if easy. | B/C, P0 green and evidence available, **medium** | Portable bundle includes plan, trial events, provenance and available footage. | Defer the web studio and provider job UI. |
| **H10–H11** | Final integration on the presentation PC. Check local read paths and a bounded restart/cancel. Freeze features at **H10.5**. Confirm training status by H11 if relevant. | A/B, submission machine and bundle, **medium** | One releasable build, one offline bundle, one known working launch path. | Revert fragile late features. Use an archived comparison if new results are incomplete. |
| **H11–H12** | Run the final authorized rehearsal smoke, check playback with network disabled, and verify provenance and calculations against source rows. | A/B, release candidate and demo reserve, **medium** | Both live-start and offline flows pass. If access is down, logged genuine Dream‑1 evidence remains independently inspectable. | Switch presentation to recorded mode at H12 if the live start is unreliable. |
| **H12–H13** | Rehearse the three-minute narrative twice, including the failure and budget fallback. Finalize names, timing, Q&A, and presenter handoff. | B, A supporting, release candidate, **low** | Presenter finishes in time and can reach meaningful evidence within 15 seconds of a failed live start. | Start in the local archive with explicit provenance. |
| **H13–H14** | Prepare the submission package and summary. Verify links, build identity, archive accessibility, and submission requirements. Target submitting by H13.5 and retain the final half hour for correction. | A/B, confirmed logistics and readiness checklist, **medium** | Submitted package matches the rehearsed build and evidence. | Submit the stable P0 candidate and documented limitations. |

**Critical paths:** step rules → continuous ordered execution → plan preview and file-backed monitor → failure evidence and comparison → rehearsal. In parallel from H0, capture → curate → export → validate → upload and process → submit by H2 when eligible.

**Solo path:** Start recorder and export work at H0, using the existing runner and official platform for the H2 training target. Build one supported plan, one worker, and three views. Use the first successful complete episodes to address platform requirements while developing verified runner transitions. After H2, use the existing archive for comparison and spend remaining development time on plan review, monitoring, inspection, and recovery. Keep the H10.5 freeze and use existing artifacts for rehearsal.

## 12. Prioritized Engineering Backlog

Each estimate is incremental engineering effort. Parallel owners can overlap work after the data contract is agreed. P1 and P2 items are independent cuts, not commitments to fit every estimate into 14 hours.

| ID · title · effort | Goal, dependencies, and inputs | Planned implementation and outputs | UI/backend acceptance and fallback |
|---|---|---|---|
| **P0-00A · Decompose and execute one supported compound task · 1–2 h initial runner path** | Reuse stock scenes, the stepwise runner pattern, `SequenceTracker`, and existing goal checks. | Parse the supported instruction into two registered goals. Run both in the same simulation, discard stale actions at each transition, and log verified step outcomes. Add preview to the web configuration after the runner path works. | A completed first goal advances exactly once. Failure or timeout keeps the next step pending. Overall success verifies the final state. Fallback: another existing scene with two verified goals. |
| **P0-00B · Produce and submit the first qualified training dataset · first 2 hours, parallel** | Reuse the recorder/oracle and official tools. Requires complete observations and actions, eligible data, budget and provider processing. | Capture successful episodes, reserve evaluation seeds, export the accepted LeRobot version, validate locally, upload, and target submission by H2. | Record dataset/job IDs or the specific blocker. Use the CLI and official platform in place of a web studio. |
| **P0-01 · Verify the handoff · 0.75–1 h** | Establish usable runner, SDK pin, task, historical matched evidence, and media. Inputs are target checkout and actual archived files. | Record supported runner entry point and field mapping. Prepare a verified demo manifest referencing original configs, trials, and assets. | A known result can be traced to its original row and clip. Fallback: verified still and event details or budgeted fresh capture. |
| **P0-02 · Register and validate presets · 0.75–1.25 h** | Make reproducible orange runs from existing scene, target mappings, and allowable model settings. | Define task registry, catalog response, validated immutable config, configured seed expansion, and idempotent create. | Form preview matches persisted settings. Invalid combos are field-level errors. Fallback: fixed scene/model and one declared advanced lever. |
| **P0-03 · Normalize trial execution · 1.5–2.25 h** | Reuse `runner.py`, SDK, grader, and original run contracts. | Claim slot, start isolated attempt, normalize events/result, record effective parameters and attempt ID. | One actual attempt becomes a grade or clear error; legacy CLI remains usable. Fallback: existing runner invocation and coarse start/finish events. |
| **P0-04 · Enforce lifecycle and spend limits · 1.5–2 h** | Keep execution recoverable and bounded. Inputs are local authorization, usage evidence, child handle and lease. | Add admission/state guards, stop/resume, durable attempt ownership and conservative usage reconciliation. | Double-click and restart create no duplicate effective result. Blocking errors stop new trials. Fallback: conservative per-attempt caps, manual resume and strict one-worker mode. |
| **P0-05 · Import archives and serve media · 0.75–1.5 h** | Make genuine prior work portable. Inputs are run config, result rows, event files and matched media. | Normalize records with stable external keys, preserve origin, register media, raise explicit missing-asset states. | Re-import is idempotent. Offline replay is traceable to the selected trial. Fallback: curated subset with an explicit manifest. |
| **P0-06 · Build overview, form and monitor · 1.5–2.25 h** | Give the user one path from setup to progress. Reuse catalog, create and status APIs. | Implement templated pages and status polling, readiness/status reasons, cancel/resume controls, recent/archive links. | User can start from a valid ready preset and understand blocked, queued and completed states. Fallback: one overview table and text telemetry. |
| **P0-07 · Explain failures with evidence · 1.25–1.75 h** | Turn detector outputs, clips and timings into a useful diagnosis. | Render stage strip or event list, accurate measurements, outcome and a grounded next experiment. | One genuine failure is understandable with its matching clip or still and source event. Fallback: browsable GIF and evidence table. |
| **P0-08 · Compare and clone · 1.5–2 h** | Reuse existing pair logic and report metrics to test a change. Inputs are two normalized configs and outcomes. | Add compatibility checks, visible differences, matched indicators, incomplete pairs, per-trial drill-down and cloned manifest. | Counts reconcile with actual grades and config differences. Fallback: one curated comparison with verified pair rows and simple clone. |
| **P0-09 · Package and rehearse · 1–1.5 h** | Make the build and demo portable. Inputs are stable app, verified bundle, effective dependency versions and allowed submission artifacts. | Provide launch steps, offline path, provenance summary, demo order, and submission assets. | A teammate can open the bundle with internet disconnected and reproduce the three-minute story. Fallback: recorded app walkthrough and authentic raw report as supporting material. |
| **P1-01 · Add a standalone banana diagnosis · 0.5–0.75 h** | Reuse the compound plan’s banana goal as a single-instruction troubleshooting example. | Add the standalone preset and labelled historical failure evidence. | Plate remains the scored goal, and the bowl diagnosis has actual evidence. Fallback: linked historical trial only. |
| **P1-02 · Improve input and runtime diagnostics · 0.75–1.25 h** | Resolve camera issues and latency ambiguity using supported SDK signals. | Surface expected vs. observed cameras, first response, and optional p95 with sample scope. | Missing camera produces a specific explanation; real measurements carry units. Fallback: availability and timestamps. |
| **P1-03 · Launch interleaved comparisons · 0.75–1.25 h** | Reduce time/session drift for fresh experiments. Uses frozen pair manifests and coordinator. | Schedule one worker with balanced A/B order. Add launch preview and combined usage cap. | Trial order can be verified and both arms use the same starts. Fallback: adjacent batches and displayed order. |
| **P1-04 · Curate candidate episodes · 0.75–1.25 h** | Make demonstration readiness visible using recorder metadata. | Output a reviewed manifest, eligibility and exclusion reasons, provenance and held-out split keys. | Failed and incomplete episodes are excluded from the positive candidate list. Fallback: eligibility summary on the inspector. |
| **P2-01 · Add browser access to dataset validation · 0.5–1 h** | Expose the validation record from P0-00B when available. | Link the existing export and validator output from the dataset screen. | UI state matches the completed local validation. Fallback: CLI output and documented artifact paths. |
| **P2-02 · Track one official training job · 0.75–1.5 h integration, plus service time** | Reuse platform workflow if H2 gate passes. | Save dataset/job ID, current status and checkpoint, surface a platform link, and add the available checkpoint to the model registry. | Status and checkpoint come from real provider records. Fallback: dataset status only or a documented pending job. |
| **P2-03 · Add one advanced recorded showcase · 0.5–1 h** | Illustrate ordered subgoals using an existing stack run. | Register the genuine run and stage marks with its scene version and recording. | All shown milestones are supported by evidence. Fallback: omit the showcase. |

## 13. Testing and Acceptance Plan

The future developer should **exercise the actual application and existing runner directly**. Use recorded results, local/scripted runs, and a minimal authorized Dream‑1 smoke. Preserve credit for checks that require live inference.

| Check | Action for the future developer | Pass condition |
|---|---|---|
| Plan and ordered execution | Preview the supported orange-then-banana instruction. Run one successful scripted trial and exercise a first-step timeout. Launch one bounded Dream‑1 trial if covered by admission. | The preview matches the stored plan. One simulation reset serves both steps. A verified first step issues a new instruction with fresh observations. Timeout keeps the later step pending. Show the genuine Dream‑1 outcome if available. |
| Validation and unsupported settings | Try an invalid task/scene combination, duplicate seed, excessive horizon, and unsupported model or chunk. | No worker starts. The UI names invalid fields and preserves valid inputs. |
| Duplicate submission | Submit twice using the same creation request and refresh while queued. | One experiment and one set of slots. |
| Persistence and recovery | Interrupt the app after a completed slot and during an active local attempt, then restart and resume. | Completed results remain. Eligible slots run from the same reset manifest with a new attempt ID, after ownership is clear. |
| Stop and deadlines | Cancel an active attempt, and let a separate bounded attempt reach its declared limit. | No next trial starts after cancellation. The UI distinguishes a simulator task timeout from request or worker failure. |
| Invalid key, authorization, network, and quota | Exercise a known local admission blocker, existing error records, or a controlled network interruption. | Authentication/access/budget stops the queue. One bounded retry is allowed only for an explicitly retryable transient with available budget and understood SDK behavior. Unknown authorization causes get neutral copy. |
| Evidence integrity | Open a known success, a genuine failure, a missing-media trial, and an incomplete archive row. | Correct source, stage and clip are shown. Missing evidence remains visible and leaves the grade unchanged when the grade is valid. |
| Comparison arithmetic | Reconcile the displayed counts and matched outcomes by reviewing actual result rows. Open an incompatible pair. | Denominators, seed membership, differences, and exclusions agree. Incompatible conditions are labelled. |
| Offline and presentation | Disconnect the demo machine from the network and open the packaged walk-through. | Overview, replay and comparison work locally, and archived status stays visible. |
| Dataset and job | Review a complete episode and an excluded failed or incomplete one. Run the official local validator and inspect actual provider state if a job exists. | Export status matches the validator. Training and checkpoint status match provider records. |

For invalid camera frame shapes, malformed model replies, invalid numeric robot state, and simulator crashes, stop that attempt at the validation or process boundary and preserve the last trusted event. A one-off recording failure can continue with valid observations. Repeated environment faults pause the batch. `DA-1000` is documented as an authorization error. The handoff observed it after account credits were exhausted, so the UI should say **DreamAPI access was refused** unless the provider separately confirms a balance cause. Honor provider retry metadata and account for SDK-owned retries before adding an application retry. [Official client errors](https://pypi.org/project/dreamlabs-client/) · [Project handoff](https://github.com/Sridhar-Kandi/hackathon_dreamlab#setup-windows-notes)

## 14. Live Demonstration and Presentation Plan

**Live setup:** preload the verified two-step preset, one fixed seed, and a conservative cap. Keep a genuine compound run if available, a clearly labelled scripted compound run, and the genuine historical orange comparison ready in the same app. Show the sequence in the preview and monitor. Use archived outcomes for evidence that takes longer to collect live.

| Time | Say | Show and do | Evidence judges should see |
|---|---|---|---|
| **0:00–0:30** | “A Dream‑1 developer needs to know whether a task will work again, where it breaks, and which change to try. Mission Control gives them those answers from repeatable runs.” | Open the experiments overview. Point to one recent real run and the recorded comparison. | A developer workflow and real run provenance. |
| **0:30–1:00** | “I’ll give it one instruction with two goals. The app previews what it will send and how it will tell when each step is complete.” | Enter the supported instruction, click **Review plan**, then start the verified preset and open Monitor. | Two ordered steps, their goal rules, scheduled seed, and active step. |
| **1:00–1:40** | “Step two starts only when the first placement is verified. Here’s the recorded evidence for the transition, or the reason execution stopped.” | Open the genuine recorded compound result if available. If needed, use the labelled scripted recording to show a completed transition, then inspect a genuine Dream‑1 failure. | Step boundaries, camera evidence, detector signals, and an accurate execution source. |
| **1:40–2:20** | “We kept the task and start conditions fixed and changed how many action rows we executed per response. Here are the seeds where the outcome changed and the calls it took.” | Open the verified 24-vs-48 archive if supported by the actual artifacts. Show the config diff, sample counts and one discordant pair. | Reproducible comparison, a visible cost/reliability tradeoff, and the limits of the sample. |
| **2:20–2:45** | “We record successful demonstrations separately for training. Here’s the dataset or actual job status.” | Show the validated artifact or provider status if available. If blocked, show how the app preserves the plan and evidence for an interrupted experiment. | Honest training progress or useful recovery behavior. |
| **2:45–3:00** | “For this task and cohort, we can justify which setting to try next and show the evidence behind that decision.” | Finish on the comparison with the actual observed result and provenance in view. | A defensible recommendation limited to the evidence. |

**Prerecorded fallback:** Open the locally bundled compound plan and its verified recorded steps. If the compound recording is scripted, show its source. Then open the historical Dream‑1 comparison with its original configuration, model and capture date. Keep a short offline walkthrough if the submission format permits it.

**Q&A**

| Question | Answer |
|---|---|
| Why use this alongside Dream Labs’ interface? | Dream Labs supplies model inference, setup tooling and Live View. Mission Control adds repeated simulator trials, physics-backed outcomes, stored comparison evidence, and a next-experiment workflow. [Official library](https://github.com/dreamlabs-co/dreamlabs) |
| How is it different from a benchmark? | A developer can move from one failed trial to its evidence, vary a single setting, and follow the outcomes on the same starts. The harness powers that product flow. |
| How do you determine success? | A preset declares a physics goal and stability rule. For orange, the existing grader checks the named object’s stable containment in the bowl. |
| Can you explain failures accurately? | We report what simulation state and camera evidence support. Inferences are labelled as such, and missing evidence stays unknown. |
| Did you fine-tune? | Give the actual dataset and job status. Present checkpoint results only once held-out evaluation exists. The archived action-chunk comparison uses the original checkpoint. |
| Why repeat simulations? | One rollout can hide sensitivity to initial conditions or service variability. Matching starts helps attribute differences to the change being evaluated. |
| How general is it? | Scheduling and comparison are shared. Each supported scene needs an explicit goal and verified detector logic. Banana or stacking illustrates reuse if its evidence ships. |
| What if credits run out? | The scheduler pauses or blocks live work and keeps prior results and artifacts browsable. Eligible slots can resume after the cause is resolved. |
| Does it require a physical robot? | The demonstrated workflow runs on YAM simulation with Dream‑1 inference. Local recorded review requires no live connection. |

### Rubric priorities

| Major feature | Rubric value and implementation tradeoff |
|---|---|
| **Verified task decomposition** | **Real-user value 25, Technical difficulty 20, Demo quality 20.** Turns one supported compound instruction into a visible plan that the simulator checks step by step. Implement on one existing scene before expanding coverage. |
| **Failure inspector with genuine evidence** | **Real-user value 25, Demo quality 20.** Turns a failure rate into a decision. Highest return on UI effort and more valuable here than another task. |
| **Persistent execution, explicit errors, offline playback** | **Robustness 25, Demo quality 20.** Gives the app a dependable story during interrupted or unavailable service. Finish before pursuing training. |
| **Matched comparison and clone** | **Technical difficulty 20, Real-user value 25.** Demonstrates experimental control and the ability to use it. Reuse pairing logic to keep effort small. |
| **Clear, short workflow and rehearsed evidence** | **Presentation 10, Demo quality 20.** Judges can follow the decision without interpreting logs. Protect rehearsal time. |
| **Second task or episode preparation** | **Real-user value and Technical difficulty.** Shows transfer or a route to data collection. Worth adding after P0. Additional simulator scenes and actual training have higher delivery risk for the same judging time. |

## 15. Risks and Cutoff Decisions

| Risk | Likelihood / impact | Prevention and fallback | Decision deadline |
|---|---|---|---|
| Checkout differs from public handoff | Medium / high | Map versions and entry points immediately. Adapt the working interface, or use a curated archive for UI progress while runner issues are addressed. | H1 |
| SDK/API contract differs from README | Medium / high | Pin the combination proven on the target PC and use its documented symbols. Keep current SDK documentation as a reference, not an upgrade target. | H2 |
| MuJoCo/camera environment blocks startup | Medium / high | Prioritize the existing headless runner and simple recording. Use real archived evidence while resolving one specific compatibility issue. | H3 for a viable path |
| Historical clips unavailable or mismatched | High / high | Verify a specific result/media association early. Recover source media, use a verified still, or capture one budgeted run. | Identify by H1. Resolve by H6 |
| UI/backend integration delay | Medium / high | Establish one normalized result and a working page by H2. Keep templates and coarse polling. | H4 |
| Invalid credentials, access, or provider outage | Medium / high | Use explicit readiness and error codes, bounded timeouts, and archive. Exercise a genuine smoke when authorized. | H4 for working fallback, H12 for live/demo choice |
| Credit exhaustion or uncertain pricing | Medium / high | Require a credible native-unit bound, reserve before scheduling, and use historical evidence. Pause on confirmed quota refusal. | Before every paid run |
| Fine-tune queue, cost, or publication delay | High / medium | Target H2 with one eligible job. Continue decomposition and demo work if the provider or dataset is pending. Show real status if checkpoint misses H11. | H2/H11 |
| Dataset incompatibility | High / medium | Validate one full episode early, confirm accepted format and simulator provenance, and preserve evidence of unresolved blockers. | First sample by H1, launch target H2 |
| Incorrect step transition | Medium / high | Advance only on the registered physics predicate. Clear prior-step actions and request fresh observations. Use the scripted runner to exercise success and timeout. | H2 runner, H8 full flow |
| Unstable tasks or misleading causality | High / high | Use stock orange, fixed scope, known evidence, and careful language. Keep banana historical and model conclusions confined to the cohort. | H7 for comparison evidence, H12 for script |
| Misleading stats from missing or mixed runs | Medium / high | Check compatibility, show denominators, pair membership and uncertainty. Use descriptive summaries for incomplete provenance. | H7 |
| Last-minute integration failure | Medium / high | Freeze features, rehearse on the actual laptop, keep stable package and archive. | H10.5 freeze, H13.5 submit target |

**Explicit cutoffs**

- **New tasks and custom robotics assistance:** cut at H0. Revisit after the hackathon or if the supervisor explicitly changes the required scope.
- **Advanced camera streaming:** cut at H0. At H6 retain GIF/still playback if timestamped video would consume the inspector budget.
- **Additional statistics:** cut at H7 if the paired table, counts, and caveats already support the decision or P0 is unfinished.
- **Fine-tuning:** target H2 after data validation and provider acceptance. Record any blocker at H2. At H11, describe the real status if checkpoint publication or held-out evaluation is pending.
- **Nonessential UI polish:** stop at H10.5. Reserve remaining time for correctness, presentation legibility, recovery, and submission.
- **Live presentation:** switch to the genuine prerecorded path by H12 if network, credentials, budget, or repeatability make the live start unreliable.

## 16. Final Submission Readiness Checklist

- [ ] Confirmed supervisor requirements, submission format, time zone, and deadline are reflected in the package.
- [ ] The compound instruction maps to a visible ordered plan. One simulation runs its verified steps. A failed step keeps later steps pending.
- [ ] The supported-task form, monitor, inspector, and compare pages use Poppins, direct task language, and genuine recordings where available.
- [ ] Genuine Dream‑1 integration is evidenced by source-linked configuration, results, and model identity. Any live integration blocker is documented.
- [ ] One success and one failure have authentic evidence. One meaningful historical or fresh comparison reconciles with its trial rows and describes its limits.
- [ ] Blocked, interrupted, cancelled, graded failure, and missing-media states are distinguishable. Eligibility and duplicate prevention were exercised directly.
- [ ] Demo bundle opens locally with no connectivity. Selected recordings and linked stills resolve on the presentation machine.
- [ ] Effective SDK/runtime versions, launch steps, data directory usage, and archive origin are documented. Submission artifacts contain no credentials.
- [ ] Simulation and training credit usage are reported separately, with estimate units and unresolved charges labelled.
- [ ] The training dataset and job IDs are recorded, or the H2 submission blocker is documented. Dataset and checkpoint claims match actual validation and provider state.
- [ ] The team rehearsed three minutes and can answer Q&A. Presenter knows when and where to switch to the archive.
- [ ] Submission includes the stable project reference, concise product summary, required demo artifact or link, and known limitations.

## 17. Critical Open Questions

| Question | Default and consequence |
|---|---|
| **What did the supervisor explicitly require, and what artifacts are due?** | Provisional scope is a simulator-tested tool for Dream‑1 users, guided by the public handoff. A verified mandatory feature takes priority over a P1/P2 item. Confirm deadline and format at H0. |
| **Which checkout, SDK/runtime combination, and trial entry point are available on the demo PC?** | Preserve the environment that runs the current harness. Use the adapter to absorb interface differences. The public handoff cannot establish what is on the target machine. |
| **Where are the clips and source trial files for the main historical comparison?** | Assume the Git checkout lacks most media. Verify a portable subset from existing recordings first. This determines whether a paid capture is needed. |
| **What do simulation credits cover and how are they charged?** | Assume no conversion from published monetary pricing. Live admission requires a known account-specific authorization and credible attempt bound. |
| **Does the event account accept simulator/scripted data, and what are the recipe, quote, and turnaround?** | Verify at kickoff while capturing the first complete episode. Target H2 once the dataset is accepted and the quote is known. |
| **How many developers can work in parallel?** | Assign an early runner owner and a data owner first. Use the solo path if only one developer is assigned. |

## 18. Final Recommended Strategy

Ship **Dream‑1 Mission Control** with one complete path from compound instruction to verified execution and failure diagnosis. Start with orange into bowl, then banana onto plate. Reuse `dreameval`, the existing stepwise pattern and graders, and save runs with local JSON/JSONL and media. Show the ordered plan and evidence in a Poppins-based website with plain, practical copy.

Collect demonstrations at kickoff and **target an eligible fine-tuning submission by hour two**. Continue the product while the job runs or while a provider or dataset blocker is being resolved. Present the strongest verified compound run and keep the historical orange comparison clearly labelled. Protect the final three and a half hours for integration, verification, rehearsal, and submission.
