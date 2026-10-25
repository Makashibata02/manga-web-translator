"""Controlled text adapter comparison. Timing excludes browser/OCR and uses a mock provider."""
import json,time,tempfile
from pathlib import Path
from engine.store import Store
from engine.translate import Translator
root=Path(__file__).resolve().parents[1]
class Provider:
 def __init__(self):self.calls=0
 def translate(self,texts,source,target):self.calls+=1;time.sleep(.02);return ["译"+s for s in texts]
def run(batch_size):
 s=Store(Path(tempfile.mkdtemp(prefix="mwt-benchmark-")));b=s.create({"chapter_id":"100","source":"auto"},{"id":"test","provider":"tencent"});t=Translator(s);p=Provider();t.free["tencent"]=p
 texts={str(i):"This is paragraph number "+str(i)+". Do not change 12." for i in range(100)}
 start=time.monotonic();first=None;screen=None
 for offset in range(0,100,batch_size):
  t.translate(b,{str(i):texts[str(i)] for i in range(offset,min(100,offset+batch_size))})
  if first is None:first=time.monotonic()-start
  if screen is None and offset+batch_size>=8:screen=time.monotonic()-start
 return {"requests":p.calls,"first_ms":round(first*1000),"first_8_blocks_ms":round(screen*1000),"total_ms":round((time.monotonic()-start)*1000)}
report={"controlled_mock":True,"paragraphs":100,"old_per_node":run(1),"new_batches":run(8)}
assert report["old_per_node"]["requests"]==100 and report["new_batches"]["requests"]==13
(root/".local/text-benchmark.json").write_text(json.dumps(report,indent=2),encoding="utf8");print(json.dumps(report))
