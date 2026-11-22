# dream-harness

The Spotter harness as a standalone library. `dreameval` and `mission_control` use it through the built wheel
in `../wheels/`, not through these source files.

## Build and install

```
python -m pip wheel ./harness --no-deps -w ./wheels
python -m pip install --force-reinstall ./wheels/dream_harness-0.1.0-py3-none-any.whl
```

Rebuild and reinstall the wheel after changing anything under `src/`.

## Override settings

Every tunable value is a static attribute on `HarnessSettings`. Change it once at start-up and every harness
built afterwards uses it:

```python
from dream_harness import HarnessSettings, HarnessConfig

HarnessSettings.REPLAY_BUFFER_S = 2.0           # one value
HarnessSettings.override(STALL_S=6, NEAR_ROWS=8)  # several, with name checking

config = HarnessConfig.from_dict({"modules": ["reconnect", "backtrack"], "values": {"MAX_REGRASPS": 2}})
config.replay_rows  # replay buffer size in control rows
```

`HarnessConfig.from_dict` starts from the current static defaults, then applies the per-run values and checks
each one against `LIMITS`.

## Modules

| Module | What it does |
| --- | --- |
| reconnect | retries expired sessions, a full model pool and dropped connections |
| clamp_gripper | clips small gripper overshoots instead of failing the reply |
| wrong_object | homes and re-prompts after a non-target grab |
| grasp_retry | homes and re-prompts after a stalled grasp or a drop |
| grasp_depth | regrasps lower when the gripper closes above the object |
| edge_pinch | regrasps when the fingers pinch an edge |
| backtrack | replays the replay buffer in reverse after a stalled grasp |
| place | centres the carried object over the goal before release |
| adaptive_chunking | runs only NEAR_ROWS rows per reply near the object |

All modules except reconnect and clamp_gripper read simulator ground truth, so runs using them are reported as
steered.
