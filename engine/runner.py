import json, threading, time, shutil
from pathlib import Path
from .store import BudgetStop, UncertainCharge, atomic_json, digest
from .translate import Translator
from .vision import Vision
from .free import split_text

class Stopped(Exception): pass

def translation_chunks(pieces,b):
    provider=b['profile']['provider']
    width=1 if provider=='bing' else b.get('manga_batch_blocks',6) if b['kind']=='manga' and provider=='openai' else 6
    chunk=[];length=0;start=0
    for index,piece in enumerate(pieces):
        if chunk and (len(chunk)>=width or (b.get('manga_batch_blocks') and length+len(piece[1])>2000)):
            yield start,dict(chunk);chunk=[];length=0;start=index
        chunk.append(piece);length+=len(piece[1])
    if chunk:yield start,dict(chunk)

def apply_comic_layout(batch,regions):
    """A render-only preference; preserve manual edits and all paid receipts."""
    changed=False
    if batch['kind']=='manga' and batch['target'].startswith('zh'):
        for region in regions:
            if region.get('layout_origin')=='user':continue
            changed|=not region.get('vertical',False) or region.get('column_order')!='rtl'
            region.update(vertical=True,column_order='rtl',layout_origin='fixed-rtl')
    return changed

class Runner:
    def __init__(self,store,models,vision=None,translator=None):
        self.store=store; self.vision=vision or Vision(models); self.translator=translator or Translator(store)
        self.cache_locks={}; self.cache_guard=threading.Lock(); self.cpu=threading.Lock(); self.stop=threading.Event(); self.threads=[]
    def start(self):
        for i in range(2):
            thread=threading.Thread(target=self.loop,name=f"pipeline-{i}",daemon=True); thread.start(); self.threads.append(thread)
    def loop(self):
        while not self.stop.is_set():
            item=self.store.claim()
            if item is None: self.stop.wait(.2); continue
            self.process(*item)
    def process(self,b,p):
        key=digest([p['hash'],b['source'],b['target'],b['profile'],b['kind'],b['rules'],b['glossary']])
        with self.cache_guard: lock=self.cache_locks.setdefault(key,threading.Lock())
        with lock: self._process(b,p)
    def _process(self,b,p):
        id=b["id"]; index=p["index"]; revision=p["revision"]
        started=time.perf_counter();timings={}
        def checkpoint():
            current=self.store.get("batch",id)
            page=next(x for x in current["pages"] if x["index"]==index)
            if self.stop.is_set() or current["state"]!="active" or page["revision"]!=revision: raise Stopped()
        def stage(text): checkpoint(); self.store.patch_page(id,index,revision,stage=text)
        def measure(name,fn,cpu=False):
            start=time.perf_counter()
            if cpu:
                with self.cpu:
                    timings['cpu_wait_s']=timings.get('cpu_wait_s',0)+time.perf_counter()-start
                    start=time.perf_counter();checkpoint();value=fn()
            else:value=fn()
            timings[name]=round(time.perf_counter()-start,3)
            self.store.patch_page(id,index,revision,timings=timings)
            return value
        key=digest([p["hash"],b["source"],b["target"],b["profile"],b["kind"],b["rules"],b["glossary"]])
        work=self.store.root/"cache"/key
        source=self.store.root/"images"/(p["hash"]+".png")
        try:
            checkpoint()
            if (work/"translated.png").is_file() and (work/"translated.json").is_file():
                regions=json.loads((work/"translated.json").read_text(encoding="utf8"))
                timings['artifact_reused']=True
                if apply_comic_layout(b,regions):
                    stage('本地右起竖排')
                    measure('render_s',lambda:self.vision.render(source,work,regions,checkpoint),cpu=True)
                    timings['artifact_reused']=False
                    self.store.patch_page(id,index,revision,render_version=p.get('render_version',0)+1)
            else:
                stage("本地识别")
                def detect():
                    # OCR depends on pixels and recognition rules, not the API,
                    # target language, price, prompt or typography choices.
                    shared=self.store.root/'cache'/digest([p['hash'],b['kind'],'ocr-v16'])
                    shared.mkdir(parents=True,exist_ok=True);work.mkdir(parents=True,exist_ok=True)
                    if not (shared/'regions.json').exists():
                        origin=work if b.get('rules')=='comic-v16' and (work/'regions.json').exists() else shared
                        if origin==shared:
                            # Adopt existing version-matched OCR, without editing its old output.
                            for previous in self.store.all('batch'):
                                if previous.get('kind')!=b['kind'] or previous.get('rules')!='comic-v16':continue
                                old_page=next((q for q in previous['pages'] if q.get('hash')==p['hash'] and q.get('cache_key')),None)
                                if old_page:
                                    candidate=self.store.root/'cache'/old_page['cache_key']
                                    if (candidate/'regions.json').is_file() and (candidate/'mask.png').is_file():origin=candidate;break
                        found=self.vision.detect(source,origin,b['kind'],checkpoint)
                        if origin!=shared and (origin/'mask.png').exists():shutil.copy2(origin/'mask.png',shared/'mask.png')
                        atomic_json(shared/'regions.json',found)
                        timings['ocr_reused']=origin!=shared
                    else:timings['ocr_reused']=True
                    if (shared/'mask.png').exists():shutil.copy2(shared/'mask.png',work/'mask.png')
                    found=json.loads((shared/'regions.json').read_text(encoding='utf8'))
                    atomic_json(work/'regions.json',found)
                    return found
                regions=measure('ocr_s',detect,cpu=True)
                translated=work/"text-result.json"
                if translated.exists(): regions=json.loads(translated.read_text(encoding="utf8"))
                else:
                    stage("文字翻译")
                    if b['kind']=='manga':
                        for region in regions:region.update(vertical=b['target'].startswith('zh'),column_order='rtl',layout_origin='default')
                    pieces=[]
                    for r in regions:
                        if r.get("note") or not r["source"].strip(): continue
                        offset=0
                        for part in split_text(r["source"],600):
                            pieces.append((r["id"]+":"+str(offset),part));offset+=len(part)
                    results={}
                    layouts={};by_id={region['id']:region for region in regions}
                    translation_start=time.perf_counter()
                    for n,chunk in translation_chunks(pieces,b):
                        checkpoint()
                        # Mixed-script manga can include English dialogue. Keep the same batch
                        # and budget; automatic source detection avoids forcing English through ja.
                        request_batch={**b,'source':'auto'} if any(by_id[piece.split(':')[0]].get('source_language')=='en' for piece in chunk) else b
                        if b['kind']=='manga' and b['profile']['provider']=='openai':
                            hints={piece:{'source_vertical':by_id[piece.split(':')[0]].get('vertical_source'),
                                          'source_confidence':by_id[piece.split(':')[0]].get('source_layout_confidence',.5),
                                          'source_column_order':'rtl' if b['source']=='ja' else 'unknown',
                                          'box':by_id[piece.split(':')[0]].get('content_box',by_id[piece.split(':')[0]]['box']),
                                          'fallback':'vertical-ltr' if b['target'].startswith('zh') else 'horizontal'} for piece in chunk}
                            results.update(self.translator.translate(request_batch,chunk,key+str(n),layout_hints=hints,layout_results=layouts))
                        else:results.update(self.translator.translate(request_batch,chunk,key+str(n)))
                    timings['translation_s']=round(time.perf_counter()-translation_start,3)
                    for r in regions:
                        if not r.get("note"):
                            r["translation"]="".join(results.get(key,"") for key,_ in pieces if key.startswith(r["id"]+":"))
                            modes={value['mode'] for key,value in layouts.items() if key.startswith(r['id']+':')}
                            if len(modes)==1:
                                mode=modes.pop();r.update(vertical=mode!='horizontal',column_order='rtl' if mode=='vertical-rtl' else 'ltr',layout_origin='model')
                    apply_comic_layout(b,regions)
                    atomic_json(translated,regions)
                apply_comic_layout(b,regions)
                stage("本地擦字与排版")
                measure('render_s',lambda:self.vision.render(source,work,regions,checkpoint),cpu=True)
            checkpoint()
            review=not regions or any(r.get("note") and r.get("preserve_reason")!="already_chinese" for r in regions)
            already_chinese=bool(regions) and all(r.get("preserve_reason")=="already_chinese" for r in regions)
            self.store.patch_page(id,index,revision,state="review" if review else "completed",stage="原图为中文，已保留" if already_chinese else "完成",regions=regions,cache_key=key,output=str(work/"translated.png"),error="")
        except (Stopped,BudgetStop):
            self.store.patch_page(id,index,revision,state="queued",stage="已暂停")
        except UncertainCharge:
            self.store.patch_page(id,index,revision,state="failed",stage="等待确认用量",error="请求结果未确认；先核对账单，再确认重试")
        except Exception as error:
            self.store.patch_page(id,index,revision,state="failed",stage="失败",error=str(error)[:300])
        finally:
            timings['total_s']=round(time.perf_counter()-started,3)
            timings['cpu_wait_s']=round(timings.get('cpu_wait_s',0),3)
            self.store.patch_page(id,index,revision,timings=timings)
