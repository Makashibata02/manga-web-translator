from pathlib import Path
import time,re,json
import uvicorn
from engine.server import create_app
ROOT=Path(__file__).resolve().parents[1]
app=create_app(ROOT/".local/ui-v011",models=ROOT/"models",token="ui-test-placeholder",extension_id=(ROOT/"build/extension-id.txt").read_text().strip(),test_mode=True)
app.state.store.put("profile","mock",{"id":"mock","name":"模拟模型","provider":"mock","test_only":True})
class FakeFree:
 def __init__(self):self.calls=[]
 def translate(self,texts,source,target):
  self.calls.append({"texts":texts,"source":source,"target":target,"time":time.monotonic()});time.sleep(.18)
  return ["用于验证排版的中文译文："+(" ".join(re.findall(r"\d+",s)) or "保持原页面布局。")+" "+("" if "Broken marker fixture" in s else " ".join(re.sub(r"(MWTX*)(\d+)",r"\1 \2",m) for m in re.findall(r"\[MWTX*\d+\]",s))) for s in texts]
fake=FakeFree();app.state.runner.translator.free["tencent"]=fake
@app.get("/v1/testing")
def report():return {"calls":fake.calls,"detector_loaded":app.state.runner.vision.detector is not None}
uvicorn.run(app,host="127.0.0.1",port=18768,access_log=False)
