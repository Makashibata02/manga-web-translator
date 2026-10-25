import json
import httpx
import pytest
from engine.store import Store
from engine.translate import Translator

def test_openai_request_contains_only_text_and_billing_is_settled(tmp_path):
 s=Store(tmp_path)
 profile={"id":"simulated","provider":"openai","endpoint":"https://api.example.org/v1","model":"simulated","input_yuan_per_million":2,"output_yuan_per_million":8,"max_output":512}
 b=s.create({"chapter_id":"c"},profile);seen=[]
 def respond(request):
  body=json.loads(request.content);seen.append(body)
  assert request.headers["Authorization"]=="Bearer fake-test-value"
  assert "image_url" not in request.content.decode() and "data:image" not in request.content.decode()
  return httpx.Response(200,json={"choices":[{"finish_reason":"stop","message":{"content":'{"1":"请不要去。数字是12。"}'}}],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}})
 t=Translator(s,key_reader=lambda _:"fake-test-value",transport=httpx.MockTransport(respond))
 assert t.translate(b,{"1":"行かないで。数字は12です。"})["1"].endswith("12。")
 assert t.translate(b,{"1":"行かないで。数字は12です。"}) and len(seen)==1
 u=s.get("batch",b["id"])["usage"]
 assert u["tokens"]==120 and u["reserved_tokens"]==0
 assert u["yuan"]==pytest.approx(.00036)
def test_different_language_does_not_reuse_receipt(tmp_path):
 s=Store(tmp_path);profile={"id":"mock","provider":"mock","test_only":True}
 ja=s.create({"chapter_id":"chapter","target":"zh-CN"},profile)
 en=s.create({"chapter_id":"chapter","target":"en"},profile)
 assert ja["id"]!=en["id"]
 t=Translator(s);t.translate(ja,{"1":"hello"});t.translate(en,{"1":"hello"})
 assert len(s.all("request"))==2
def test_missing_price_allows_call_and_marks_cost_unknown(tmp_path):
 s=Store(tmp_path);b=s.create({"chapter_id":"chapter"},{"provider":"openai","id":"owned-test","endpoint":"https://api.example.org/v1/chat/completions","model":"custom"})
 seen=[]
 def respond(request):
  seen.append(str(request.url));return httpx.Response(200,json={"choices":[{"finish_reason":"stop","message":{"content":'{"1":"你好"}'}}],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}})
 t=Translator(s,key_reader=lambda _:"owned-test-placeholder",transport=httpx.MockTransport(respond))
 assert t.translate(b,{"1":"hello"})=={"1":"你好"}
 current=s.get("batch",b["id"]);assert current["cost_known"] is False
 assert current["usage"]["tokens"]==120 and current["usage"]["reserved_tokens"]==0
 assert seen==["https://api.example.org/v1/chat/completions"]
 assert s.all("request")[0]["cost_known"] is False

def test_confirmed_retry_receipt_is_reused_after_later_restart(tmp_path):
 from engine.store import UncertainCharge
 s=Store(tmp_path);profile={"id":"simulated","provider":"openai","endpoint":"https://api.example.org","model":"simulated","input_yuan_per_million":2,"output_yuan_per_million":8}
 b=s.create({"chapter_id":"retry"},profile);calls=[]
 def handler(request):
  calls.append(1)
  if len(calls)==1:return httpx.Response(503)
  return httpx.Response(200,json={"choices":[{"finish_reason":"stop","message":{"content":'{"1":"你好"}'}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}})
 t=Translator(s,key_reader=lambda _:"test-placeholder",transport=httpx.MockTransport(handler))
 with pytest.raises(UncertainCharge):t.translate(b,{"1":"hello"})
 s.action(b["id"],"acknowledge");s.action(b["id"],"resume")
 assert t.translate(b,{"1":"hello"})=={"1":"你好"}
 assert t.translate(b,{"1":"hello"})=={"1":"你好"}
 assert len(calls)==2 and s.get("batch",b["id"])["usage"]["requests"]==2
