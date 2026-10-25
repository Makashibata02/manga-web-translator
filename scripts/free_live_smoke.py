import json,time
from pathlib import Path
from engine.free import FreeProvider
root=Path(__file__).resolve().parents[1];out=[]
samples=[("en","Hello. Do not change the number 12."),("ja","今日はいい天気です。行かないで。"),("ja","私は学校に行きます。")]
for name in ("tencent","bing"):
 p=FreeProvider(name)
 for source,text in samples:
  start=time.monotonic()
  try:
   values=p.translate([text],source,"zh-CN");out.append({"provider":name,"source":source,"input":text,"translation":values,"seconds":round(time.monotonic()-start,2)})
  except Exception as e:out.append({"provider":name,"source":source,"error":str(e)});break
(root/".local/free-live-report.json").write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding="utf8")
print(json.dumps(out,ensure_ascii=False))
