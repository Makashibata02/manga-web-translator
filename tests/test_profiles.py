import json
import httpx,pytest
from fastapi.testclient import TestClient
from engine.server import create_app
from engine.store import BudgetStop,UncertainCharge
from engine.translate import Translator
from engine.pricing import cost_rates,configure_pricing

H={"Authorization":"Bearer owned-test"}
def setup(tmp_path,monkeypatch):
 app=create_app(tmp_path,token="owned-test",run=False);saved=[]
 monkeypatch.setattr("engine.server.save_key",lambda id,key:saved.append((id,key)))
 return app,saved

def test_named_save_rename_and_copy_preserve_key_without_call(tmp_path,monkeypatch):
 app,saved=setup(tmp_path,monkeypatch)
 with TestClient(app) as c:
  p=c.post("/v1/profiles",headers=H,json={"provider":"openai","name":"漫画用DS","endpoint":"https://api.deepseek.com/v1/chat/completions/","model":"deepseek-flash","key":"owned-test-placeholder"}).json()
  assert p["name"]=="漫画用DS" and p["endpoint"]=="https://api.deepseek.com/v1"
  assert p["price_source"]=="official" and cost_rates(p)==(2,8) and len(saved)==1
  renamed=c.post("/v1/profiles",headers=H,json={"provider":"openai","id":p["id"],"name":"学术DS","endpoint":p["endpoint"],"model":p["model"]}).json()
  assert renamed["id"]==p["id"] and renamed["name"]=="学术DS" and renamed["credential_id"]==p["credential_id"] and len(saved)==1
  copy=c.post("/v1/profiles",headers=H,json={"provider":"openai","existing_id":p["id"],"name":"漫画副本","endpoint":p["endpoint"],"model":p["model"]}).json()
  assert copy["id"]!=p["id"] and copy["credential_id"]==p["credential_id"] and len(saved)==1
  profiles=c.get("/v1/profiles",headers=H).json()
  assert len([x for x in profiles if x["provider"]=="openai"])==2
  assert "owned-test-placeholder" not in json.dumps(profiles) and all("key" not in x for x in profiles)
  assert not app.state.store.all("request") and not app.state.store.all("batch")

def test_active_config_is_not_overwritten_but_can_be_copied(tmp_path,monkeypatch):
 app,saved=setup(tmp_path,monkeypatch)
 with TestClient(app) as c:
  p=c.post("/v1/profiles",headers=H,json={"provider":"openai","key":"owned-test-placeholder","name":"原配置"}).json()
  b=app.state.store.create({"chapter_id":"owned-chapter"},p)
  app.state.store.reserve(b["id"],"owned-request",100,.001)
  usage=app.state.store.get("batch",b["id"])["usage"]
  r=c.post("/v1/profiles",headers=H,json={"provider":"openai","id":p["id"],"name":"不应覆盖","key":"other-owned-placeholder"})
  assert r.status_code==409 and "另存" in r.json()["detail"]
  assert app.state.store.get("profile",p["id"])["name"]=="原配置" and len(saved)==1
  copy=c.post("/v1/profiles",headers=H,json={"provider":"openai","existing_id":p["id"],"name":"副本"}).json()
  assert copy["id"]!=p["id"] and app.state.store.get("batch",b["id"])["usage"]==usage

def test_no_key_reuse_across_sites_and_unknown_price_is_not_guessed(tmp_path,monkeypatch):
 app,saved=setup(tmp_path,monkeypatch)
 with TestClient(app) as c:
  p=c.post("/v1/profiles",headers=H,json={"provider":"openai","key":"owned-test-placeholder"}).json()
  r=c.post("/v1/profiles",headers=H,json={"provider":"openai","existing_id":p["id"],"endpoint":"https://another.example/v1","model":"custom"})
  assert r.status_code==409 and len(saved)==1
  custom=c.post("/v1/profiles",headers=H,json={"provider":"openai","endpoint":"https://another.example/v1","model":"custom","key":"second-owned-placeholder"}).json()
  assert cost_rates(custom) is None and custom["price_source"]=="unknown" and custom["input_yuan_per_million"] is None
  assert len(saved)==2

