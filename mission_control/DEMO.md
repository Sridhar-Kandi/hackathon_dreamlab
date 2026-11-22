# YAM Simulation Console walkthrough

Start with `& .\.venv\Scripts\python.exe -m mission_control` and open [the local console](http://127.0.0.1:8765).

1. In **Overview**, explain that the YAM arms first put the orange in the bowl and then put the banana on the plate. Walk through contact, lift and settling in the fresh results table.
2. In **Run log**, open the successful tabletop sequence and inspect seed 0. Show the event list and playback. The scripted simulator verified the orange at 13.15 simulated seconds and the banana at 26.05 seconds.
3. Open the one-second sequence. Show that the orange step timed out at 0.5 seconds. The banana step remained unreached.
4. Show **Datasets**. Two successful sequences each recorded 521 synchronized samples. The exported dataset passed local validation. Explain that upload and job submission are separate actions.

These are scripted MuJoCo runs. A Dream-1 result requires a separately enabled model run.
