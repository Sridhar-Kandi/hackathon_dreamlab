# YAM Simulation Console

From `hackathon_dreamlab`, start the console with the repository's virtual environment.

```powershell
& .\.venv\Scripts\python.exe -m mission_control
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). The **Overview** explains what the simulator measures and shows contact, lift and settlement for the fresh trials. Open **Run log** to inspect individual trials, view playback, or download the original result records.

## Verify the local simulator

Set up Python 3.13 with the dependencies in `mission_control/requirements-sim.txt`. The stock probe passed with Dream Labs 1.0.42 and MuJoCo 3.17.0.

```powershell
& .\.venv\Scripts\python.exe -m pip install -r mission_control/requirements-sim.txt
& .\.venv\Scripts\python.exe -m mission_control.execution --probe stock
```

Choose **Run a task**, keep **Tabletop placement sequence** and **Scripted simulator**, then select **Review procedure** and **Start simulation**. The order is orange into bowl, followed by banana onto plate in the same simulation. Both placements must pass the final check. For a timeout check, set **Simulation limit** under **Advanced settings** to one second. The first step should fail after 0.5 seconds and the banana step should stay unreached.

Fresh results are stored under `dreameval/.mission-control/runs/`. The original repository archive is outside the console's result index. The scripted controller uses simulator state and runs without a Dream-1 request. For Dream-1 access and the user-controlled fine-tuning workflow, see [execution and spending](mission_control/EXECUTION.md).

- [Presentation walkthrough](mission_control/DEMO.md)
- [Phase results](PHASE_RESULTS.md)
- [Development plan](tasks.md)
- [Showcase bundle with fresh results](YAM-Simulation-Console-showcase.zip)

---

# dreameval: an evaluation harness for Dream-1 (HackLab Berlin × BRISA, Dream Labs track)

Handoff document: everything a teammate needs to continue from here (status as of Sat 21 Nov 2026, 23:15).

**Track:** "Build a Tool for Dream-1 Users" using [dreamlabs](https://github.com/dreamlabs-co/dreamlabs), tested in the simulator.
**Rubric /100:** real-user value 25 · robustness 25 · technical difficulty 20 · demo quality 20 · presentation 10.
**Deadline:** submit by **Sun 22 Nov 16:30** (our plan: code freeze 13:00, submit 16:00). 3-min live demo + 2-min Q&A.

## What it is

dreameval runs Dream-1 on a task many times in Dream YAM Sim (MuJoCo) and grades every run from physics ground truth. It reports:

- **Success rate** with 95% confidence intervals. Settings are compared **paired**: same seeds, same start states, then a McNemar test.
- **Why runs fail:** one failure label per trial (wrong object, touched but never lifted, lifted but missed the goal, wrong destination, illegal move, never together, …).
- **A GIF per trial** of exactly the 3 camera views the model saw, plus an HTML report per run.
- **Cost and latency:** API calls per trial, estimated $ per trial and per success, median round trip.

It runs headless, with no viewer and no real-time pacing. Physics pauses while waiting for a reply, as the stock runner does.

## Organizer Q&A: the 5 user pain points, and our coverage

| Pain point (organizers) | Status |
|---|---|
| Reliability: does a task work every time? Slow first responses? | ✅ core of the harness (paired N-trial sweeps). Missing: first-response / slowest-call numbers in the report. |
| Knowing why a run failed | ✅ failure labels + GIFs + event logs. Missing: plain-English explanations of API errors. |
| Credits running out mid-task | ⚠️ the sweep stops on `DA-1000` and resumes only missing trials. Missing: **safe stop of the robot** (put the object down, open, go home) and a `--max-usd` budget cap. |
| Cameras: are images reaching the model correctly? | ❌ not started. The library already ships `DebugView` / `dream.input_check`, so integrate those rather than rebuild. |
| Recording demos without a robot | ⚠️ the scripted oracle makes correct sim demos for free. Missing: export to LeRobot format, which `dream.datasets.validate_dataset()` checks locally. |

Two things the official library already ships, so don't rebuild them:
- `DebugView`, `python -m dream.check`, `dream.check_model`, `dream.input_check`, and `trained_inputs` warnings. See the `dreamlabs` README and CHANGELOG.
- Running `get_action()` on its own thread.

What none of them do: N-trial reliability, before/after comparisons, demos without a robot. **That is our niche.**

## Headline results (all measured; raw data in `dreameval/runs/<name>/results.jsonl`)

Setup for every run: dream-1-beta, Dream YAM Sim, ±2 cm start jitter, success graded from MuJoCo ground truth (object settled for 1 s).

**1. Rows executed per reply is the biggest setting lever.** Orange into bowl:

| rows/reply | 16 | **24** | 32 | 48 (stock default) |
|---|---|---|---|---|
| success | 10/20 | 10/20 | 3/20 | 1/20 |

- Pooled over all runs: 24 rows got 50/92, 48 rows got 5/72.
- Paired, 40 trials: 24 beat 48 on 19 seeds and lost on 2, McNemar p = 0.0002.
- At 48 the dominant failure is a grasp that never corrects; at 16–32 it is picking the wrong object.

**2. Wording and nondeterminism.**
- Prompt wording made no measurable difference (9/20 vs 10/20).
- The same seeds went 9/10 in one session and 4/10 in another. Always compare paired, in the same session.

**3. Plain Dream-1 is about 40% on block tasks.** All at 24 rows:

| task | success |
|---|---|
| red block on blue | 6/15 |
| 3-block stack | 8/20 |
| orange into bowl | 10/15 |
| banana on plate | 1/15 (10 of 15 went into the bowl instead) |

**4. Grasp root cause** (`probe_grasp.py`):
- Dream-1 closes too high. In failed grasps the tool point is 1.0–1.9 cm above the block's top face; in successful lifts it is 0.1–0.7 cm.
- Retrying from the home pose ("grasp-retry supervisor") never beat plain in 3 paired tests: 14/20 vs 14/20, 4/10 vs 5/10, 4/10 vs 5/10.

**5. Assist experiment** (`assist.py`, mode `assist_place`): grasp-depth fix + placement centring, using sim ground truth.

| task | plain | `assist_place` | won/lost | p |
|---|---|---|---|---|
| red on blue | 6/15 | 14/15 | 8/0 | 0.008 |
| 3-stack | 8/20 | 17/20 | 10/1 | 0.012 |
| banana on plate | 1/15 | 8/15 | 8/1 | 0.039 |
| orange into bowl | 10/15 | 10/15 | — | — |

**Team decision:** set aside as overfitting, because it reads exact positions from the simulator. Present it only as a diagnosis: it shows placement, not grasping, was the bottleneck.

**6. Tower of Hanoi** (`hanoi.py`, scene `hanoi`; 3 blocks on 3 pads; 24 rows, single prompt, 420 s):
- Oracle 8/8; Dream-1 **0/6**.
- 5 of 6 broke the size rule; furthest progress through the 7-move solution was 0, 2, 5, 3, 5, 5.
- Twice it piled all three blocks on the target pad in the wrong order.
- One instruction per move: 1/4 trials broke the rule, typically 3–4/7 moves. Team decision: that is the user's choice, not a harness feature.

**7. Two-arm tasks** (`bimanual.py`; 24 rows, 120 s, 10 seeds):
- **`racks`** (sort a red and a blue tube into colour-coded racks, each tube starting on the opposite side): oracle 8/8, Dream-1 **1/10**.
  - Red tube placed in 5/10, blue in 1/10.
  - The arms never worked at the same time.
- **`hold_fill`** (left arm holds a cup up by its handle, right arm drops a tube in): oracle 7/8, Dream-1 **2/10**.
  - The cup was held in 7/10 trials, but the hold and the tube carry only overlapped in the 2 successes, for about 0.3 s.
  - The arms work in turn, not together.

## Code map (`dreameval/`)

| File | What |
|---|---|
| `runner.py` | One headless trial: stock Dream YAM Sim env + Dream client + grader. `python runner.py --task ... --target ... --goal ...` |
| `sweep.py` | Paired, resumable sweeps over prompts × rows/reply × modes; parallel workers; writes `runs/<name>/results.jsonl` + `report.html`; stops cleanly on DA-1000 |
| `detectors.py` | Ground-truth checks: contacts, lift, settle, `on:<x>`, `in:<container>`, `inside_bowl`, `on_plate`; `Tracker`, `SequenceTracker` (ordered/unordered); failure labels |
| `report.py` | HTML report (tables, intervals, outcomes, GIFs) |
| `paired.py` | `python paired.py runs/<name>`: per-seed table, wins/losses vs plain, McNemar p |
| `scenes.py` | Scenes built from the stock MJCF: `stock`, `blocks2`, `blocks3`, `hanoi`, `racks`, `hold_fill` |
| `oracle.py` | Scripted pick-and-place controller from ground truth + IK (the ceiling; `--model oracle`; no API cost) |
| `bimanual.py` | Containers/tubes, `HoldFillTracker`, coordination metrics (`both_arms_busy_s`, `arm_collision_s`, cup sway/tilt), two-arm oracle |
| `hanoi.py` | Hanoi grader (settled configurations, legality, progress) + BFS planner; mode `stepwise` |
| `assist.py` | The shelved ground-truth assists (`assist`, `assist_place`, `place_only`, `assist_adaptive`) |
| `probe_*.py` | One-off investigations (grasp height, redirect/occlusion, resampling) |
| `notes/dreamlabs_message.md` | Draft findings message to Dream Labs |
| `runs/` | Every run's `config.json`, `results.jsonl`, `report.html`, and logs. **Per-trial GIFs are not in git** (4.7 GB), so report pages show broken images. A few examples are in `showcase/`. |

## Setup (Windows notes)

```bash
python -m venv dream-env && dream-env/Scripts/pip install dreamlabs   # tested with dreamlabs 1.0.42, Python 3.13
# API key: put DREAM_API_KEY=... in ~/.dreamlabs/credentials (never commit it)
cd dreameval
../dream-env/Scripts/python.exe sweep.py run --name try1 --prompt "put orange into the bowl" \
    --target orange --goal inside_bowl --actions 24 --sim-seconds 60 --trials 4 --jitter-cm 2 --workers 4 --record