def test_optional_manual_price_validation_before_saving_key(tmp_path,monkeypatch):
 app,saved=setup(tmp_path,monkeypatch)
 with TestClient(app) as c:
  for v in ({"input_yuan_per_million":-1,"output_yuan_per_million":8},{"input_yuan_per_million":None,"output_yuan_per_million":8}):
   r=c.post("/v1/profiles",headers=H,json={"provider":"openai","key":"owned-test-placeholder","pricing_mode":"manual",**v})
   assert r.status_code==409
  assert not saved
  p=c.post("/v1/profiles",headers=H,json={"provider":"openai","key":"owned-test-placeholder","model":"custom","endpoint":"https://example.org/v1","pricing_mode":"manual","input_yuan_per_million":0,"output_yuan_per_million":0}).json()
  assert cost_rates(p)==(0,0)

def test_official_price_matches_model_and_endpoint():
 assert cost_rates({"endpoint":"https://api.deepseek.com","model":"deepseek-v4-pro","pricing_mode":"auto"})==(9,27)
 assert cost_rates({"endpoint":"https://api.deepseek.com.evil.example","model":"deepseek-flash","pricing_mode":"auto"}) is None
 assert cost_rates({"endpoint":"https://api.deepseek.com","model":"unknown","pricing_mode":"auto"}) is None

def test_unpriced_keeps_token_limits_and_unknown_charge_reservations(tmp_path,monkeypatch):
 app,_=setup(tmp_path,monkeypatch);s=app.state.store
 profile={"id":"owned-unknown","provider":"openai","endpoint":"https://api.example.org","model":"custom"}
 b=s.create({"chapter_id":"limit","budget":{"tokens":10,"yuan":.001}},profile)
 with pytest.raises(BudgetStop):Translator(s,key_reader=lambda _:pytest.fail("No key needed before reservation")).translate(b,{"0":"hello"})
 assert s.get("batch",b["id"])["usage"]["requests"]==0
 b=s.create({"chapter_id":"uncertain"},profile)
 with pytest.raises(UncertainCharge):Translator(s,key_reader=lambda _:"owned-test-placeholder",transport=httpx.MockTransport(lambda _:httpx.Response(503))).translate(b,{"0":"hello"})
 current=s.get("batch",b["id"])
 assert current["state"]=="uncertain" and current["usage"]["reserved_tokens"]>0 and current["cost_known"] is False


