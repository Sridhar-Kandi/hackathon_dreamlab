# Simulation and spending

Browsing recorded runs needs only Python. Launching a simulation requires the checkout's `dreameval/` and the Dream YAM simulator. Use the Python interpreter with the team's documented `dreamlabs==1.0.42`, MuJoCo, NumPy and Pillow installation. Set `DREAMEVAL_DIR` if the engine lives outside this checkout. Run on loopback in one dashboard process.

## Local preflight

Select a task and use **Check readiness**. Its registry entry fixes the scene, target and goal. The preflight checks dependencies, writable storage, both seven-value arm states and three JPEG windows rendered with the official YAM observation builder. The mapping is top → overhead, left → wrist_l, right → wrist_r. Stationary frames can be identical. This probe neither checks remote model access nor measures physical camera freshness.

The scripted oracle is an explicit model choice for checking the simulator without hosted inference. It reads simulator object positions. Only runs labelled `dreamlabs/dream-1-beta` evaluate Dream-1.

## Credit authorization

Keep live access disabled until the team has spending authorization and account-specific terms from Dream Labs. The [published price](https://dreamlabs.ai/research/dream-1/) supports a historical estimate of $3 per 2,250 Dream-1 replies. The repository's USD estimate cannot determine the hackathon credit debit. No training endpoint is exposed.

After obtaining a provider-confirmed upper bound, the operator may set `MISSION_CONTROL_LIVE=1` and `MISSION_CONTROL_QUOTE` to a private local JSON file **outside the repository**. Without both, launching the base model stops in preflight. Supply these fields from the actual terms:

| Field | Meaning |
|---|---|
| `model`, `currency` | Exact strings `dreamlabs/dream-1-beta` and `hackathon_testing_credits` |
| `max_credits_per_sdk_call` | Confirmed maximum debit for one SDK action call including internal retries or ambiguous failures, in credits |
| `available_testing_credits` | Total verified allowance dedicated to this installation across its lifetime, capped at 120. Account for any team spending elsewhere. |
| `other_sdk_operations_free`, `includes_sdk_retries` | Both must be true under the provider's terms |
| `provider_reference`, `expires_at` | Reference for the account-specific pricing confirmation and its expiration as an ISO 8601 timestamp with timezone |

The operator supplies this confirmation. Mission Control cannot check a remote balance or independently authenticate the quote. Use the hidden `--prompt-key` input, the official SDK environment variable or a supported local credential file. Keep the application bound to loopback. The browser has no settings for prices, credentials or live authorization.

Before launch, the request cap times the selected trial count must fit the verified estimate. Before each attempted action request, a transaction in `dreameval/.mission-control/spend.sqlite3` debits the confirmed upper bound. Failed or interrupted requests keep their debits. Preserve this ledger across restarts and releases. The worker enforces the 120-credit testing ceiling, the smaller verified account allowance when applicable, the selected 8/20/36/8/12/36 allocation, and the experiment's credit and estimated USD caps. All 1,000 training credits are tracked separately. Direct runner and sweep commands operate outside the application ledger.

## Interruption and recordings

The coordinator runs one child process per trial. Cancel stops the child at the next action boundary, with an eight-second teardown deadline. An in-flight request may still be billed. Closing the dashboard server stops the worker. Closing a browser tab leaves the server running. Resume retries interrupted or errored slots from their original seeds. Cloning is available after cancellation. Runs are written under `dreameval/.mission-control/runs/mc-*/`. The coordinator owns `config.json`, `status.json` and `results.jsonl`. Attempt folders hold events, heartbeat and raw episode data. Verified grades are retained across restarts.

The optional single-trial CLI flag `--max-usd` caps estimated spending on attempted action requests. First response time is measured from the first request dispatch to the first validated reply. P95 requires at least 20 successful replies. Historical records have different measurement coverage.

## Prepare a fine-tuning dataset

Enable **Save synchronized training samples** before reviewing a compound plan. The recorder stores a pre-action observation and the executed joint and gripper row at 20 Hz. It records three camera views and the active instruction with each sample. Scripted and Dream-1 episodes carry distinct provenance. The Datasets page reports local candidate eligibility.

Install the Dream Labs client with its datasets extra in the simulator environment. The exporter uses Pillow, PyArrow and PyAV with libx264. Local recording stays at 20 Hz. Export takes every other synchronized observation and action pair at 10 Hz, a rate the Dream Labs validator accepts for resampling during training.

```powershell
python -m mission_control.datasets list
python -m mission_control.datasets export <new-directory> --episode <verified-episode-id> --held-out-seed <seed>
python -m mission_control.datasets validate <new-directory>
```

Repeat `--episode` and `--held-out-seed` for multiple values. The exporter rejects failed, incomplete, or held-out episodes. Review the clips and provenance before selecting candidates. Run the validator using the official Dream Labs client with dataset dependencies. If the simulator and validator require different Python versions, use separate environments and the same dataset directory. The [Dream Labs client documentation](https://pypi.org/project/dreamlabs-client/#datasets) documents LeRobot v2.1 and its YAM embodiment mapping.

**Datasets** prepares and validates selected episodes locally. Start the console with `--prompt-key` or use the SDK credentials file when you are ready to upload. Enter the account's existing YAM embodiment name, upload, then refresh until Dream Labs marks the dataset processed. Review the price for the selected step count before enabling **Start fine-tuning**. The console saves the dataset ID, job ID and checkpoint under the local results directory. If a submission's outcome is unclear, refresh to reconcile the existing job. Compare a finished checkpoint with the base model on reserved starts before reporting its results. [Dream Labs fine-tuning workflow](https://pypi.org/project/dreamlabs-client/#fine-tuning)
