# Current UI context (22 Nov 2026)

- Product name: **DreamLoop**, a Dream-1 evaluation, failure-analysis and targeted fine-tuning studio for DreamLab simulations.
- Current checkout: `C:\Users\SridharKandi\hackathon_dreamlab`. The React console is in `mission_control/frontend` (React 19, TypeScript, Vite, Tailwind 4, shadcn/Radix, lucide-react).
- Design now follows `https://dreamlabs.ai/`: bundled Walla (400–700), Bitcount Single detail labels, charcoal `#1c1c1c`, creamsicle `#ffb87b`, sunshine `#ffe885`, pastel lavender and grass accents, pill buttons and rounded panels. Source tokens were verified against the live public `tokens.css` and `components.css`. Original logo/cloud/playground SVGs and fonts live in `mission_control/frontend/src/assets`; Vite bundles them into `/static/`. Light/dark semantic tokens cover all React pages, including charts, status badges and forms; old Azure literals have been removed.
- `/` is the Overview landing page, including the standalone harness and all nine selectable capabilities. `/methodology` is a sidebar destination with an expandable execution → analysis → two-dataset curation → training/validation flowchart. `/experiments` is the run/create workflow; `?create=1` opens the creation dialog. `/analyze` compares up to three save files and contains the two-dataset pipeline. Ladder remains in `/classic`.
- Overview source: `src/pages/overview/overview-page.tsx`; methodology: `src/pages/methodology/methodology-page.tsx`; shared harness information: `src/components/harness-capabilities.tsx`; routing: `src/App.tsx`; shared navigation/branding: `src/components/app-shell.tsx`; tokens and diagram layout: `src/index.css` (all paths relative to the frontend). The Python server also registers `/methodology` for direct navigation.
- Overview describes A vanilla, B harness-assisted and C scripted/oracle; simulator-grounded contact/lift/settle grading; save-file comparison; D1 successful scripted sessions plus D2 same-seed expert corrections and scripted mix; API fine-tuning and held-out re-evaluation. It presents methodology, without claiming measured improvements or a completed checkpoint.
- `mission_control/lab.py:start_finetune` creates preview jobs (`dry_run=True`); Methodology explicitly labels this. The ladder CLI has the live training path. Do not describe the console preview as a live provider job.
- The shared shell is viewport-height with an independently scrolling main pane, so the header and sidebar stay in place. Route changes reset main-pane scroll. Numeric Create experiment fields use editable text drafts and numeric keyboards, with required/range/integer validation before submission; numeric harness overrides are converted back to numbers in the request.
- The studio sidebar links only Overview, Experiments, Analyze & fine-tune, and Methodology. The Ladder link and its empty More tools section have been removed; the legacy console route is retained.
- Dream Labs restyle validation: TypeScript/Vite production build passes; all four React page routes and every bundled font, SVG, stylesheet and script return HTTP 200 from the Python server. Compiled CSS includes Walla, Bitcount Single and the verified brand tokens. Browser visual review was unavailable because the browser access host was not running.
- `npm.cmd ci` installs frontend dependencies; `npm.cmd run build` type-checks and writes the production bundle to `mission_control/web/app`. The Python server serves that bundle. For development, use the API server on port 8781 and Vite's configured proxies.
- The earlier experiment handoff below is historical context from another checkout. Confirm job/data state locally before acting on its running-job notes. This Overview task does not launch simulations or training.
- Validation: production build and local HTTP response passed; the desktop Overview and methodology jump link were reviewed in Chrome. Further browser interaction and responsive checks were stopped by the user with Escape.

---

# Handoff: difficulty ladder + two fine-tunes (Sun 22 Nov, ~04:10)

Branch `worktree-ui-redesign` (pushed). Worktree: `hackathon_dreamlab/.claude/worktrees/ui-redesign`.
Python: `C:\Users\PranavPrakashMenon\dream-env\Scripts\python.exe` (dreamlabs 1.0.42). Run commands from the worktree root.
Windows: prefix report commands with `PYTHONIOENCODING=utf-8`.

## The experiment

Four versions of the robot, on the same held-out seeds, four difficulty levels, clean mode:

| Version | What |
|---|---|
| A stock | Dream-1 base, 48 rows/reply (SDK default) |
| B tuned | Dream-1 base, 24 rows/reply (setting the harness found) |
| C1 naive | fine-tuned on 60 teacher demos from arbitrary training seeds (20 per level) |
| C2 harness | fine-tuned on 60 episodes chosen by the harness: teacher replays of the starts where base Dream-1 failed (allocated by failure count per level) + Dream-1's own quality-passing successes |

Levels: L1 orange→bowl (60 s), L2 orange→bowl then banana→plate, one instruction (120 s), L3 three-block stack (150 s), L4 Hanoi (420 s, test only).
Seeds: training 1000–1999 (profile 1000–1029, C1 teacher 1100–1119), held-out evaluation 2000–2019 (Hanoi 2000–2009). Start variation ±2 cm.

