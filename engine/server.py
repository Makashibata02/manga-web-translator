import argparse, base64, hashlib, io, json, os, secrets, time, uuid, zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from PIL import Image
from . import __version__
from .security import data_root, token_file, save_key
from .store import Store, BudgetStop, UncertainCharge, atomic_json, COMIC_RULES
from .runner import Runner
from .translate import Translator,TranslationError
from .presets import FREE_PROFILES,DEEPSEEK
from .pricing import configure_pricing,OFFICIAL_PRICES,PRICE_CHECKED

class PageSpec(BaseModel):
    index:int=Field(ge=0,le=100000)
    url:str=""
    width:int|None=Field(default=None,gt=0,le=100000)
    height:int|None=Field(default=None,gt=0,le=100000)
class BatchSpec(BaseModel):
    chapter_id:str=Field(min_length=1,max_length=2000)
    title:str=Field(default="未命名",max_length=500)
    source:str="ja"
    target:str="zh-CN"
    kind:str="manga"
    profile_id:str
    pages:list[PageSpec]=Field(default_factory=list,max_length=10000)
    complete:bool=False
    visible:list[int]=Field(default_factory=list,max_length=20)
    total:int|None=Field(default=None,ge=0,le=100000)
    budget:dict=Field(default_factory=dict)
    glossary:dict[str,str]=Field(default_factory=dict)

