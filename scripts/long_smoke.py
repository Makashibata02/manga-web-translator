import json,time,threading
from pathlib import Path
import psutil
from engine.vision import Vision
R=Path(__file__).resolve().parents[1]
v=Vision(R/"models");start=time.monotonic();peak=[0];end=threading.Event()
def monitor():
 while not end.wait(.15):peak[0]=max(peak[0],psutil.Process().memory_info().rss)
threading.Thread(target=monitor,daemon=True).start()
try:
 regions=v.detect(R/".local/fixtures/long.png",R/".local/long-smoke")
 result={"height":20000,"regions":len(regions),"seconds":round(time.monotonic()-start,2),"peak_mb":round(peak[0]/1024**2),"texts":[r["source"] for r in regions]}
 (R/".local/long-smoke/result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf8")
 print(json.dumps(result,ensure_ascii=False))
finally:end.set()
