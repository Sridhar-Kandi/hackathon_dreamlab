"""Translate supported stock-scene instructions into a versioned, reviewable plan."""

import hashlib
import json
import re


COMPOUND = "orange-banana"
DEFAULT_INSTRUCTION = "Put the orange into the bowl, then put the banana onto the plate."
GOALS = {
    "orange-bowl": (
        r"(?:put |place )?(?:the )?orange (?:in|into|inside) (?:the )?bowl",
        "Put the orange into the bowl.", "orange", "inside_bowl",
        "Orange inside the bowl, clear of both arms and moving below 3 cm/s for 1 second.",
    ),
    "banana-plate": (
        r"(?:put |place )?(?:the )?banana (?:on|onto) (?:the )?plate",
        "Put the banana onto the plate.", "banana", "on_plate",
        "Banana within the plate's placement region, clear of both arms and moving below 3 cm/s for 1 second.",
    ),
}


class InvalidPlan(ValueError):
    def __init__(self, message, field="instruction"):
        super().__init__(message)
        self.field = field


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def review(config, preset):
    instruction = config["instruction"]
    supported = config["task_id"]
    if supported == COMPOUND:
        goal_ids = ("orange-bowl", "banana-plate")
    elif supported in GOALS:
        goal_ids = (supported,)
    else:
        if instruction != preset["instruction"]:
            raise InvalidPlan("Use the registered instruction for this preset.")
        goal_ids = ()
    steps = []
    if goal_ids:
        clauses = re.split(r"\s*[,;]?\s+then\s+", " ".join(instruction.lower().rstrip(".").split()))
        if len(clauses) != len(goal_ids):
            raise InvalidPlan(f"Expected {len(goal_ids)} ordered placement steps. Example: {preset['instruction']}")
        for index, (clause, goal_id) in enumerate(zip(clauses, goal_ids), 1):
            pattern, prompt, target, goal, criterion = GOALS[goal_id]
            if not re.fullmatch(pattern, clause):
                raise InvalidPlan(f"Step {index} must match the registered goal. Example: {prompt}")
            steps.append(dict(id=goal_id, instruction=prompt, target=target, goal=goal,
                              criterion=criterion, max_rows=round(config["sim_seconds"] * 20) // len(goal_ids)))
    else:
        steps.append(dict(id=supported, instruction=instruction, target=preset["target"], goal=preset["goal"],
                          criterion="The registered scene grader verifies the preset's final objective.",
                          max_rows=round(config["sim_seconds"] * 20)))
    plan = dict(version=1, instruction=instruction, steps=steps,
                final_checks=[step["id"] for step in steps])
    return {**plan, "hash": digest({"plan": plan, "config": config})}