**No cheats:** assists, supervisors, retry prompts, Hanoi stepwise mode are never used. The console's two-step task no longer switches instructions when the simulator confirms a step (that was a hidden cheat). Every result row has `steering` and `clean`; the scripted teacher is always marked steered and is only a demo source.

## Done
- Clean mode (`mission_control/execution.py`, `plans.py` v2, `detectors.SequenceTracker.step_details`).
- `mission_control/ladder.py`: `run` (parallel, interleaved, episodes, MP4, connection retries, DA-1000 stop), `report` (Wilson CI, progress, failure labels, stage timing, $/success, McNemar pairs, per seed → `report.md` + `summary.json`), `export` (validated LeRobot), `train` (upload → wait processed → finetune cosine; state in `dreameval/.mission-control/ladder/jobs/<suffix>.json`).
- `mission_control/recipes.py`: `naive`, `harness`, `hard-seeds`.
- Console Ladder tab (scorecards, matched comparisons, seed grid, synced side-by-side video). `python -m mission_control --port 8766`.
- Runner: 40 fps MP4 recording, network retry, training cameras on even rows only.
- Embodiment registered on Dream Labs: `kar.anchan02/yam-sim` (free).
- **C1 teacher demos: 60/60 succeeded** → `dreameval/.mission-control/ladder/c1-teacher/`.

## Running when this was written
`ladder run profile --levels L1 L2 L3 --arms tuned --seeds 1000-1029 --workers 3 --episodes` (base Dream-1 on training seeds). 44/90 done. Rerunning the same command resumes; finished trials are kept.

Partial profile (clean, 24 rows, training seeds):

| Level | Passed | Main failures | Stage reached (first step) |
|---|---|---|---|
| L1 orange | 13/16 (81%, CI 57–93) | touched_no_lift 1, lifted_missed_goal 1, fell_off_table 1 | lift 14/16, settle 13/16 |
| L2 two-step | 2/14 (14%, CI 4–40), mean progress 25% | **touched_no_lift 8**, partial 3, wrong_object 1 | lift only 5/14 |
| L3 stack | 5/14 (36%, CI 16–61), progress 39% | lifted_missed_goal 4, touched_no_lift 3, wrong_order 1 | settle 6/14 |

44 trials, 3,295 calls, ≈ $4.39. Grasping (touched, never lifted) dominates L2; placement dominates L3. This failure profile drives C2's data mix.

## Next steps (in order)
1. **Launch C1 now** (critical path; training takes 7–8 h, can't be cancelled):
   ```
   python -m mission_control.recipes naive c1.json --collection c1-teacher --per-level 20
   python -m mission_control.ladder export <dir>/c1-naive-ds --manifest c1.json --held-out 2000-2019
   python -m mission_control.ladder train c1-naive --dataset <dir>/c1-naive-ds --steps 1000
   ```
   Steps: pick what fits ≈ $500 at the per-step price (ask organizers; 1000 is the default). Rerun `ladder train c1-naive` to poll status.
2. When the profile finishes: `python -m mission_control.recipes hard-seeds` → run the teacher on those seeds:
   `ladder run c2-teacher --levels L1 L2 L3 --arms teacher --seeds <failed seeds> --workers 4 --episodes`
   (seeds are per level; running all levels on the union is fine, the recipe picks the right ones).
3. `recipes harness c2.json --profile profile --teacher c2-teacher --total 60` → export → `ladder train c2-harness --dataset … --steps <same as C1>`.
4. Meanwhile, evaluation of A and B on held-out seeds with video:
   `ladder run eval --levels L1 L2 L3 --arms stock tuned --seeds 2000-2019 --workers 4 --video`
   `ladder run eval --levels L4 --arms stock tuned --seeds 2000-2009 --workers 2 --video`
5. When checkpoints land (`ladder train c1-naive` shows `fine_tuned_model`):
   `ladder run eval --levels L1 L2 L3 L4 --arms "ft:naive=<id>" "ft:harness=<id>" --seeds … --video`
   plus a drift check: rerun `tuned` on 10 of the same seeds in the same session (use a new name, e.g. `eval-drift`).
6. `ladder report eval` → Ladder tab → side-by-side video for the demo.

## Open points
- Fine-tune price per step is unknown (no SDK quote without charging); account has credits.
- Does Dream Labs accept simulator/scripted data? Not confirmed.
- The fine-tuned model needs the console's model allow-list extended to run from the Run-a-task form (the ladder CLI already accepts `ft:<label>=<checkpoint>`).
- Recovery demos (restore the failure state, teacher shows the fix) were not built; C2 uses hard-case replays + self-successes.
- Deadline: submit 16:30 today; code freeze planned 13:00.
