"""Grasp forensics: run plain Dream-1 trials with a per-row trace (gripper command/opening, tcp vs block) and
classify each touched-but-not-lifted episode by mechanism."""
import json, sys, warnings
warnings.filterwarnings("ignore")
from concurrent.futures import ProcessPoolExecutor
import numpy as np

TASK, TARGET, GOAL = "put the red block on the blue block", "red_block", "on:blue_block"

def one(seed):
    import runner, scenes
    env = scenes.make_env("blocks2")
    r = runner.run_trial(env, task=TASK, target=TARGET, goal=GOAL,
                         actions=24, sim_seconds=60, seed=seed, jitter_cm=2, trace=True, scene="blocks2")
    env.close()
    return r

if __name__ == "__main__":
    seeds = [int(x) for x in sys.argv[1:]] or list(range(314, 319))
    with ProcessPoolExecutor(4) as pool:
        rs = list(pool.map(one, seeds))
    with open("runs/probe_grasp.jsonl", "a") as f:
        for r in rs:
            f.write(json.dumps(r) + "\n")
    for r in rs:
        print(r["seed"], r["outcome"], r["calls"])