../dream-env/Scripts/python.exe paired.py runs/try1
```

Notes:
- `dreamcli` crashes on Windows (`import fcntl`). We don't need it: the harness imports the sim example `dream_examples/yam_mujoco` directly.
- Use 3–4 parallel workers. One trial costs about $0.03–0.13 (24 rows ≈ 50–100 calls at roughly $0.00133 per call).
- Keys die with `DA-1000 UNAUTHORIZED (disabled)` when credits run out. Rerunning the same sweep command resumes and reruns only missing or errored trials.

Example commands for the newer scenes:

```bash
python sweep.py run --name dream_racks --scene racks --prompt "put the red tube in the red rack and the blue tube in the blue rack" \
    --target red_tube --goal in:red_rack --actions 24 --sim-seconds 120 --trials 10 --seed0 300 --jitter-cm 2 --workers 5 --record
python sweep.py run --name oracle_hold_fill --scene hold_fill --prompt oracle --target red_tube --goal in:cup \
    --model oracle --actions 24 --sim-seconds 45 --trials 8 --seed0 300 --jitter-cm 2 --workers 8
```

## Proposed next steps (not started)

1. **Safe stop + budget cap.** On DA-1000, a network drop or a stalled reply, put any held object down, open the gripper and go home. Add `--max-usd`, and a fault-injection switch for a live demo: stock runner frozen holding the orange vs dreameval putting it down.
2. **Early stop.** End a trial when its result can't change: object off the table, illegal move, no progress for 60 s. This roughly halves sweep time and cost.
3. **Demo export.** Write oracle demos and successful Dream-1 runs as LeRobot datasets, check them with `validate_dataset()`, then `add_embodiment` + `upload_dataset`. Only `finetune()` costs credits; jobs take about 7–8 h. Then compare base vs fine-tuned on paired seeds.
4. **Camera + latency checks** in the report: all 3 cameras present, live and not black; first-response time; slowest calls.
5. **Packaging:** one task file, one command, a clean live log (`rich`).

## Rejected ideas (with reasons)

- **Async dual-threading / action interpolation:** the library already threads `get_action()`; median RTT is about 0.5 s; in sim, pausing physics is correct.
- **IK failure guard:** dream-1-beta returns joint targets; there is no IK step.
- **"Reset arm and retry until success":** measured no gain in 3 paired tests.
- **Tight-clearance peg-in-hole:** the much easier `hold_fill` is already 2/10, and force micro-correction would be scripted control (overfitting).