def create_app(root=None,models=None,token=None,extension_id=None,run=True,test_mode=False):
    root=Path(root or data_root()); token=token or token_file(root)
    models=Path(models or os.environ.get("MWT_MODELS",Path(__file__).resolve().parents[1]/"models"))
    store=Store(root); runner=Runner(store,models)
    for p in FREE_PROFILES:store.put("profile",p["id"],p)
    @asynccontextmanager
    async def lifecycle(app):
        if run: runner.start()
        yield
        runner.stop.set()
    app=FastAPI(lifespan=lifecycle,docs_url=None,redoc_url=None,openapi_url=None)
    app.state.store=store; app.state.runner=runner
    @app.middleware("http")
    async def auth(request,call_next):
        host=request.headers.get("host","").split(":")[0]
        origin=request.headers.get("origin","")
        allowed="chrome-extension://"+extension_id if extension_id else ""
        if host not in ("127.0.0.1","localhost","testserver"): return JSONResponse({"detail":"Invalid host"},403)
        if origin and origin!=allowed: return JSONResponse({"detail":"Invalid origin"},403)
        if request.method=="OPTIONS" and origin==allowed and allowed:
            return Response(headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS","Access-Control-Allow-Headers":"authorization,content-type"})
        if not secrets.compare_digest(request.headers.get("authorization",""),"Bearer "+token):
            return JSONResponse({"detail":"未授权"},401)
        try: response=await call_next(request)
        except KeyError: response=JSONResponse({"detail":"记录不存在"},404)
        except (ValueError,BudgetStop,UncertainCharge,TranslationError) as e: response=JSONResponse({"detail":str(e)},409)
        if origin and origin==allowed: response.headers["Access-Control-Allow-Origin"]=origin
        response.headers["Cache-Control"]="no-store"
        return response
    @app.get("/v1/health")
    def health():
        return {"version":__version__,"pid":os.getpid(),"protocol":1,"models_ready":(models/"manifest.json").is_file(),"test_mode":test_mode,"comic_rules":COMIC_RULES}
    @app.get("/v1/profiles")
    def profiles(): return [{**p,"has_key":p.get("has_key",p["provider"]=="openai")} for p in store.all("profile") if p["provider"]!="youdao"]
    @app.get("/v1/capabilities")
    def capabilities():return {"profile_management":4,"performance_telemetry":1,"comic_layout":"vertical-rtl","manga_batch_blocks":16,"manga_batch_characters":2000,"pricing_presets":OFFICIAL_PRICES,"price_checked":PRICE_CHECKED,"deepseek":DEEPSEEK,"default_profile":"free-tencent","batch_blocks":8,"batch_characters":4000,"providers":{"tencent":{"usage_kind":"characters","batch":True},"bing":{"usage_kind":"characters","batch":False},"openai":{"usage_kind":"tokens","batch":True}}}
    @app.post("/v1/profiles")
    def profile(value:dict):
        with store.lock:
            provider=value.get("provider")
            if provider in ("bing","tencent"):return store.get("profile","free-"+provider)
            if provider!="openai" and not(test_mode and provider=="mock"):raise ValueError("不支持的服务")
            key=value.get("key","")
            if not isinstance(key,str):raise ValueError("API Key 应为文字")
            key=key.strip();target_id=value.get("id");old_id=target_id or value.get("existing_id");old=None
            if old_id:
                old=store.get("profile",old_id)
                if old["provider"]!="openai":raise ValueError("已有配置不是兼容 API 配置")
            if target_id and any(b["profile"]["id"]==target_id and b["state"] in ("active","paused","budget","uncertain") for b in store.all("batch")):
                raise ValueError("该配置有未完成任务，不能覆盖；请点击另存为新配置，原任务与用量会保留")
            if not key and not old and provider!="mock":raise ValueError("请填写 API Key")
            id=target_id or uuid.uuid4().hex
            clean={**DEEPSEEK,**{k:value[k] for k in ("endpoint","model","prompt","max_output") if k in value}}
            endpoint=str(clean["endpoint"]).strip().rstrip("/")
            if endpoint.endswith("/chat/completions"):endpoint=endpoint[:-len("/chat/completions")]
            clean.update(endpoint=endpoint,model=str(clean["model"]).strip())
            if not clean["model"] or len(clean["model"])>200:raise ValueError("请填写有效模型名")
            clean.update(id=id,name=(str(value.get("name","")).strip() or clean["model"])[:100],provider=provider)
            if provider=="mock":clean["test_only"]=True
            else:
                parsed=urlparse(endpoint)
                if parsed.scheme!="https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:raise ValueError("API 地址应为不含密钥或查询参数的 HTTPS 地址")
                if not key and old and (urlparse(old.get("endpoint",DEEPSEEK["endpoint"])).hostname!=parsed.hostname or urlparse(old.get("endpoint",DEEPSEEK["endpoint"])).port!=parsed.port):
                    raise ValueError("更换 API 站点后请填写该站点的 Key，不会将旧 Key 发送到新站点")
            configure_pricing(clean,value)
            if provider!="mock":
                if key:
                    credential_id=uuid.uuid4().hex;save_key(credential_id,key);clean.update(credential_id=credential_id,has_key=True)
                else:clean.update(credential_id=old.get("credential_id",old["id"]),has_key=True)
            store.put("profile",id,clean);return clean
    @app.delete("/v1/profiles/{id}")
    def delete_profile(id:str):return store.delete_profile(id)
    @app.post("/v1/profiles/{id}/test")
    def connection_test(id:str):
        with store.lock:
            profile=store.get("profile",id); profile={**profile,"max_output":256}
            b=store.create({"chapter_id":"connection-test:"+uuid.uuid4().hex,"title":"连接测试","kind":"text","budget":{"tokens":6000,"requests":1,"yuan":.2}},profile)
        result=runner.translator.translate(b,{"0":"This is a connection test. Do not change the number 12."})
        b=store.get("batch",b["id"]); b["state"]="completed"; store.put("batch",b["id"],b)
        return {"translation":result["0"],"usage":b["usage"],"cost_known":b.get("cost_known",True)}
    @app.get("/v1/batches")
    def batches(): return store.all("batch")
    @app.post("/v1/batches")
    def create(spec:BatchSpec):
        if spec.source not in ("ja","en","auto") or spec.target not in ("zh-CN","zh-TW","en"):raise ValueError("不支持的语言")
        if spec.kind not in ("manga","image","text"): raise ValueError("不支持的任务类型")
        for k,v in spec.budget.items():
            if k not in ("tokens","characters","requests","yuan") or not isinstance(v,(int,float)) or v<=0: raise ValueError("额度应为正数")
        with store.lock:
            profile=store.get("profile",spec.profile_id)
            return store.create(spec.model_dump(),profile)
    @app.get("/v1/batches/{id}")
    def get_batch(id:str): return store.get("batch",id)
    @app.post("/v1/batches/{id}/append")
    def append(id:str,value:dict):
        pages=[PageSpec(**p).model_dump() for p in value.get("pages",[])]
        return store.append(id,pages,value.get("complete",False),value.get("total"))
    @app.post("/v1/batches/{id}/action")
    def action(id:str,value:dict): return store.action(id,value["action"],value.get("extra"))
    @app.put("/v1/batches/{id}/pages/{index}/image")
    async def image(id:str,index:int,request:Request):
        content=bytearray()
        async for part in request.stream():
            content.extend(part)
            if len(content)>32*1024*1024: raise HTTPException(413,"单张图片最多32 MB")
        try:
            image=Image.open(io.BytesIO(content))
            if image.width*image.height>100_000_000: raise ValueError("图片超过像素上限")
            image=image.convert("RGB"); out=io.BytesIO(); image.save(out,format="PNG"); data=out.getvalue()
        except Exception: raise HTTPException(400,"无效图片或超过像素上限")
        hash=hashlib.sha256(data).hexdigest(); path=root/"images"/(hash+".png"); path.parent.mkdir(exist_ok=True)
        if not path.exists():
            temp=path.with_suffix("."+uuid.uuid4().hex+".tmp"); temp.write_bytes(data); temp.replace(path)
        return store.image(id,index,hash,image.width,image.height)
    @app.post("/v1/batches/{id}/pages/{index}/fetch-error")
    def fetch_error(id:str,index:int,value:dict):
        b=store.get("batch",id);p=next(p for p in b["pages"] if p["index"]==index)
        if not p["hash"]:
            store.patch_page(id,index,p["revision"],state="failed",stage="图片读取失败",error=str(value.get("error","图片未正常加载"))[:250])
        return {"ok":True}
    @app.get("/v1/batches/{id}/pages/{index}/{variant}")
    def artifact(id:str,index:int,variant:str):
        b=store.get("batch",id); p=next((p for p in b["pages"] if p["index"]==index),None)
        if not p or variant not in ("original","translated"): raise HTTPException(404)
        path=root/"images"/(p["hash"]+".png") if variant=="original" else Path(p.get("output","__missing__"))
        if not path.is_file(): raise HTTPException(404)
        return FileResponse(path,media_type="image/png")
    @app.post("/v1/batches/{id}/pages/{index}/edit")
    def edit(id:str,index:int,value:dict):
        b=store.get("batch",id); p=next(p for p in b["pages"] if p["index"]==index)
        regions=p.get("regions",[])
        size=Image.open(root/"images"/(p["hash"]+".png")).size
        changes={str(x["id"]):x for x in value.get("regions",[])}
        for r in regions:
            change=changes.get(r["id"],{})
            for k in ("translation","vertical","column_order","font_size","note","text_box"):
                if k in change:
                    if k=='column_order' and change[k] not in ('ltr','rtl'):raise ValueError('竖排列顺序无效')
                    if k=="text_box":
                        v=change[k]
                        if len(v)!=4 or any(not isinstance(x,(int,float)) or x<0 for x in v) or v[2]<=v[0] or v[3]<=v[1] or v[2]>size[0] or v[3]>size[1]:raise ValueError("排版区域无效")
                    if k=="font_size" and (not isinstance(change[k],(float,int)) or not 8<=change[k]<=120):raise ValueError("字号须为8至120")
                    r[k]=change[k]
            if any(k in change for k in ('vertical','column_order')):r['layout_origin']='user'
        work=root/"edits"/id/str(index); work.mkdir(parents=True,exist_ok=True)
        import shutil
        shutil.copy2(root/"cache"/p["cache_key"]/"mask.png",work/"mask.png")
        with runner.cpu: output=runner.vision.render(root/"images"/(p["hash"]+".png"),work,regions)
        store.patch_page(id,index,p["revision"],regions=regions,output=str(output),render_version=p.get("render_version",0)+1)
        return store.get("batch",id)
    @app.post("/v1/batches/{id}/text")
    def text(id:str,value:dict):
        b=store.get("batch",id); blocks=value.get("blocks",{})
        if not isinstance(blocks,dict) or len(blocks)>8 or any(not isinstance(v,str) for v in blocks.values()) or sum(len(v) for v in blocks.values())>4000:raise ValueError("每批最多8段、4000字符")
        return runner.translator.translate(b,blocks,value.get("scope","web"))
    @app.get("/v1/batches/{id}/export")
    def export(id:str):
        b=store.get("batch",id); path=root/"exports"/(id+".zip"); path.parent.mkdir(exist_ok=True)
        with zipfile.ZipFile(path,"w",zipfile.ZIP_DEFLATED) as z:
            for p in b["pages"]:
                if p.get("output") and Path(p["output"]).is_file():
                    z.write(p["output"],f'{p["index"]+1:04d}_{b["target"]}.png')
            z.writestr("translations.json",json.dumps([{"index":p["index"],"regions":p.get("regions",[])} for p in b["pages"]],ensure_ascii=False,indent=2))
        return FileResponse(path,filename="chapter-translated.zip")
    return app

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--port",type=int,default=18767)
    parser.add_argument("--extension-id",default=os.environ.get("MWT_EXTENSION_ID"))
    parser.add_argument("--test-mode",action="store_true")
    args=parser.parse_args()
    import uvicorn
    uvicorn.run(create_app(extension_id=args.extension_id,test_mode=args.test_mode),host="127.0.0.1",port=args.port,access_log=False)
if __name__=="__main__": main()
