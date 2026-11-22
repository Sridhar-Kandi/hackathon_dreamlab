"""Harness settings.

`HarnessSettings` holds the library-wide defaults as static (class) attributes. A program that imports the
library can change them once at start-up, and every harness built afterwards picks the new values up:

    from dream_harness import HarnessSettings
    HarnessSettings.REPLAY_BUFFER_S = 2.0
    HarnessSettings.override(STALL_S=6.0, NEAR_ROWS=8)

`HarnessConfig` is the per-run copy. `HarnessConfig.from_dict({...})` starts from the current static defaults,
applies the given overrides and checks every value against its allowed range.
"""

from dataclasses import asdict, dataclass, field

# The Spotter modules, in the order the console lists them.
MODULES = (
    "reconnect",         # keep retrying dropped connections, expired sessions and a full model pool
    "clamp_gripper",     # clip small gripper overshoots (e.g. 1.05) instead of failing the reply
    "wrong_object",      # home and re-prompt after the arm grabs an object that is not the target
    "grasp_retry",       # home and re-prompt after a stalled grasp or a dropped object
    "grasp_depth",       # regrasp lower when the gripper closes above the object's top face
    "edge_pinch",        # regrasp when the fingers pinch an edge instead of the faces
    "backtrack",         # on a stalled grasp, replay the replay buffer in reverse and restart the session
    "place",             # centre the carried object over its goal before release
    "adaptive_chunking", # execute only the first rows of each reply while close to the object
)

# Modules that read simulator ground truth to steer the robot. Runs that use them are marked as steered.
STEERING_MODULES = ("wrong_object", "grasp_retry", "grasp_depth", "edge_pinch", "backtrack", "place",
                    "adaptive_chunking")

ASSIST_PART = {"grasp_depth": "depth", "edge_pinch": "width", "backtrack": "backtrack", "place": "place",
               "adaptive_chunking": "adaptive"}
WATCH = {"wrong_object": "wrong_object", "grasp_retry": "grasp"}


class HarnessSettings:
    """Library-wide defaults. Change them directly or with `override`; new configs copy the current values."""

    CONTROL_HZ = 20                 # simulator control rows per second
    REPLAY_BUFFER_S = 1.5           # seconds of commanded motion kept for the backtrack replay
    REPLAY_BUFFER_MAX_ROWS = 200    # hard upper bound on the replay buffer, whatever the seconds say
    NEAR_ROWS = 12                  # rows executed per reply while near the object (adaptive chunking)
    NEAR_RADIUS_M = 0.07            # gripper-to-object distance that counts as "near"
    STALL_S = 8.0                   # touching the object this long without lifting it is a stalled grasp
    DROP_S = 2.0                    # a lifted object resting untouched this long counts as dropped
    HIGH_M = 0.005                  # closing with the fingertips this far above the top face triggers a regrasp
    MAX_REGRASPS = 3                # regrasps allowed per object
    HOVER_S = 1.5                   # carrying still over the goal this long triggers a placement
    GRIPPER_SLACK = 0.2             # how far outside 0..1 a gripper value may be and still be clipped
    MAX_SUPERVISOR_RETRIES = 2      # home-and-retry interventions allowed per trial
    HOME_SECONDS = 2.0              # time to drive the arms home before a retry
    WRONG_OBJECT_LIFT_M = 0.015     # a non-target object lifted this much counts as grabbed
    WRONG_OBJECT_SLIDE_M = 0.03     # ... or slid this far while an arm touches it
    SESSION_RESTARTS = 3            # expired sessions reopened in a row
    CAPACITY_WAITS = 8              # waits for a full model pool before giving up
    NETWORK_RETRIES = 5             # dropped connections retried per trial
    RETRY_PROMPT = ""               # instruction used after a retry; empty keeps the original

    @classmethod
    def override(cls, **values):
        """Change several defaults at once. Unknown names raise, so a typo cannot pass silently."""
        for name, value in values.items():
            if name not in LIMITS:
                raise AttributeError(f"Unknown harness setting: {name}")
            setattr(cls, name, value)

    @classmethod
    def snapshot(cls):
        return {name: getattr(cls, name) for name in LIMITS}