def test_known_yuan_and_unpriced_request_caps_are_both_enforced(tmp_path,monkeypatch):
 app,_=setup(tmp_path,monkeypatch);s=app.state.store
 official={"id":"owned-ds","provider":"openai","endpoint":"https://api.deepseek.com","model":"deepseek-flash","pricing_mode":"auto"}
 b=s.create({"chapter_id":"known-cap","budget":{"yuan":.00001}},official)
 with pytest.raises(BudgetStop):Translator(s,key_reader=lambda _:pytest.fail("Budget must block before key lookup")).translate(b,{"0":"hello"})
 assert b["cost_known"] is True and s.get("batch",b["id"])["usage"]["requests"]==0
 unknown={"id":"owned-unknown","provider":"openai","endpoint":"https://example.org/v1","model":"custom"}
 b=s.create({"chapter_id":"requests-cap","budget":{"requests":1}},unknown)
 def reply(request):
  blocks=json.loads(json.loads(request.content)["messages"][1]["content"])["blocks"]
  return httpx.Response(200,json={"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15},"choices":[{"finish_reason":"stop","message":{"content":json.dumps({k:"译文" for k in blocks})}}]})
 t=Translator(s,key_reader=lambda _:"owned-test-placeholder",transport=httpx.MockTransport(reply))
 t.translate(b,{"0":"unique first text"})
 with pytest.raises(BudgetStop):t.translate(b,{"1":"unique second text"})
 assert s.get("batch",b["id"])["usage"]["requests"]==1


def test_delete_profile_preserves_shared_key_history_files_and_audit(tmp_path,monkeypatch):
 app,saved=setup(tmp_path,monkeypatch);s=app.state.store
 app.state.runner.translator.key_reader=lambda _:pytest.fail("Deleting a profile must not read any key")
 with TestClient(app) as c:
  p=c.post("/v1/profiles",headers=H,json={"provider":"openai","name":"删除目标","key":"owned-test-placeholder"}).json()
  copy=c.post("/v1/profiles",headers=H,json={"provider":"openai","name":"保留副本","existing_id":p["id"]}).json()
  b=s.create({"chapter_id":"kept-history"},p);receipt=s.reserve(b["id"],"owned-finished",100,.01);s.settle(receipt,{"0":"译文"},80,.008)
  b=s.get("batch",b["id"]);b["state"]="completed";s.put("batch",b["id"],b)
  file=tmp_path/'kept-output.txt';file.write_text('owned output',encoding='utf8');audit=s.all('request')
  assert c.delete('/v1/profiles/'+p['id'],headers=H).json()=={'deleted':True,'paused_tasks':0,'retained_tasks':1}
  assert p['id'] not in {x['id'] for x in c.get('/v1/profiles',headers=H).json()}
  assert s.get('profile',copy['id'])['credential_id']==p['credential_id'] and len(saved)==1
  assert s.get('batch',b['id'])==b and s.all('request')==audit and file.read_text()=='owned output'
  assert c.delete('/v1/profiles/'+p['id'],headers=H).json()['already_deleted'] is True
  assert c.post('/v1/batches',headers=H,json={'chapter_id':'new','profile_id':p['id']}).status_code==404
  assert len(s.all('batch'))==1

@pytest.mark.parametrize('state',['active','paused','budget','uncertain'])
def test_delete_referenced_profile_pauses_running_and_keeps_other_states_and_audit(tmp_path,monkeypatch,state):
 app,_=setup(tmp_path,monkeypatch);s=app.state.store
 app.state.runner.translator.key_reader=lambda _:pytest.fail('Removal must not read any key')
 with TestClient(app) as c:
  p=c.post('/v1/profiles',headers=H,json={'provider':'openai','key':'owned-test-placeholder'}).json()
  b=s.create({'chapter_id':'retained'},p);r=s.reserve(b['id'],'pending',100,.01)
  if state=='uncertain':s.uncertain(r)
  b=s.get('batch',b['id']);b['state']=state;s.put('batch',b['id'],b)
  receipt=s.get('request',r['id']);response=c.delete('/v1/profiles/'+p['id'],headers=H)
  assert response.status_code==200 and response.json()=={'deleted':True,'paused_tasks':int(state=='active'),'retained_tasks':1}
  current=s.get('batch',b['id'])
  assert current['state']==('paused' if state=='active' else state)
  for key in ('profile','pages','budget','usage'):assert current[key]==b[key]
  assert s.get('request',r['id'])==receipt
  assert p['id'] not in {item['id'] for item in s.all('profile')}
  assert c.delete('/v1/profiles/'+p['id'],headers=H).json()['already_deleted'] is True
  with pytest.raises(BudgetStop):s.reserve(b['id'],'must-not-start',100,.01)


def test_removal_allows_inflight_settlement_and_manual_resume_without_reset(tmp_path,monkeypatch):
 app,_=setup(tmp_path,monkeypatch);s=app.state.store
 with TestClient(app) as c:
  p=c.post('/v1/profiles',headers=H,json={'provider':'openai','key':'owned-test-placeholder'}).json()
  b=s.create({'chapter_id':'inflight','pages':[{'index':0}]},p);s.image(b['id'],0,'owned-image');s.claim()
  other=s.create({'chapter_id':'unrelated'},dict(p,id='other-profile'));other_before=s.get('batch',other['id'])
  r=s.reserve(b['id'],'already-sent',100,.01)
  response=c.delete('/v1/profiles/'+p['id'],headers=H)
  assert response.status_code==200 and response.json()['paused_tasks']==1
  assert s.get('batch',b['id'])['pages'][0]['state']=='running'
  s.settle(r,{'0':'已收到译文'},70,.007)
  current=s.get('batch',b['id'])
  assert current['state']=='paused' and current['usage']['tokens']==70 and current['usage']['reserved_tokens']==0
  assert s.get('batch',other['id'])==other_before
  s.action(b['id'],'resume')
  assert s.get('batch',b['id'])['usage']==current['usage']
  assert c.delete('/v1/profiles/'+p['id'],headers=H).json()['already_deleted'] is True
  assert s.get('batch',b['id'])['state']=='active'
  s.reserve(b['id'],'user-continued',100,.01)
  assert s.get('batch',b['id'])['usage']['requests']==2


def test_delete_builtin_free_profiles_is_refused_and_auth_is_required(tmp_path,monkeypatch):
 app,_=setup(tmp_path,monkeypatch)
 with TestClient(app) as c:
  assert c.delete('/v1/profiles/free-tencent').status_code==401
  for id in ('free-tencent','free-bing'):
   assert c.delete('/v1/profiles/'+id,headers=H).status_code==409
   assert app.state.store.get('profile',id)['id']==id
