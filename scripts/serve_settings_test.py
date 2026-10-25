"""Isolated settings acceptance: in-memory fake credentials and no upstream network."""
import json,uuid
from pathlib import Path
import httpx,uvicorn
import engine.server as server
from engine.translate import Translator
ROOT=Path(__file__).resolve().parents[1]
keys={};calls=[]
def save(id,key):
 if not key.startswith("owned-"):raise ValueError("Only owned test placeholders are accepted")
 keys[id]=key
server.save_key=save
app=server.create_app(ROOT/(".local/settings-acceptance-"+uuid.uuid4().hex),token="owned-settings-placeholder",extension_id=(ROOT/"build/extension-id.txt").read_text().strip(),run=False,test_mode=True)
def respond(request):
 body=json.loads(request.content);payload=json.loads(body["messages"][1]["content"]);calls.append({"model":body["model"],"url":str(request.url)})
 return httpx.Response(200,json={"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120},"choices":[{"finish_reason":"stop","message":{"content":json.dumps({k:"连接测试成功，保留数字12。" for k in payload["blocks"]},ensure_ascii=False)}}]})
app.state.runner.translator=Translator(app.state.store,key_reader=lambda id:keys[id],transport=httpx.MockTransport(respond))
@app.get("/v1/testing")
def testing():return {"calls":calls,"key_saves":len(keys),"requests":len(app.state.store.all("request")),"detector_loaded":app.state.runner.vision.detector is not None}
if __name__=="__main__":uvicorn.run(app,host="127.0.0.1",port=18770,access_log=False)
