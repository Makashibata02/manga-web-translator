import json,time,threading
from pathlib import Path
import psutil
from engine.vision import Vision
ROOT=Path(__file__).resolve().parents[1]
vision=Vision(ROOT/"models"); work=ROOT/".local/vision-smoke";peak=[0];stop=threading.Event()
def monitor():
    while not stop.wait(.1):peak[0]=max(peak[0],psutil.Process().memory_info().rss)
threading.Thread(target=monitor,daemon=True).start()
start=time.monotonic()
try:
    regions=vision.detect(ROOT/".local/fixtures/japanese.png",work)
    elapsed=time.monotonic()-start
    expected=["你好。今天天气真好。","这是测试。数字是12。请不要去。"]
    for r,text in zip(regions,expected):r["translation"]=text
    output=vision.render(ROOT/".local/fixtures/japanese.png",work,regions)
    print(json.dumps({"seconds":round(elapsed,2),"peak_mb":round(peak[0]/1024**2),"regions":regions,"output":str(output)},ensure_ascii=False))
finally:stop.set()