# name -> (type, low, high). Strings have no range.
LIMITS = {
    "CONTROL_HZ": (int, 1, 100),
    "REPLAY_BUFFER_S": (float, 0.1, 10.0),
    "REPLAY_BUFFER_MAX_ROWS": (int, 1, 2000),
    "NEAR_ROWS": (int, 1, 48),
    "NEAR_RADIUS_M": (float, 0.01, 0.3),
    "STALL_S": (float, 1.0, 60.0),
    "DROP_S": (float, 0.5, 20.0),
    "HIGH_M": (float, 0.0, 0.05),
    "MAX_REGRASPS": (int, 0, 10),
    "HOVER_S": (float, 0.2, 10.0),
    "GRIPPER_SLACK": (float, 0.0, 1.0),
    "MAX_SUPERVISOR_RETRIES": (int, 0, 10),
    "HOME_SECONDS": (float, 0.5, 10.0),
    "WRONG_OBJECT_LIFT_M": (float, 0.001, 0.2),
    "WRONG_OBJECT_SLIDE_M": (float, 0.001, 0.3),
    "SESSION_RESTARTS": (int, 0, 10),
    "CAPACITY_WAITS": (int, 0, 20),
    "NETWORK_RETRIES": (int, 0, 20),
    "RETRY_PROMPT": (str, None, None),
}


def _check(name, value):
    kind, low, high = LIMITS[name]
    if kind is str:
        if not isinstance(value, str) or len(value) > 400 or not value.isprintable():
            raise ValueError(f"{name} must be a single line of at most 400 characters.")
        return value.strip()
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number.")
    if kind is int and int(value) != value:
        raise ValueError(f"{name} must be a whole number.")
    if not low <= value <= high:
        raise ValueError(f"{name} must be between {low} and {high}.")
    return kind(value)


@dataclass
class HarnessConfig:
    """One run's harness: which modules are on, plus every tunable value."""

    modules: list = field(default_factory=list)
    values: dict = field(default_factory=HarnessSettings.snapshot)

    @classmethod
    def from_dict(cls, data=None):
        data = data or {}
        modules = data.get("modules", [])
        if not isinstance(modules, list) or any(name not in MODULES for name in modules):
            raise ValueError("Choose harness modules from: " + ", ".join(MODULES))
        values = HarnessSettings.snapshot()
        overrides = data.get("values", {})
        if not isinstance(overrides, dict):
            raise ValueError("Harness values must be an object.")
        for name, value in overrides.items():
            if name not in LIMITS:
                raise ValueError(f"Unknown harness setting: {name}")
            values[name] = _check(name, value)
        return cls(modules=[name for name in MODULES if name in modules], values=values)

    def to_dict(self):
        return asdict(self)

    def __getattr__(self, name):
        # Lets callers write config.STALL_S instead of config.values["STALL_S"].
        values = self.__dict__.get("values", {})
        if name in values:
            return values[name]
        raise AttributeError(name)

    @property
    def replay_rows(self):
        return max(1, min(self.REPLAY_BUFFER_MAX_ROWS, round(self.REPLAY_BUFFER_S * self.CONTROL_HZ)))

    @property
    def assist_parts(self):
        return [ASSIST_PART[name] for name in self.modules if name in ASSIST_PART]

    @property
    def watches(self):
        return [WATCH[name] for name in self.modules if name in WATCH]

    @property
    def recover(self):
        return "reconnect" in self.modules

    @property
    def clamp_gripper(self):
        return "clamp_gripper" in self.modules

    @property
    def steering(self):
        return [name for name in self.modules if name in STEERING_MODULES]


def describe():
    """Setting names, defaults and ranges, for a settings form."""
    out = []
    for item in LIMITS:
        kind, low, high = LIMITS[item]
        out.append({"name": item, "default": getattr(HarnessSettings, item), "type": kind.__name__,
                    "min": low, "max": high})
    return out
