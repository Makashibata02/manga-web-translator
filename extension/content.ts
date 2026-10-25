import {readerSurfaces,localPixels,surfaceStamp,pageControls,surfaceVisible} from './site-readers';
import {CanvasOverlay} from './canvas-overlay';
import {rpc,usageText,stateLabel,costText,artifactKey,type Batch,type Chapter,type Profile} from './types';
import {WebTranslation,type WebState} from './web';
import {installArxivEntry,academicPage} from './arxiv';
import {readChapter,imageSource,visibleIndices,readingScroller,isMangaReader} from './adapters';
declare global {interface Window {__mwt?:boolean}}
if(!window.__mwt){window.__mwt=true;void init();}
async function init(){
 const host=document.createElement('div');host.dataset.mwt='root';host.dataset.mwtBuild='layout-20261024-performance1';const shadow=host.attachShadow({mode:'closed'});document.documentElement.append(host);
 const style=document.createElement('style');style.textContent=":host{all:initial}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;border:1px solid #ddd;border-radius:9px;padding:8px 12px;background:white;color:#252331}#ball{position:fixed;right:20px;top:45%;z-index:2147483647;background:#6550d9;color:white;border:0;border-radius:50%;width:52px;height:52px;box-shadow:0 3px 20px #0003;font:600 17px sans-serif}#panel{position:fixed;right:24px;top:15%;z-index:2147483647;width:340px;max-height:75vh;overflow:auto;background:#fff;color:#252331;border:1px solid #ddd;border-radius:16px;padding:18px;font:14px/1.6 system-ui;box-shadow:0 12px 50px #0003}h2{font-size:18px;margin:0 0 10px}p{margin:8px 0}.actions{display:flex;flex-wrap:wrap;gap:7px}.primary{background:#6550d9;color:white}#status{white-space:pre-wrap;margin-top:12px;font-size:13px}.muted{color:#777;font-size:12px}";shadow.append(style);
 style.textContent+='select{font:inherit;color:#252331;background:#fff;border:1px solid #ddd;border-radius:8px;padding:9px;width:100%;margin:5px 0}label{display:block;font-size:13px}#panel{width:min(300px,calc(100vw - 32px))!important}#panel>p{font-size:12px;color:#777;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.actions{margin-top:8px}#toggle{flex:1}#settings{color:#666}details{margin-top:12px}summary{cursor:pointer;color:#666;font-size:12px}#status{font-size:12px;color:#666}[hidden]{display:none!important}#panel{width:min(340px,calc(100vw - 32px));top:12%;padding-top:20px}#panel h2{padding-right:30px}#close{position:absolute;right:10px;top:9px;border:0;padding:2px 8px;font:22px system-ui}#notice{position:fixed;right:84px;top:45%;z-index:2147483647;max-width:min(280px,calc(100vw - 110px));padding:10px 32px 10px 12px;background:#fff;color:#333;border:1px solid #ddd;border-radius:10px;box-shadow:0 3px 18px #0002;font:13px/1.5 system-ui;overflow-wrap:anywhere}#notice[data-error=true]{border-color:#dc9d8c}#dismiss{position:absolute;right:4px;top:4px;padding:0 6px;border:0;background:transparent}button:focus-visible{outline:2px solid #6550d9;outline-offset:3px}';
 const ball=document.createElement('button');ball.id='ball';ball.textContent='译';ball.title='点击智能翻译；右键打开菜单';shadow.append(ball);
 const panel=document.createElement('section');panel.id='panel';panel.hidden=true;shadow.append(panel);
 panel.setAttribute('aria-label','漫译操作菜单');
 const close=document.createElement('button');close.id='close';close.textContent='×';close.setAttribute('aria-label','关闭菜单');close.onclick=()=>{panel.hidden=true;};panel.append(close);
 const notice=document.createElement('div');notice.id='notice';notice.role='status';notice.setAttribute('aria-live','polite');notice.hidden=true;
 const noticeText=document.createElement('span');const dismiss=document.createElement('button');dismiss.id='dismiss';dismiss.textContent='×';dismiss.setAttribute('aria-label','收起提示');dismiss.onclick=()=>{notice.hidden=true;};notice.append(noticeText,dismiss);shadow.append(notice);
 let phase:WebState['phase']='original';
 const mangaMode=()=>isMangaReader();
 const heading=document.createElement('h2');heading.textContent=isMangaReader()?'漫译 · 漫画翻译':'漫译 · 网页翻译';panel.append(heading);
 const title=document.createElement('p');title.textContent=document.title;panel.append(title);
 const providerLabel=document.createElement('label');providerLabel.textContent='翻译服务';providerLabel.htmlFor='service';
 const service=document.createElement('select');service.id='service';service.disabled=true;service.setAttribute('aria-label','翻译服务');
 const serviceHint=document.createElement('p');serviceHint.className='muted';serviceHint.textContent='切换后点击翻译，不会自动调用服务。';
 panel.append(providerLabel,service,serviceHint);
 const actions=document.createElement('div');actions.className='actions';panel.append(actions);
 const extra=document.createElement('details');const summary=document.createElement('summary');summary.textContent='更多工具';extra.append(summary);
 const tools=document.createElement('div');tools.className='actions';tools.hidden=true;extra.ontoggle=()=>{tools.hidden=!extra.open;};extra.append(tools);panel.append(extra);
 const status=document.createElement('div');status.id='status';status.role='status';status.setAttribute('aria-live','polite');
 panel.append(status);
 let batchId='',chapter:Chapter|undefined,scanning=false,busy=false,renderEnabled=true,mangaStarting=false,displayGeneration=0,lastBatchState='',switchingService=false;
 const discovered=new Map<number,{index:number;url:string;pageURL?:string}>();let discoveredId='';
 function currentChapter():Chapter{
  const ch=readChapter();if(ch.id!==discoveredId){discovered.clear();selected.clear();discoveredId=ch.id;}
  for(const page of ch.pages)discovered.set(page.index,page);
  return {...ch,pages:[...discovered.values()].sort((a,b)=>a.index-b.index)};
 }
 const selected=new Map<number,boolean>();const applied=new WeakMap<HTMLImageElement,{translated:string;hash:string;source:string;src:string;srcset:string|null;aspect:string;aspectPriority:string}>();
 const results=new Map<string,string>();let overlay:CanvasOverlay|undefined;const pixelErrors=new Set<string>();
 const message=(text:string)=>{status.textContent=text;};
 function button(label:string,fn:()=>Promise<any>|void,primary=false,parent:HTMLElement=tools){
  const b=document.createElement('button');b.textContent=label;if(primary)b.className='primary';
  b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){message(String(e));}finally{b.disabled=false;}};parent.append(b);return b;
 }
 function feedback(text:string,state?:WebState){
  message(text);phase=state?.phase||'error';noticeText.textContent=text;notice.hidden=phase!=='error';notice.dataset.error=String(phase==='error');
  ball.textContent=phase==='error'?'!':phase==='starting'?'…':phase==='running'?String(state?.count||'…'):phase==='ready'?'原':'译';
  const label=phase==='error'?'翻译失败，点击重试':phase==='starting'||phase==='running'||phase==='ready'?'点击切回原文':'点击智能翻译';
  ball.title=label;ball.setAttribute('aria-label',label);ball.setAttribute('aria-pressed',String(web.active));primary.textContent=web.active?'显示原文':'翻译此页';
 }
 const web=new WebTranslation(feedback);
 installArxivEntry(url=>rpc('arxivOpen',{url}),()=>web.retry('dual'),()=>rpc('arxivProvider'));
 if(academicPage()==='html')void rpc('arxivConsume').then(start=>{if(start)void web.retry('dual').catch(()=>{});}).catch(()=>{});
 ball.setAttribute('aria-label','点击智能翻译');ball.setAttribute('aria-pressed','false');
 ball.onclick=async()=>{try{await toggleTranslation();}catch(e){feedback(String(e));}};
 ball.oncontextmenu=e=>{e.preventDefault();void openMenu();};
 const menu=document.createElement('button');menu.textContent='⋯';menu.title='更多操作与设置';menu.style.cssText='position:fixed;right:32px;top:calc(45% + 58px);z-index:2147483647;width:28px;height:24px;padding:0;border-radius:10px;background:white;color:#555';shadow.append(menu);
 menu.setAttribute('aria-label','更多操作与设置');
 menu.onclick=()=>{void openMenu();};
 document.addEventListener('pointerdown',e=>{if(!e.composedPath().includes(host))panel.hidden=true;});
 window.addEventListener('keydown',e=>{if(e.key==='Escape')panel.hidden=true;});
 function syncMenu(){
  const manga=mangaMode();heading.textContent='漫译';title.textContent=document.title;
  for(const b of tools.querySelectorAll<HTMLElement>('[data-manga]'))b.hidden=!manga;
  webModeLabel.hidden=manga;
  if(manga)updateMangaButton();else primary.textContent=web.active?'显示原文':'翻译此页';
 }
 async function openMenu(){
  panel.hidden=!panel.hidden;if(panel.hidden)return;syncMenu();
  try{await loadServices();}catch(e){message(String(e));}
 }
 let profiles:Profile[]=[],selectedProfile='';
 function profileHint(){const p=profiles.find(p=>p.id===service.value);serviceHint.textContent=p?.provider==='openai'?'API 会消耗额度，点击翻译后才调用。':'切换后点击翻译，不会自动调用服务。';}
 async function loadServices(){
  const value=await rpc('preferences');profiles=value.profiles;selectedProfile=value.profileId||'free-tencent';service.replaceChildren();
  const add=(id:string,label:string)=>{const option=document.createElement('option');option.value=id;option.textContent=label;service.append(option);};
  add('free-tencent','免费腾讯（实验性）');add('free-bing','免费 Bing（实验性）');
  for(const p of profiles.filter(p=>p.provider==='openai'||p.provider==='mock'&&p.id===selectedProfile))add(p.id,p.name+(p.model?' · '+p.model:''));
  if(!profiles.some(p=>p.provider==='openai'))add('__settings__','配置 DeepSeek…');
  service.value=[...service.options].some(o=>o.value===selectedProfile)?selectedProfile:'free-tencent';service.disabled=false;profileHint();
 }
 service.onchange=async()=>{
  const next=service.value;if(next==='__settings__'){service.value=selectedProfile;try{await rpc('options');}catch(e){message(String(e));}return;}
  if(next===selectedProfile)return;service.disabled=true;switchingService=true;primary.disabled=true;
  try{
   await rpc('selectProfile',{id:next});selectedProfile=next;
   const old=batchId,oldChapter=chapter?.id;await setMangaVisible(false);web.resetProfile();if(oldChapter)await chrome.storage.local.remove('chapter:'+oldChapter);
   batchId='';chapter=undefined;results.clear();pixelErrors.clear();lastBatchState='';
   if(old){const b:Batch=await rpc('status',{id:old});if(b.state==='active')await rpc('apiAction',{id:old,action:'pause'});}
   message('服务已切换。点击翻译后开始，原任务用量保留。');
  }catch(e){message(String(e));}finally{switchingService=false;service.disabled=false;service.value=selectedProfile;primary.disabled=false;profileHint();syncMenu();}
 };
 function updateMangaButton(b?:Batch){
  if(b)lastBatchState=b.state;
  const active=!!batchId&&chapter?.id===currentChapter().id;
  ball.textContent=!active||!renderEnabled?'译':b?.state==='active'?b.pages.filter(p=>['completed','review'].includes(p.state)).length+'/'+b.pages.length:'原';
  ball.style.fontSize=active&&renderEnabled&&lastBatchState==='active'?'13px':'17px';
  const label=!active?'点击翻译本章':renderEnabled?'点击显示原图':'点击显示译图';
  ball.title=label;ball.setAttribute('aria-label',label);ball.setAttribute('aria-pressed',String(active&&renderEnabled));
  primary.textContent=!active?'翻译本章':renderEnabled?'显示原图':'显示译图';
 }
 async function setMangaVisible(show:boolean){
  renderEnabled=show;displayGeneration++;notice.hidden=true;
  if(!show){
   overlay?.clear();
   for(const im of document.images){const value=applied.get(im);if(!value)continue;
    // Restore only our output. A website may already have reused this node for another page.
    if(im.src===value.translated){im.src=value.src;if(value.srcset===null)im.removeAttribute('srcset');else im.setAttribute('srcset',value.srcset);if(value.aspect)im.style.setProperty('aspect-ratio',value.aspect,value.aspectPriority);else im.style.removeProperty('aspect-ratio');}
    if(im.dataset.mwtSource===value.source)im.removeAttribute('data-mwt-source');applied.delete(im);
   }
  }
  updateMangaButton();
  const id=chapter?.id;if(id)await chrome.storage.local.set({['chapter-view:'+id]:show});
 }
 async function toggleTranslation(){
  if(switchingService||mangaStarting)return;
  if(!mangaMode()){if(web.active)web.restore();else await web.retry(webMode.value as 'dual'|'mono');return;}
  if(!batchId||chapter?.id!==currentChapter().id){await startManga();await tick();}
  else{await setMangaVisible(!renderEnabled);if(renderEnabled)await tick();}
 }
 async function startManga(){
  if(mangaStarting)return;mangaStarting=true;
  try{
  const current=currentChapter();current.pages=current.pages.filter(p=>selected.get(p.index)!==false);
  if(!current.pages.length)throw Error(current.note||'尚未发现漫画图片，请等待加载或扫描本章');
  if(current.complete)current.total=current.pages.length;
  displayGeneration++;renderEnabled=true;chapter=current;const b:Batch=await rpc('start',{chapter:current,visible:visibleIndices(current)});batchId=b.id;
  await chrome.storage.local.set({['chapter:'+current.id]:b.id,['chapter-view:'+current.id]:true});updateMangaButton(b);message('已自动加入本章队列，可以继续阅读。');
  }finally{mangaStarting=false;}
 }
 const primary=button('翻译此页',()=>toggleTranslation(),true,actions);primary.id='toggle';
 const webModeLabel=document.createElement('label');webModeLabel.textContent='网页显示';const webMode=document.createElement('select');webMode.id='web-mode';webMode.setAttribute('aria-label','网页显示');
 for(const [value,label]of [['dual','双语'],['mono','仅译文']]){const option=document.createElement('option');option.value=value;option.textContent=label;webMode.append(option);}webModeLabel.append(webMode);tools.append(webModeLabel);
 webMode.onchange=()=>{if(web.active)void web.retry(webMode.value as 'dual'|'mono').catch(e=>message(String(e)));};
 const settings=button('设置',()=>rpc('options'),false,actions);settings.id='settings';
 const scanButton=button('扫描本章',async()=>{
  if(scanning){scanning=false;return;}scanning=true;
  const initial=currentChapter().id;const scroller=readingScroller();const start=scroller.scrollTop,startX=scroller.scrollLeft;const controls=pageControls();const startingPages=visibleIndices(currentChapter());let steps=0;const horizontal=scroller.scrollWidth>scroller.clientWidth+5&&scroller.scrollHeight<=scroller.clientHeight+5;
  const anchor=[...document.querySelectorAll<HTMLImageElement|HTMLCanvasElement>('img,canvas')].find(im=>im.getBoundingClientRect().bottom>0&&im.height>100);
  const offset=anchor?.getBoundingClientRect().top,offsetX=anchor?.getBoundingClientRect().left;let stable=0,previous=-1;
  message('正在扫描本章；再次点击或按 Esc 停止。');scanButton.disabled=false;
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')scanning=false;};window.addEventListener('keydown',escape);
  try{
   for(let pass=0;scanning&&pass<300;pass++){
    if(currentChapter().id!==initial)break;
    const ch=currentChapter();if(batchId&&chapter?.id===ch.id)await rpc('append',{id:batchId,chapter:filtered(ch)});
    if(ch.complete&&!ch.pages.some(p=>p.local))break;
    if(batchId&&chapter?.id===ch.id)await tick();
    const old=controls?visibleIndices(ch).join(','):horizontal?scroller.scrollLeft:scroller.scrollTop;if(controls){controls.next.click();steps++;}else if(horizontal)scroller.scrollLeft+=(getComputedStyle(scroller).direction==='rtl'?-1:1)*Math.max(300,scroller.clientWidth*.8);else scroller.scrollTop+=Math.max(300,scroller.clientHeight*.8);
    await new Promise(r=>setTimeout(r,700));
    const count=ch.pages.length;stable=count===previous&&old===(controls?visibleIndices(currentChapter()).join(','):horizontal?scroller.scrollLeft:scroller.scrollTop)?stable+1:0;previous=count;
    if(stable>=4)break;
   }
  }finally{
   scanning=false;window.removeEventListener('keydown',escape);
   if(controls&&currentChapter().id===initial)for(let i=0;i<steps;i++){if(startingPages.some(v=>visibleIndices(currentChapter()).includes(v)))break;controls.previous.click();await new Promise(r=>setTimeout(r,250));}
   if(currentChapter().id===initial){scroller.scrollTop=start;scroller.scrollLeft=startX;if(anchor?.isConnected&&offset!==undefined){scroller.scrollTop+=anchor.getBoundingClientRect().top-offset;if(offsetX!==undefined)scroller.scrollLeft+=anchor.getBoundingClientRect().left-offsetX;}}
   message(currentChapter().complete?'本章清单已发现完整。':'扫描已停止；未确认章尾，后续图片仍会持续发现。');
  }
 });
 scanButton.dataset.manga='true';
 scanButton.title='预加载尚未出现的页面，补充同一章节队列；已完成页面复用结果，不重复翻译。手动滚动阅读时无需扫描。';
 const taskButton=button('连续阅读 / 任务',async()=>{if(!batchId)throw Error('请先翻译本章');await rpc('reader',{id:batchId});});taskButton.dataset.manga='true';
 taskButton.title='打开已发现页面的连续阅读与任务进度；未完成页面先显示原图。不会另建任务。';
 const scanHelp=document.createElement('p');scanHelp.className='muted';scanHelp.dataset.manga='true';scanHelp.textContent='扫描＝提前加载未出现的页；连续阅读＝查看同一任务，不会重复翻译。正常向下阅读无需先扫描。';tools.append(scanHelp);
 button('暂停',async()=>{if(batchId)await rpc('apiAction',{id:batchId,action:'pause'});else web.pause();});
 button('圈选翻译',()=>capture());
 syncMenu();
 async function capture(){
  panel.hidden=true;const overlay=document.createElement('div');overlay.dataset.mwt='capture';Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'2147483647',cursor:'crosshair',background:'#0002'});
  const frame=document.createElement('div');Object.assign(frame.style,{position:'absolute',border:'2px solid #6550d9',background:'#fff2'});overlay.append(frame);document.documentElement.append(overlay);
  const width=innerWidth,height=innerHeight,scroll=scrollY;let x=0,y=0,down=false;
  overlay.onpointerdown=e=>{x=e.clientX;y=e.clientY;down=true;};
  overlay.onpointermove=e=>{if(down)Object.assign(frame.style,{left:Math.min(x,e.clientX)+'px',top:Math.min(y,e.clientY)+'px',width:Math.abs(e.clientX-x)+'px',height:Math.abs(e.clientY-y)+'px'});};
  const cancel=(e:KeyboardEvent)=>{if(e.key==='Escape'){overlay.remove();window.removeEventListener('keydown',cancel);}};
  window.addEventListener('keydown',cancel);
  overlay.onpointerup=async e=>{
   overlay.remove();window.removeEventListener('keydown',cancel);ball.hidden=true;
   try{
    if(innerWidth!==width||innerHeight!==height||scrollY!==scroll)throw Error('页面位置变化，请重新圈选');
    const crop={x:Math.min(x,e.clientX),y:Math.min(y,e.clientY),w:Math.abs(e.clientX-x),h:Math.abs(e.clientY-y)};
    if(crop.w<10||crop.h<10)throw Error('圈选区域太小');
    await new Promise(r=>setTimeout(r,80));await rpc('capture',{crop,width,height,url:location.href});
   }catch(e){panel.hidden=false;message(String(e));}finally{ball.hidden=false;}
  };
 }
 function filtered(ch:Chapter){const copy={...ch,pages:ch.pages.filter(p=>selected.get(p.index)!==false)};if(copy.complete)copy.total=copy.pages.length;return copy;}
 let tickWork:Promise<void>|undefined;
 function tick():Promise<void>{if(tickWork)return tickWork;tickWork=runTick().finally(()=>{tickWork=undefined;});return tickWork;}
 async function runTick(){
  if(busy||!batchId)return;busy=true;const renderBatch=batchId,renderToken=displayGeneration;
  try{
   const ch=currentChapter();if(ch.id!==chapter?.id){await setMangaVisible(false);batchId='';chapter=undefined;results.clear();overlay?.clear();pixelErrors.clear();updateMangaButton();return;}
   await rpc('append',{id:renderBatch,chapter:filtered(ch)});if(document.visibilityState==='visible')await rpc('viewport',{id:renderBatch,visible:visibleIndices(ch)});
   const b:Batch=await rpc('status',{id:renderBatch});if(batchId!==renderBatch||currentChapter().id!==ch.id)return;
   message('已发现 '+b.pages.length+(b.total?' / '+b.total:'')+' 页'+(!b.complete?' · 章尾待确认':'')+' · 完成 '+b.pages.filter(p=>['completed','review'].includes(p.state)).length+'\n'+stateLabel(b.state)+' · '+usageText(b)+(' · '+costText(b))+(b.error?'\n'+b.error:''));
   const surfaces=readerSurfaces(ch);overlay?.reconcile(surfaces);
   let localUploads=0;
   if(b.state==='active'&&document.visibilityState==='visible')for(const surface of surfaces.filter(s=>s.page.local)){
    const task=b.pages.find(p=>p.index===surface.page.index);if(task?.hash||pixelErrors.has(surface.page.url))continue;
    try{const data=await localPixels(surface);if(data&&batchId===renderBatch&&currentChapter().id===ch.id&&surfaceStamp(surface.element)===surface.stamp){await rpc('pagePixels',{id:renderBatch,chapterId:ch.id,index:surface.page.index,source:surface.page.url,data});if(++localUploads>=2)break;}}
    catch(e){pixelErrors.add(surface.page.url);message('当前画面无法直接读取，未提交翻译请求。可使用圈选翻译。');}
   }
   if(renderEnabled)for(const surface of surfaces.filter(s=>s.page.local)){
    const task=b.pages.find(p=>p.index===surface.page.index);if(!task?.output)continue;
    const r=surface.element.getBoundingClientRect();if(!surfaceVisible(surface.element))continue;
    const key=artifactKey(b,task);
    let data=results.get(key);if(!data){data=(await rpc('artifact',{id:renderBatch,index:surface.page.index})).data;results.set(key,data!);if(results.size>12)results.delete(results.keys().next().value!);}
    if(renderEnabled&&renderToken===displayGeneration&&batchId===renderBatch&&currentChapter().id===ch.id&&surfaceStamp(surface.element)===surface.stamp){overlay??=new CanvasOverlay();overlay.show(surface,data!,key);}
   }
   updateMangaButton(b);
   for(const im of document.images){
    if(!renderEnabled||renderToken!==displayGeneration||batchId!==renderBatch)break;
    if(im.closest('[data-mwt]'))continue;
    const old=applied.get(im);if(old&&im.src!==old.translated){applied.delete(im);im.removeAttribute('data-mwt-source');}
    const p=ch.pages.find(p=>p.url===imageSource(im));if(!p)continue;
    const task=b.pages.find(v=>v.index===p.index);if(!task?.output)continue;
    const rect=im.getBoundingClientRect();if(rect.bottom< -innerHeight||rect.top>innerHeight*2)continue;
    const renderKey=artifactKey(b,task);
    if(applied.get(im)?.hash===renderKey)continue;
    const source=imageSource(im);const key=renderKey;
    let data=results.get(key);if(!data){data=(await rpc('artifact',{id:renderBatch,index:p.index})).data;results.set(key,data!);if(results.size>12)results.delete(results.keys().next().value!);}
    if(!renderEnabled||renderToken!==displayGeneration||batchId!==renderBatch||imageSource(im)!==source||currentChapter().id!==ch.id)continue;
    const previous=applied.get(im);applied.set(im,{translated:data!,hash:renderKey,source,src:previous?.src||(/(?:transparen|placeholder|loading|spacer)/i.test(im.src)?source:im.src||source),srcset:previous?previous.srcset:im.getAttribute('srcset'),aspect:previous?previous.aspect:im.style.getPropertyValue('aspect-ratio'),aspectPriority:previous?previous.aspectPriority:im.style.getPropertyPriority('aspect-ratio')});im.dataset.mwtSource=source;
    const w=im.naturalWidth,h=im.naturalHeight;if(w&&h)im.style.aspectRatio=w+'/'+h;
    im.removeAttribute('srcset');im.src=data!;
   }
  }catch(e){message(String(e));}finally{busy=false;}
 }
 const initial=currentChapter();const saved=await chrome.storage.local.get(['chapter:'+initial.id,'excluded:'+initial.id,'chapter-view:'+initial.id]);for(const index of (saved['excluded:'+initial.id] as number[]||[]))selected.set(index,false);
 if(saved['chapter:'+initial.id]&&isMangaReader()){chapter=initial;batchId=String(saved['chapter:'+initial.id]);renderEnabled=saved['chapter-view:'+initial.id]!==false;updateMangaButton();}
 setInterval(()=>void tick(),1700);
 let debounce:number|undefined;new MutationObserver(()=>{clearTimeout(debounce);debounce=window.setTimeout(()=>void tick(),400);}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src','srcset','data-src','data-original','data-lazy-src','data-url','data-srcset','data-index','data-page','data-page-index','data-page-number','data']});
}
