import json
import httpx,pytest
from fastapi.testclient import TestClient
from engine.server import create_app
from engine.store import Store,BudgetStop
from engine.translate import Translator,TranslationError
from engine.free import split_text

def make(store,provider="tencent",**spec):
 return store.create({"chapter_id":"free","source":"ja",**spec},{"id":"free-"+provider,"provider":provider})
def test_free_batch_language_cache_and_no_key(tmp_path):
 calls=[]
 def handler(request):
  data=json.loads(request.content);calls.append(data)
  assert data["source"]["lang"]=="ja" and data["target"]["lang"]=="zh"
  return httpx.Response(200,json={"auto_translation":["译"+t for t in data["source"]["text_list"]]})
 s=Store(tmp_path);b=make(s);t=Translator(s,key_reader=lambda _:pytest.fail("Free read a key"),transport=httpx.MockTransport(handler),free_interval=0)
 blocks={str(i):"こんにちは"+str(i) for i in range(8)}
 assert len(t.translate(b,blocks))==8 and len(calls)==1
 second=make(s,chapter_id="another")
 assert t.translate(second,{"x":blocks["0"]})["x"].startswith("译") and len(calls)==1
 u=s.get("batch",b["id"])["usage"];assert u["tokens"]==u["yuan"]==u["reserved_tokens"]==0
 assert u["characters"]==sum(map(len,blocks.values()))
def test_free_failure_not_unknown_charge_and_limits_persist(tmp_path):
 s=Store(tmp_path);b=make(s,budget={"characters":20,"requests":2});t=Translator(s,transport=httpx.MockTransport(lambda _:httpx.Response(429)),free_interval=0)
 with pytest.raises(TranslationError,match="限流"):t.translate(b,{"0":"hello"})
 saved=s.get("batch",b["id"]);assert saved["state"]=="paused" and saved["usage"]["reserved_yuan"]==0
 assert all(r["state"]=="failed" for r in s.all("request"))
 resumed=Store(tmp_path);assert resumed.get("batch",b["id"])["usage"]["requests"]==1
 resumed.action(b["id"],"resume")
 with pytest.raises(BudgetStop):resumed.reserve(b["id"],"large",0,0,50)
def test_bing_auto_and_split_complete(tmp_path):
 calls=[]
 def handler(request):
  if request.method=="GET":return httpx.Response(200,text='IG:"abc" data-iid="translator.1" params_AbusePreventionHelper = [123,"auth"]')
  calls.append(request.content.decode());return httpx.Response(200,json=[{"translations":[{"text":"中文"}]}])
 s=Store(tmp_path);b=make(s,"bing",source="auto")
 assert Translator(s,transport=httpx.MockTransport(handler),free_interval=0).translate(b,{"0":"Hello"})=={"0":"中文"}
 assert "auto-detect" in calls[0] and "zh-Hans" in calls[0]
 text="これはテストです。"*400
 assert "".join(split_text(text))==text and all(len(x)<=800 for x in split_text(text))
def test_old_youdao_cannot_resume(tmp_path):
 s=Store(tmp_path);b=s.create({"chapter_id":"old"},{"id":"old","provider":"youdao"})
 s.reserve(b["id"],"old-request",12,.01)
 s2=Store(tmp_path)
 with pytest.raises(ValueError,match="移除"):s2.action(b["id"],"resume")
 assert s2.get("batch",b["id"])["usage"]["requests"]==1
def test_key_preserved_by_reference_without_reading(tmp_path,monkeypatch):
 app=create_app(tmp_path,token="test",run=False,test_mode=True)
 app.state.store.put("profile","old",{"id":"old","provider":"openai","model":"old","has_key":True})
 monkeypatch.setattr("engine.server.save_key",lambda *args:pytest.fail("Unexpected key rewrite"))
 with TestClient(app) as c:
  h={"Authorization":"Bearer test"}
  p=c.post("/v1/profiles",headers=h,json={"provider":"openai","existing_id":"old"}).json()
  assert p["credential_id"]=="old" and p["model"]=="deepseek-flash"
  assert c.post("/v1/profiles",headers=h,json={"provider":"youdao","key":"unused"}).status_code==409
def test_ds_known_failure_and_format_failure_are_settled(tmp_path):
 s=Store(tmp_path);p={"id":"fake","provider":"openai","endpoint":"https://api.deepseek.com","model":"deepseek-flash","input_yuan_per_million":2,"output_yuan_per_million":8}
 b=s.create({"chapter_id":"api"},p)
 t=Translator(s,key_reader=lambda _:"test-placeholder",transport=httpx.MockTransport(lambda _:httpx.Response(401)))
 with pytest.raises(TranslationError,match="Key"):t.translate(b,{"0":"Hello"})
 assert s.get("batch",b["id"])["usage"]["reserved_tokens"]==0
 s.action(b["id"],"resume")
 def handler(req):
  assert json.loads(req.content)["thinking"]=={"type":"disabled"}
  return httpx.Response(200,json={"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15},"choices":[{"message":{"content":"Not JSON"},"finish_reason":"stop"}]})
 t=Translator(s,key_reader=lambda _:"test-placeholder",transport=httpx.MockTransport(handler))
 with pytest.raises(TranslationError,match="实际用量"):t.translate(b,{"0":"Hello"})
 u=s.get("batch",b["id"])["usage"];assert u["tokens"]==15 and u["reserved_tokens"]==0 and u["yuan"]>0

def test_bing_credentials_expire_and_failed_response_requires_manual_retry(monkeypatch):
 from engine.free import FreeProvider,FreeError
 clock=[100.0];gets=[];posts=[];broken=[False]
 monkeypatch.setattr('engine.free.time.monotonic',lambda:clock[0])
 def handler(request):
  if request.method=='GET':
   gets.append(1)
   return httpx.Response(200,text='IG:"abc" data-iid="translator.1" params_AbusePreventionHelper = [123,"auth",2000]')
  posts.append(1)
  return httpx.Response(200,json={'statusCode':400} if broken[0] else [{'translations':[{'text':'中文'}]}])
 p=FreeProvider('bing',httpx.MockTransport(handler),interval=0)
 assert p.translate(['Hello'],'auto','zh-CN')==['中文']
 clock[0]+=1
 p.translate(['One'],'auto','zh-CN')
 assert len(gets)==1
 clock[0]+=2
 p.translate(['Two'],'auto','zh-CN')
 assert len(gets)==2
 broken[0]=True
 with pytest.raises(FreeError,match='手动重试'):p.translate(['Three'],'auto','zh-CN')
 assert len(posts)==4 and p.auth is None
 broken[0]=False
 assert p.translate(['Four'],'auto','zh-CN')==['中文']
 assert len(gets)==3 and len(posts)==5
