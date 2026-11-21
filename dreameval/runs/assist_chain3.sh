cd "C:/Users/PranavPrakashMenon/Desktop/Berlin HackLab/dreameval"
PY="C:/Users/PranavPrakashMenon/dream-env/Scripts/python.exe"
$PY sweep.py run --name assist_stack3 --scene blocks3 --prompt "put the red block on the yellow block, then put the blue block on the red block" --target red_block --goal on:yellow_block --sequence red_block:on:yellow_block,blue_block:on:red_block --actions 24 --sim-seconds 150 --trials 20 --seed0 300 --modes plain assist_place --max-retries 3 --workers 3 --record > runs/assist_stack3_ext.log 2>&1 &
$PY sweep.py run --name place_orange --prompt "put orange into bowl" --target orange --goal inside_bowl --actions 24 --sim-seconds 60 --trials 15 --seed0 100 --modes plain assist_place place_only --max-retries 3 --workers 3 --record > runs/place_orange.log 2>&1 &
$PY sweep.py run --name place_banana --prompt "put banana on plate" --target banana --goal on_plate --actions 24 --sim-seconds 60 --trials 15 --seed0 100 --modes plain assist_place place_only --max-retries 3 --workers 3 --record > runs/place_banana.log 2>&1 &
wait
