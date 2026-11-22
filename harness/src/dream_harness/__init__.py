"""dream_harness: the Spotter harness around Dream-1 on the Dream YAM simulator.

Modules can be switched on one by one (see MODULES). Every tunable value lives in HarnessSettings as a static
default; change it there for the whole program, or pass a HarnessConfig for a single run.
"""

from .assist import Assist
from .buffer import ReplayBuffer
from .gripper import clamp_gripper
from .kinematics import ArmIK, smooth
from .recovery import RetryPolicy, open_waits
from .settings import LIMITS, MODULES, STEERING_MODULES, HarnessConfig, HarnessSettings, describe
from .watches import GraspWatch, WrongObjectWatch, build_watches

__version__ = "0.1.0"

__all__ = ["Assist", "ArmIK", "GraspWatch", "HarnessConfig", "HarnessSettings", "LIMITS", "MODULES",
           "ReplayBuffer", "RetryPolicy", "STEERING_MODULES", "WrongObjectWatch", "build_watches",
           "clamp_gripper", "describe", "open_waits", "smooth"]
