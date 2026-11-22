# Engineering audit

**Baseline.** The original `main` commit is [ea2a2f5](https://github.com/Sridhar-Kandi/hackathon_dreamlab/commit/ea2a2f5d84851a3feb51a73051295f4ac0adbc9d). Its 25 result files contain 654 historical attempts, including 15 error rows. Some later attempts repeat an earlier configuration and seed. The archive also includes seven animated showcase clips and three fruit-task contact sheets.

**Requirements.** The [handoff](../README.md) contains the organizer Q&A on repeated trials, diagnosis, interruptions, cameras and collecting demonstrations. The [outgoing draft](../dreameval/notes/dreamlabs_message.md) records findings and asks Dream Labs three questions. No separate incoming supervisor reply, slides, or amended deadline appears in the original tracked files. The handoff names Python 3.13 and dreamlabs 1.0.42. It contains install instructions, with no dependency lockfile.

| Component | Reuse and risk |
| --- | --- |
| `dreameval/runner.py`, `scenes.py` | Keep the existing policy, observations, simulator and headless recording path. A simulation row represents 50 ms. The original worker calls the provider directly and lacks per-request spending controls. |
| `detectors.py`, `hanoi.py`, `bimanual.py` | Surface measured contact, lift, settle, order, and coordination where available. Eye gaze, intention, grasp closure and transport are not independently measured by the simple tracker. Sequence trackers can report the currently active object as the target. |
| `sweep.py`, `paired.py`, `report.py` | Reuse Wilson intervals and exact McNemar logic. The original paired CLI keys on seed and mode alone. On a mixed-configuration run this can overwrite distinct prompts or action settings. Restrict a comparison to one group per side and one terminal valid record per seed. |
| `runs/`, `showcase/` | Load JSONL without importing the simulator. Old recording paths can be absolute on a teammate’s machine. Some original reports contain broken media links because full-size trial recordings were excluded. Use verified local assets. |
| `oracle.py`, `assist.py`, `probe_*.py` | Keep scripted demonstrations, privileged assistance and one-off probes separate from baseline results. Existing GIFs and diagnostic traces omit fields required for an aligned LeRobot training dataset. |

**Local baseline checks.** The original sweep summary reproduced all four `orange_confirm` groups. The paired CLI reproduced 1/15 plain versus 8/15 assisted in `place_banana`. Pillow decoded all seven GIFs. Their embedded verdicts, prompts, seeds, lift heights and final bowl distances were checked against result rows. Two fruit strips have different lift heights from similarly named JSONL attempts. Present these contact sheets as separate recordings. A scan of tracked text for assigned Dream keys, bearer credentials and private-key headers found no matches.

**Implementation order.** (1) Index the existing runs by full configuration and seed. (2) Connect task setup, trial inspection and matched comparison. (3) Gate new requests on offline preflight, explicit live access and checked spending. (4) Rehearse using local evidence. At audit time the local interpreter had no Dream SDK or MuJoCo. Historical playback and analysis were verified independently of simulation. A paid run, account balance and credit conversion require separate verification.
