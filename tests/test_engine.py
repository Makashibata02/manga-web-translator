import io, json, threading
import httpx, pytest
from PIL import Image
from fastapi.testclient import TestClient
from engine.store import Store, BudgetStop, UncertainCharge, digest
from engine.translate import Translator
from engine.server import create_app
from engine.vision import tiles, merge_regions
from engine.runner import Runner

PROFILE={"id":"test","provider":"mock","test_only":True,"name":"测试","max_output":100}
def batch(store,count=40,**extra):
    return store.create({"chapter_id":"fixture","pages":[{"index":i,"url":f"https://example.org/{i}.png"} for i in range(count)],"total":count,"complete":True,**extra},PROFILE)
def test_forty_pages_priority_and_dedup(tmp_path):
    s=Store(tmp_path);b=batch(s)
    for i in range(40):s.image(b["id"],i,str(i))
    s.action(b["id"],"viewport",{"visible":[24]})
    assert s.claim()[1]["index"]==24
    assert s.claim()[1]["index"]==25
    assert batch(s)["id"]==b["id"]
    assert len(s.get("batch",b["id"])["pages"])==40
def test_budget_atomic_across_workers(tmp_path):
    s=Store(tmp_path);b=batch(s,budget={"tokens":100,"requests":50,"yuan":5})
    results=[]
    def call(i):
        try:s.reserve(b["id"],str(i),60,.01);results.append(True)
        except BudgetStop:results.append(False)
    threads=[threading.Thread(target=call,args=(i,)) for i in range(2)]
    for t in threads:t.start()
    for t in threads:t.join()
    assert sum(results)==1
    assert s.get("batch",b["id"])["usage"]["reserved_tokens"]==60
def test_pause_restart_does_not_reset_budget(tmp_path):
    s=Store(tmp_path);b=batch(s);s.reserve(b["id"],"paid",500,.3)
    other=Store(tmp_path);restored=other.get("batch",b["id"])
    assert restored["state"]=="uncertain"
    assert restored["usage"]["reserved_tokens"]==500
    with pytest.raises(BudgetStop):other.action(b["id"],"resume")
    other.action(b["id"],"acknowledge");other.action(b["id"],"resume")
    assert other.get("batch",b["id"])["usage"]["requests"]==1
def test_result_cache_never_recharges(tmp_path):
    s=Store(tmp_path);b=batch(s);t=Translator(s)
    first=t.translate(b,{"a":"こんにちは"})
    assert t.translate(b,{"a":"こんにちは"})==first
    assert s.get("batch",b["id"])["usage"]["requests"]==1
def test_source_revision_rejects_late_result(tmp_path):
    s=Store(tmp_path);b=batch(s,1);old=s.image(b["id"],0,"old")
    new=s.image(b["id"],0,"new")
    assert not s.patch_page(b["id"],0,old["revision"],output="wrong.png")
    assert s.get("batch",b["id"])["pages"][0]["hash"]=="new"
def test_url_changes_same_bytes_keep_result(tmp_path):
    s=Store(tmp_path);b=batch(s,1);p=s.image(b["id"],0,"same")
    s.patch_page(b["id"],0,p["revision"],state="completed")
    s.append(b["id"],[{"index":0,"url":"https://cdn.example.org/new?r=1"}],True,1)
    p2=s.image(b["id"],0,"same")
    assert p2["state"]=="queued" and p2["hash"]=="same" # Revalidate bytes, then pipeline reuses content cache.
def test_lazy_discovery_not_fake_complete(tmp_path):
    s=Store(tmp_path);b=batch(s,5,total=40,complete=False)
    assert not b["complete"]
    b=s.append(b["id"],[{"index":i} for i in range(5,40)],True,40)
    assert b["complete"] and len(b["pages"])==40
def test_tiles_cover_20000_and_merge_cross_seam():
    spans=list(tiles(20000));assert spans[0][0]==0 and spans[-1][1]==20000
    assert all(a[1]-b[0]==400 for a,b in zip(spans,spans[1:]))
    regions=merge_regions([{"box":[10,1450,100,1580]},{"box":[10,1470,100,1640]}])
    assert len(regions)==1 and regions[0]["box"]==[10,1450,100,1640]
def test_failed_http_keeps_reservation_and_requires_confirmation(tmp_path):
    s=Store(tmp_path);b=batch(s,1);b["profile"]={**PROFILE,"provider":"openai","endpoint":"https://example.org/v1","input_yuan_per_million":2,"output_yuan_per_million":3,"model":"test"}
    transport=httpx.MockTransport(lambda _:httpx.Response(502,text="private upstream diagnostic"))
    t=Translator(s,key_reader=lambda _: "test-placeholder",transport=transport)
    with pytest.raises(UncertainCharge):t.translate(b,{"0":"hello"})
    stored=s.get("batch",b["id"])
    assert stored["state"]=="uncertain" and stored["usage"]["reserved_tokens"]>0
def test_protected_api_origin_body_and_no_key(tmp_path):
    app=create_app(tmp_path,token="test-token",run=False,test_mode=True,extension_id="a"*32)
    with TestClient(app) as c:
        assert c.get("/v1/health").status_code==401
        headers={"Authorization":"Bearer test-token"}
        assert c.get("/v1/health",headers={**headers,"Origin":"https://evil.example"}).status_code==403
        p=c.post("/v1/profiles",headers=headers,json={k:v for k,v in PROFILE.items() if k!="id"}).json()
        assert "key" not in p
        b=c.post("/v1/batches",headers=headers,json={"chapter_id":"test","profile_id":p["id"],"pages":[{"index":0}],"total":1,"complete":True}).json()
        im=Image.new("RGB",(100,100),"white");data=io.BytesIO();im.save(data,"PNG")
        r=c.put(f'/v1/batches/{b["id"]}/pages/0/image',content=data.getvalue(),headers=headers)
        assert r.status_code==200 and r.json()["hash"]
        assert c.get(f'/v1/batches/{b["id"]}/pages/0/original',headers=headers).status_code==200
        assert c.put(f'/v1/batches/{b["id"]}/pages/0/image',content=b"not image",headers=headers).status_code==400
def test_whole_pipeline_reuses_same_image(tmp_path):
    class Vision:
        def detect(self,source,work,kind,checkpoint):
            work.mkdir(parents=True,exist_ok=True)
            return [{"id":"0","source":"hello","translation":"","note":""}]
        def render(self,source,work,regions,checkpoint):
            Image.new("RGB",(50,50),"white").save(work/"translated.png")
            (work/"translated.json").write_text(json.dumps(regions))
    s=Store(tmp_path);b=batch(s,2);t=Translator(s);r=Runner(s,tmp_path,vision=Vision(),translator=t)
    for i in range(2):s.image(b["id"],i,"same-image")
    r.process(*s.claim());r.process(*s.claim())
    final=s.get("batch",b["id"])
    assert all(p["state"]=="completed" for p in final["pages"])
    assert final["usage"]["requests"]==1
def test_cancel_other_batch_unchanged(tmp_path):
    s=Store(tmp_path);a=batch(s,1);b=batch(s,1,chapter_id="second")
    s.action(a["id"],"cancel")
    assert s.get("batch",b["id"])["state"]=="active"
