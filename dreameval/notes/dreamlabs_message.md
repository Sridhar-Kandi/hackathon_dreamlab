Hi Dream Labs team, two findings from our hackathon evaluation tool on Dream YAM Sim (dream-1-beta, 40 s simulated,
object start randomised ±2 cm, success graded from MuJoCo ground truth and spot-checked on recordings):

**1. Rows executed per reply matters a lot for "put orange into the bowl".**
Same 20 seeded start states per setting:

| rows/reply | 16 | 24 | 32 | 48 (default) |
|---|---|---|---|---|
| success | 10/20 | 10/20 | 3/20 | 1/20 |

On a paired comparison over 40 trials, 24 rows beat 48 in 19 trials and lost in 2 (McNemar p = 0.0002).
At 48 the dominant failure is "touched the orange, never lifted it" (13/20), so the grasp seems to need more
frequent re-observation. Prompt wording made no measurable difference.

**2. "put banana on the plate" is 0/40, and the cause is the destination, not the grasp.**
At 24 rows the banana is lifted in 19/20 trials, but 12/20 end with it *in the bowl*; none reach the plate.

Questions:
1. Is 48 rows/reply the recommended default on real stations, or just the sim's starting point?
2. How sensitive is the model to destination wording ("plate" vs "blue plate", etc.)?
3. Roughly how long does a FaaS fine-tune take to turn around?

Side note: reruns of the same seed give similar but not identical outcomes, so we treat inference as non-deterministic.
Happy to share the data and the tool.
