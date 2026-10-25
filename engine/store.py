import copy, hashlib, json, sqlite3, threading, time, uuid
from pathlib import Path
from .pricing import cost_known

COMIC_RULES="comic-v16"

class BudgetStop(Exception): pass
class UncertainCharge(Exception): pass

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

def atomic_json(path, value):
    # Unique temporary names prevent Windows writer collisions.
    p=Path(path); p.parent.mkdir(parents=True, exist_ok=True)
    tmp=p.with_name(p.name+"."+uuid.uuid4().hex+".tmp")
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding="utf8")
    for attempt in range(8):
        try:
            tmp.replace(p); return
        except PermissionError:
            time.sleep(.025 * (attempt+1))
    tmp.unlink(missing_ok=True)
    raise PermissionError("文件被占用，未覆盖已保存记录")

class Store:
    def __init__(self, root):
        self.root=Path(root); self.root.mkdir(parents=True,exist_ok=True)
        self.lock=threading.RLock()
        self.db=sqlite3.connect(self.root/"tasks.db",check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT,data TEXT,PRIMARY KEY(kind,id))")
        self.db.commit()
        with self.lock:
            for b in self.all("batch"):
                b.setdefault("cost_known",cost_known(b["profile"]))
                b.setdefault("usage_kind","characters" if b["profile"]["provider"] in ("bing","tencent","youdao") else "tokens")
                b["usage"].setdefault("reserved_characters",0);b["budget"].setdefault("characters",1000000)
                if b["profile"]["provider"]=="youdao" and b["state"]!="completed":
                    b.update(state="paused",error="有道服务已移除，请新建免费任务；历史用量保留")
                self.put("batch",b["id"],b)
                if b["state"] in ("active","paused","budget","uncertain"):
                    if b["state"]=="active": b["state"]="paused"
                    for p in b["pages"]:
                        if p["state"]=="running": p["state"]="queued" if p.get("hash") else "waiting_image"
                    self.put("batch",b["id"],b)
            for r in self.all("request"):
                if r["state"]=="reserved" and self.get("batch",r["batch"])["profile"]["provider"] in ("bing","tencent"):
                    self.fail(r,"引擎重启，免费请求已停止，请手动继续",pause=True)
                elif r["state"]=="reserved":
                    r["state"]="uncertain"; self.put("request",r["id"],r)
                    b=self.get("batch",r["batch"])
                    b["state"]="uncertain"; self.put("batch",b["id"],b)
    def get(self,kind,id):
        with self.lock:
            row=self.db.execute("SELECT data FROM records WHERE kind=? AND id=?",(kind,id)).fetchone()
            if not row: raise KeyError(id)
            return json.loads(row[0])
    def all(self,kind):
        with self.lock:
            return [json.loads(r[0]) for r in self.db.execute("SELECT data FROM records WHERE kind=? ORDER BY rowid",(kind,))]
    def put(self,kind,id,value):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO records VALUES(?,?,?)",(kind,id,json.dumps(value,ensure_ascii=False)))
            self.db.commit()
    def delete_profile(self,id):
        with self.lock:
            try:profile=self.get("profile",id)
            except KeyError:return {"deleted":False,"already_deleted":True}
            if profile["provider"]!="openai":raise ValueError("内置免费服务不能删除")
            related=[b for b in self.all("batch") if b["profile"]["id"]==id]
            running=[b for b in related if b["state"]=="active"]
            # A saved selection and a task's immutable profile are independent.
            # Pause atomically with removal; in-flight requests may still settle.
            self.db.execute("BEGIN IMMEDIATE")
            try:
                for b in running:
                    b.update(state="paused",error="模型已从配置列表移除，任务已暂停；已有请求正常结算，可从任务页手动继续")
                    self.db.execute("UPDATE records SET data=? WHERE kind=? AND id=?",(json.dumps(b,ensure_ascii=False),"batch",b["id"]))
                self.db.execute("DELETE FROM records WHERE kind=? AND id=?",("profile",id))
                self.db.commit()
            except Exception:self.db.rollback();raise
            # Keep credentials, snapshots, receipts and unresolved reservations.
            return {"deleted":True,"paused_tasks":len(running),"retained_tasks":len(related)}

    def create(self,spec,profile):
        with self.lock:
            rules=COMIC_RULES if spec.get("kind","manga")!="text" else "comic-v4"
            identity_parts=[spec["chapter_id"],profile,spec.get("source","ja"),spec.get("target","zh-CN"),spec.get("kind","manga")]
            if rules!="comic-v4":identity_parts.append(rules)
            identity=digest(identity_parts)
            for b in self.all("batch"):
                if b["identity"]==identity and b["state"]!="cancelled":
                    return self.append(b["id"],spec.get("pages",[]),spec.get("complete",False),spec.get("total"))
            id=uuid.uuid4().hex
            b=dict(id=id,identity=identity,chapter_id=spec["chapter_id"],title=spec.get("title","未命名章节"),
                   source=spec.get("source","ja"),target=spec.get("target","zh-CN"),kind=spec.get("kind","manga"),
                   profile=profile,state="active",pages=[],visible=list(spec.get("visible",[]))[:20],complete=False,total=spec.get("total"),
                   created=time.time(),cost_known=cost_known(profile),usage_kind="characters" if profile["provider"] in ("bing","tencent") else "tokens",
                   budget={"tokens":1000000,"characters":1000000,"requests":2000 if profile["provider"] in ("bing","tencent") else 1000,"yuan":5.0,**spec.get("budget",{})},
                   usage={"tokens":0,"characters":0,"requests":0,"yuan":0.0,"reserved_tokens":0,"reserved_yuan":0.0,"reserved_characters":0},
                   glossary=spec.get("glossary",{}),rules=rules,error="")
            if b['kind']=='manga' and profile['provider']=='openai':b['manga_batch_blocks']=16
            self.put("batch",id,b)
            return self.append(id,spec.get("pages",[]),spec.get("complete",False),spec.get("total"))
    def append(self,id,pages,complete=False,total=None):
        with self.lock:
            b=self.get("batch",id)
            for p in pages:
                index=int(p["index"])
                old=next((x for x in b["pages"] if x["index"]==index),None)
                if old:
                    if p.get("url") and p["url"]!=old.get("url"):
                        old.update(url=p["url"],hash="",revision=old["revision"]+1,state="waiting_image",stage="图片源已变化，重新校验")
                        old.pop("output",None)
                    continue
                item=dict(index=index,url=p.get("url",""),state="waiting_image",stage="等待图片",hash="",revision=0,error="")
                if p.get("width") and p.get("height"):item.update(width=p["width"],height=p["height"])
                b["pages"].append(item)
            b["pages"].sort(key=lambda x:x["index"])
            if total is not None: b["total"]=int(total)
            b["complete"]=bool(complete and (b["total"] is None or len(b["pages"])>=b["total"]))
            if b["state"]=="completed" and any(x["state"]=="waiting_image" for x in b["pages"]): b["state"]="paused"
            self.put("batch",id,b); return b
    def image(self,id,index,hash,width=None,height=None):
        with self.lock:
            b=self.get("batch",id); p=next(p for p in b["pages"] if p["index"]==index)
            if p["hash"]!=hash:
                p.update(hash=hash,revision=p["revision"]+1,state="queued",stage="已入队",error="")
                for key in ("regions","output","cache_key","timings"): p.pop(key,None)
            if width and height:p.update(width=width,height=height)
            self.put("batch",id,b); return p
    def patch_page(self,id,index,revision,**values):
        with self.lock:
            b=self.get("batch",id); p=next(p for p in b["pages"] if p["index"]==index)
            if p["revision"]!=revision: return False
            p.update(values)
            if b["state"]=="active" and b["pages"] and all(x["state"] in ("completed","review") for x in b["pages"]) and b["complete"]:
                b["state"]="completed"
            self.put("batch",id,b); return True
    def action(self,id,action,extra=None):
        with self.lock:
            b=self.get("batch",id)
            if b["profile"]["provider"]=="youdao" and action in ("resume","retry"):raise ValueError("有道服务已移除，请新建免费任务")
            if action=="viewport": b["visible"]=list((extra or {}).get("visible",[]))[:20]
            elif action=="pause": b["state"]="paused"
            elif action=="cancel": b["state"]="cancelled"
            elif action=="resume":
                if b["state"] in ("uncertain","budget"): raise BudgetStop("请先确认未知用量或追加额度")
                b["state"]="completed" if b["complete"] and b["pages"] and all(p["state"] in ("completed","review") for p in b["pages"]) else "active"
            elif action=="retry":
                if b["state"] in ("uncertain","budget"): raise BudgetStop("请先处理费用暂停")
                for p in b["pages"]:
                    if p["state"]=="failed": p.update(state="queued" if p["hash"] else "waiting_image",error="")
                b["state"]="active"
            elif action=="extend":
                for k,v in (extra or {}).items():
                    if k in b["budget"] and float(v)>0: b["budget"][k]+=float(v)
                if b["state"]=="budget": b["state"]="paused"
            elif action=="acknowledge":
                # Unknown calls remain charged at their full reservation. No silent clearing.
                for r in self.all("request"):
                    if r["batch"]==id and r["state"]=="uncertain":
                        r["state"]="abandoned"; self.put("request",r["id"],r)
                if b["state"]=="uncertain": b["state"]="paused"
            else: raise ValueError("未知操作")
            self.put("batch",id,b); return b
    def claim(self):
        with self.lock:
            candidates=[]
            for b in self.all("batch"):
                if b["state"]!="active": continue
                vis=b["visible"] or ([b["pages"][0]["index"]] if b["pages"] else []); anchor=max(vis) if vis else 0
                for p in b["pages"]:
                    if p["state"]!="queued": continue
                    rank=0 if p["index"] in vis else 1 if anchor<p["index"]<=anchor+5 else 2
                    candidates.append(((rank,b["created"],p["index"]),b,p))
            if not candidates: return None
            _,b,p=min(candidates,key=lambda item:item[0])
            p["state"]="running"; self.put("batch",b["id"],b)
            return b,copy.deepcopy(p)
    def reserve(self,batch,id,tokens,cost,characters=0):
        with self.lock:
            base_id=id
            attempts=[r for r in self.all("request") if r.get("base_id",r["id"])==base_id]
            if attempts:
                r=max(attempts,key=lambda r:r["created"])
                if r["state"]=="done": return r
                if r["state"] not in ("abandoned","failed"): raise UncertainCharge("此请求已有未确认的用量，不自动重复提交")
                id=base_id+"-"+uuid.uuid4().hex
            b=self.get("batch",batch); u=b["usage"]; limit=b["budget"]
            if b["state"]!="active": raise BudgetStop("任务已暂停")
            if u.get("characters",0)+u.get("reserved_characters",0)+characters>limit.get("characters",1000000) or u["tokens"]+u["reserved_tokens"]+tokens>limit["tokens"] or u["requests"]+1>limit["requests"] or (b.get("cost_known",cost_known(b["profile"])) and u["yuan"]+u["reserved_yuan"]+cost>limit["yuan"]):
                b.update(state="budget",error="达到本章额度上限，请确认后追加")
                self.put("batch",batch,b); raise BudgetStop(b["error"])
            u["requests"]+=1; u["reserved_tokens"]+=tokens; u["reserved_yuan"]+=cost;u["reserved_characters"]=u.get("reserved_characters",0)+characters
            r=dict(id=id,base_id=base_id,batch=batch,state="reserved",tokens=tokens,cost=cost,cost_known=b.get("cost_known",cost_known(b["profile"])),characters=characters,created=time.time())
            # Transaction covers reservation and request audit together.
            self.db.execute("BEGIN IMMEDIATE")
            try:
                for kind,key,val in (("batch",batch,b),("request",id,r)):
                    self.db.execute("INSERT OR REPLACE INTO records VALUES(?,?,?)",(kind,key,json.dumps(val,ensure_ascii=False)))
                self.db.commit()
            except Exception: self.db.rollback(); raise
            return r
    def settle(self,r,result,tokens,cost):
        with self.lock:
            b=self.get("batch",r["batch"]); u=b["usage"]
            u["reserved_tokens"]-=r["tokens"]; u["reserved_yuan"]-=r["cost"];u["reserved_characters"]=u.get("reserved_characters",0)-r.get("characters",0)
            u["tokens"]+=tokens; u["characters"]=u.get("characters",0)+r.get("characters",0); u["yuan"]+=cost
            if u["tokens"]>b["budget"]["tokens"] or (b.get("cost_known",cost_known(b["profile"])) and u["yuan"]>b["budget"]["yuan"]):
                b.update(state="budget",error="实际用量超过预留，已停止后续请求")
            r.update(state="done",result=result,actual_tokens=tokens,actual_yuan=cost)
            r['settled']=time.time()
            for key in ('prompt_tokens','completion_tokens','api_seconds'):
                if key in r:u[key]=u.get(key,0)+r[key]
            self.db.execute("BEGIN IMMEDIATE")
            try:
                for kind,key,val in (("batch",b["id"],b),("request",r["id"],r)):
                    self.db.execute("INSERT OR REPLACE INTO records VALUES(?,?,?)",(kind,key,json.dumps(val,ensure_ascii=False)))
                self.db.commit()
            except Exception: self.db.rollback(); raise
    def uncertain(self,r):
        with self.lock:
            r["state"]="uncertain"; self.put("request",r["id"],r)
            b=self.get("batch",r["batch"]); b.update(state="uncertain",error="请求可能已收费，保留预留额度，请核对账单后确认")
            self.put("batch",b["id"],b)

    def fail(self,r,message,pause=False):
        self.settle(r,{},0,0)
        with self.lock:
            r["state"]="failed";r["error"]=message;self.put("request",r["id"],r)
            if pause:
                b=self.get("batch",r["batch"]);b.update(state="paused",error=message);self.put("batch",b["id"],b)
