import type {Chapter,Batch} from './types';
import {arxivPaper} from './arxiv';
import {fetchImage} from './network';
let connection:Promise<{url:string;token:string}>|undefined;
async function engine(){
 if(!connection)connection=new Promise<any>((resolve,reject)=>chrome.runtime.sendNativeMessage('org.manga_web_translator.host',{command:'ensure'},r=>{
  if(chrome.runtime.lastError||r?.error){connection=undefined;reject(Error(r?.error||'本地引擎未安装：请先运行 Windows 安装程序。'));}else resolve(r);
 }));return connection;
}
async function api(path:string,method='GET',body?:unknown,raw?:Uint8Array):Promise<any>{
 if(!path.startsWith('/v1/'))throw Error('无效请求');
 const c=await engine();let response:Response;
 try{response=await fetch(c.url+path,{method,headers:{Authorization:'Bearer '+c.token,...(!raw&&body!==undefined?{'Content-Type':'application/json'}:{})},body:raw as any|| (body===undefined?undefined:JSON.stringify(body))});}
 catch(e){connection=undefined;throw Error('本地引擎连接中断，请重试连接；不会自动重发翻译请求。');}
 if(!response.ok){const v=await response.json().catch(()=>({}));throw Error(v.detail||'请求失败 '+response.status);}
 if(response.headers.get('content-type')?.includes('json'))return response.json();
 const bytes=new Uint8Array(await response.arrayBuffer());let str='';for(let i=0;i<bytes.length;i+=32768)str+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return {data:'data:'+response.headers.get('content-type')+';base64,'+btoa(str)};
}
const arxivIntentKey=(tabId:number)=>'arxiv-intent:'+tabId;
async function openArxiv(url:string,sender:chrome.runtime.MessageSender){
 const source=arxivPaper(sender.tab?.url||''),target=arxivPaper(url);
 if(!sender.tab?.id||source?.kind!=='abs'||target?.kind!=='html'||source.base!==target.base||source.version&&source.version!==target.version)throw Error('论文 HTML 地址无效或与当前论文版本不一致');
 const canonical='https://arxiv.org/html/'+target.id;
 // Existing arXiv access permits a new tab. ActiveTab-only users stay on the same origin/tab.
 const allowed=await chrome.permissions.contains({origins:['https://arxiv.org/*']});
 const tab=allowed?await chrome.tabs.create({url:'about:blank',active:true}):sender.tab;
 if(!tab.id)throw Error('无法打开双语阅读页');
 const key=arxivIntentKey(tab.id);
 await chrome.storage.session.set({[key]:{url:canonical,created:Date.now()}});
 try{await chrome.tabs.update(tab.id,{url:canonical,active:true});}catch(e){await chrome.storage.session.remove(key);throw e;}
 return {opened:true,newTab:allowed};
}
async function consumeArxiv(sender:chrome.runtime.MessageSender){
 if(!sender.tab?.id)return false;
 const key=arxivIntentKey(sender.tab.id),intent=(await chrome.storage.session.get(key))[key] as {url:string;created:number}|undefined;
 if(!intent)return false;await chrome.storage.session.remove(key);
 const current=arxivPaper(sender.tab.url||''),wanted=arxivPaper(intent.url||'');
 return current?.kind==='html'&&current.id===wanted?.id&&Date.now()-Number(intent.created)<120000&&Date.now()>=Number(intent.created);
}
chrome.tabs.onUpdated.addListener((id,change)=>{
 if(change.status!=='complete')return;
 void chrome.storage.session.get(arxivIntentKey(id)).then(async values=>{
  if(values[arxivIntentKey(id)])await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']});
 }).catch(()=>{});
});
chrome.tabs.onRemoved.addListener(id=>{void chrome.storage.session.remove(arxivIntentKey(id)).catch(()=>{});});
const uploads=new Set<string>();
async function uploadURL(id:string,index:number,url:string,sourceURL?:string){
 const key=id+':'+index+':'+url;if(uploads.has(key))return;uploads.add(key);
 try{
  const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||/^(localhost|127\.|169\.254\.|192\.168\.|10\.|\[)/.test(u.hostname))throw Error('不支持的图片地址');
  const response=await fetchImage(url,sourceURL);if(!response.ok)throw Error('图片读取失败 '+response.status);
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>32*1024*1024)throw Error('单张图片超过32 MB');
  return api('/v1/batches/'+id+'/pages/'+index+'/image','PUT',undefined,bytes);
 }finally{uploads.delete(key);}
}
async function chosen(){
 const {profileId}=await chrome.storage.local.get('profileId');if(profileId==='free-tencent'||profileId==='free-bing')return profileId;
 if(profileId&&(await api('/v1/profiles')).some((p:any)=>p.id===profileId))return String(profileId);
 await chrome.storage.local.set({profileId:'free-tencent'});return 'free-tencent';
}
function rank(i:number,visible:number[]=[]){const anchor=visible.length?Math.max(...visible):0;return visible.includes(i)?-10000:i>anchor&&i<=anchor+5?-5000+i:i;}
async function defaults(){
 const x=await chrome.storage.local.get('defaults');
 const d={source:'ja',target:'zh-CN',budget:{tokens:1000000,requests:1000,yuan:5},...(x.defaults as any||{})};if((await chosen()).startsWith('free-'))d.budget={characters:1000000,requests:2000};return d;
}
let pumping=false;
async function pump(){
 if(pumping)return;pumping=true;
 try{
  const chapters=(await chrome.storage.local.get('chapters')).chapters as Record<string,Chapter>||{};const batches:Batch[]=await api('/v1/batches');
  let count=0;
  for(const b of batches){
   if(b.state!=='active'||!chapters[b.id])continue;
   const chapter:Chapter=chapters[b.id];
   for(const p of b.pages.filter(p=>p.state==='waiting_image').sort((a,c)=>rank(a.index,(b as any).visible)-rank(c.index,(b as any).visible)).slice(0,3)){
    const source=chapter.pages.find(v=>v.index===p.index);if(!source||source.local)continue;
    try{
     let url=source.url;
     if(!url&&source.pageURL)url=await resolvePage(source.pageURL);
     if(url)await uploadURL(b.id,p.index,url,source.pageURL||chapter.sourceURL);
    }catch(e){await api('/v1/batches/'+b.id+'/pages/'+p.index+'/fetch-error','POST',{error:String(e)});continue;}
    if(++count>=3)return;
   }
  }
 }finally{pumping=false;}
}
async function resolvePage(url:string):Promise<string>{
 const u=new URL(url);if(!/^(www\.)?(mangabz|yymanhua)\.com$/.test(u.hostname))throw Error('该分页站尚未适配');
 const tab=await chrome.tabs.create({url,active:false});
 try{
  for(let i=0;i<30;i++){
   await new Promise(r=>setTimeout(r,650));
   const found=await chrome.scripting.executeScript({target:{tabId:tab.id!},func:()=>{
    const image=document.querySelector<HTMLImageElement>('#cp_image');return image&&image.naturalWidth>100?image.currentSrc||image.src:'';
   }}).catch(()=>[]);
   if(found[0]?.result)return found[0].result;
  }throw Error('当前页未正常加载。请在网站完成登录／验证后重试；未创建额外翻译请求。');
 }finally{await chrome.tabs.remove(tab.id!).catch(()=>{});}
}
chrome.alarms.create('queue',{periodInMinutes:.5});
chrome.alarms.onAlarm.addListener(()=>{pump().catch(()=>{});});
async function restoreFloatingRegistration(){
 // Reuse previously granted access after an unpacked-extension reload; never request new access here.
 if(!await chrome.permissions.contains({origins:['https://*/*','http://*/*']}))return;
 const registered=await chrome.scripting.getRegisteredContentScripts({ids:['floating']});
 if(!registered.length)await chrome.scripting.registerContentScripts([{id:'floating',matches:['https://*/*','http://*/*'],js:['content.js'],runAt:'document_idle',persistAcrossSessions:true}]);
}
chrome.runtime.onStartup.addListener(()=>{void restoreFloatingRegistration().catch(()=>{});});
void restoreFloatingRegistration().catch(()=>{});
chrome.runtime.onInstalled.addListener(async()=>{
 await restoreFloatingRegistration().catch(()=>{});
 const v=await chrome.storage.local.get('installedVersion');if(v.installedVersion!=='0.1.1')await chrome.storage.local.set({profileId:'free-tencent',installedVersion:'0.1.1'});
 chrome.contextMenus.removeAll(()=>chrome.contextMenus.create({id:'mwt-image',title:'用漫译翻译这张图片',contexts:['image']}));
});
chrome.contextMenus.onClicked.addListener(async(info,tab)=>{
 if(info.menuItemId==='mwt-image'&&info.srcUrl&&tab?.id){
  try{await createSingle(info.srcUrl,'image',undefined,tab.url);}catch(e){await chrome.storage.local.set({lastError:String(e)});await chrome.runtime.openOptionsPage();}
 }
});
async function createSingle(url:string,kind:string,data?:Uint8Array,sourceURL?:string){
 const profile=await chosen();const b=await api('/v1/batches','POST',{...await defaults(),chapter_id:'image:'+url,title:'图片翻译',kind,profile_id:profile,pages:[{index:0,url:data?'':url}],total:1,complete:true});
 if(data)await api('/v1/batches/'+b.id+'/pages/0/image','PUT',undefined,data);else await uploadURL(b.id,0,url,sourceURL);
 await chrome.tabs.create({url:chrome.runtime.getURL('reader.html')+'?batch='+b.id});return b;
}
async function route(msg:any,sender:chrome.runtime.MessageSender){
 if(msg.type==='arxivProvider'){
  if(arxivPaper(sender.tab?.url||'')?.kind!=='abs')throw Error('缺少 arXiv 摘要页');
  const id=await chosen();return id==='free-bing'?{provider:'bing',label:'免费 Bing'}:id==='free-tencent'?{provider:'tencent',label:'免费腾讯交互翻译'}:{provider:'api',label:'当前 API 配置（会消耗额度）'};
 }
 if(msg.type==='arxivOpen')return openArxiv(String(msg.url||''),sender);
 if(msg.type==='arxivConsume')return consumeArxiv(sender);
 const privileged=sender.url?.startsWith(chrome.runtime.getURL(''))&&!sender.tab?.url?.startsWith('http');
 if(msg.type==='api'){
  if(!privileged)throw Error('仅扩展设置页可以管理引擎配置');
  return api(msg.path,msg.method,msg.body);
 }
 if(msg.type==='inject'){
  if(!privileged)throw Error('无权限');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw Error('未找到网页');
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});return true;
 }
 if(msg.type==='preferences'){
  const list=await api('/v1/profiles');return {defaults:await defaults(),profileId:(await chrome.storage.local.get('profileId')).profileId,profiles:list.map((p:any)=>({id:p.id,name:p.name,model:p.model,provider:p.provider}))};
 }
 if(msg.type==='selectProfile'){
  if(!sender.tab?.id)throw Error('缺少来源网页');
  const list=await api('/v1/profiles');
  if(!list.some((p:any)=>p.id===msg.id&&['bing','tencent','openai','mock'].includes(p.provider)))throw Error('翻译服务不可用，请先在设置中配置');
  await chrome.storage.local.set({profileId:msg.id});return true;
 }
 if(msg.type==='savePreferences'){
  if(!sender.tab?.id)throw Error('缺少来源网页');
  const current=await defaults();
  if(!['ja','en','auto'].includes(msg.source)||!['zh-CN','zh-TW','en'].includes(msg.target)||!(Number(msg.yuan)>0))throw Error('设置无效');
  await chrome.storage.local.set({profileId:msg.profileId,defaults:{...current,confirmed:true,source:msg.source,target:msg.target,budget:{...current.budget,yuan:Number(msg.yuan)}}});return true;
 }
 if(msg.type==='start'){
  if(!sender.tab?.id)throw Error('缺少来源网页');
  const ch:Chapter={...msg.chapter,sourceURL:sender.tab.url};const b=await api('/v1/batches','POST',{...await defaults(),chapter_id:ch.id,title:ch.title,profile_id:await chosen(),pages:ch.pages,total:ch.total,complete:ch.complete,kind:'manga',visible:Array.isArray(msg.visible)?msg.visible.filter((i:number)=>ch.pages.some(p=>p.index===i)).slice(0,20):[]});
  const chapters=(await chrome.storage.local.get('chapters')).chapters as Record<string,Chapter>||{};chapters[b.id]=ch;await chrome.storage.local.set({chapters});
  if(ch.reader)await chrome.tabs.create({url:chrome.runtime.getURL('reader.html')+'?batch='+b.id});
  pump().catch(()=>{});return b;
 }
 if(msg.type==='append'){
  const chapters=(await chrome.storage.local.get('chapters')).chapters as Record<string,Chapter>||{};
  const old:Chapter=chapters[msg.id];if(!old||old.id!==msg.chapter.id)throw Error('章节已经切换');
  const merged=new Map(old.pages.map(p=>[p.index,p]));for(const p of msg.chapter.pages)merged.set(p.index,p);
  chapters[msg.id]={...msg.chapter,sourceURL:sender.tab?.url||old.sourceURL,pages:[...merged.values()]};await chrome.storage.local.set({chapters});
  return api('/v1/batches/'+msg.id+'/append','POST',{pages:msg.chapter.pages,total:msg.chapter.total,complete:msg.chapter.complete});
 }
 if(msg.type==='pagePixels'){
  const chapters=(await chrome.storage.local.get('chapters')).chapters as Record<string,Chapter>||{};
  const ch=chapters[msg.id];const source=ch?.pages.find(p=>p.index===msg.index&&p.url===msg.source&&p.local);
  if(!sender.tab?.url||!ch?.sourceURL||!source||ch.id!==msg.chapterId||new URL(sender.tab.url).origin!==new URL(ch.sourceURL).origin||new URL(sender.tab.url).pathname!==new URL(ch.sourceURL).pathname)throw Error('画面与当前章节不一致');
  if(typeof msg.data!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(msg.data)||msg.data.length>44*1024*1024)throw Error('画面格式或大小无效');
  const b:Batch=await api('/v1/batches/'+msg.id);const task=b.pages.find(p=>p.index===msg.index&&p.url===msg.source);
  if(b.state!=='active'||!task||task.hash)return false;
  const bytes=Uint8Array.from(atob(msg.data.split(',')[1]),c=>c.charCodeAt(0));
  return api('/v1/batches/'+msg.id+'/pages/'+msg.index+'/image','PUT',undefined,bytes);
 }
 if(msg.type==='status'){pump().catch(()=>{});return api('/v1/batches/'+msg.id);}
 if(msg.type==='apiAction')return api('/v1/batches/'+msg.id+'/action','POST',{action:msg.action});
 if(msg.type==='viewport')return api('/v1/batches/'+msg.id+'/action','POST',{action:'viewport',extra:{visible:msg.visible}});
 if(msg.type==='artifact')return api('/v1/batches/'+msg.id+'/pages/'+Number(msg.index)+'/'+(msg.original?'original':'translated'));
 if(msg.type==='options'){await chrome.runtime.openOptionsPage();return true;}
 if(msg.type==='reader'){await chrome.tabs.create({url:chrome.runtime.getURL('reader.html')+'?batch='+msg.id});return true;}
 if(msg.type==='export'){
  if(!privileged)throw Error('无权限');const c=await engine();return chrome.downloads.download({url:c.url+'/v1/batches/'+msg.id+'/export',headers:[{name:'Authorization',value:'Bearer '+c.token}],filename:'chapter-translated.zip',saveAs:true});
 }
 if(msg.type==='newLocal'){
  if(!privileged)throw Error('无权限');
  return api('/v1/batches','POST',{...await defaults(),chapter_id:'local:'+crypto.randomUUID(),title:msg.title||'本地图片',kind:msg.kind||'image',profile_id:await chosen(),pages:Array.from({length:Number(msg.count)},(_,index)=>({index})),total:Number(msg.count),complete:true});
 }
 if(msg.type==='localUpload'){
  if(!privileged)throw Error('无权限');const bytes=Uint8Array.from(atob(msg.data.split(',')[1]),c=>c.charCodeAt(0));
  return api('/v1/batches/'+msg.id+'/pages/'+Number(msg.index)+'/image','PUT',undefined,bytes);
 }
 if(msg.type==='localImage'){
  if(!privileged)throw Error('无权限');const bytes=Uint8Array.from(atob(msg.data.split(',')[1]),c=>c.charCodeAt(0));
  return createSingle('local:'+crypto.randomUUID(),msg.kind||'image',bytes);
 }
 if(msg.type==='capture'){
  if(!sender.tab?.id)throw Error('缺少来源页面');const [active]=await chrome.tabs.query({active:true,windowId:sender.tab.windowId});
  if(active.id!==sender.tab.id||active.url!==msg.url)throw Error('页面已改变，请重新圈选');
  const data=await chrome.tabs.captureVisibleTab(sender.tab.windowId,{format:'png'});
  const bitmap=await createImageBitmap(await(await fetch(data)).blob());const c=msg.crop;
  const sx=bitmap.width/msg.width,sy=bitmap.height/msg.height;const canvas=new OffscreenCanvas(Math.round(c.w*sx),Math.round(c.h*sy));
  canvas.getContext('2d')!.drawImage(bitmap,c.x*sx,c.y*sy,c.w*sx,c.h*sy,0,0,canvas.width,canvas.height);bitmap.close();
  return createSingle('capture:'+crypto.randomUUID(),'image',new Uint8Array(await(await canvas.convertToBlob()).arrayBuffer()));
 }
 if(msg.type==='webCapability'){const list=await api('/v1/profiles');const id=await chosen();return list.find((p:any)=>p.id===id)||{provider:'tencent'};}
 if(msg.type==='webStart'){
  const b=await api('/v1/batches','POST',{...await defaults(),chapter_id:'web:'+sender.tab?.url,title:msg.title,kind:'text',source:'auto',profile_id:await chosen(),pages:[]});
  if(b.state==='paused')return api('/v1/batches/'+b.id+'/action','POST',{action:'resume'});return b;
 }
 if(msg.type==='text')return api('/v1/batches/'+msg.id+'/text','POST',{blocks:msg.blocks,scope:msg.scope});
 throw Error('未知操作');
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{route(m,s).then(value=>reply({ok:true,value}),e=>reply({ok:false,error:String(e.message||e)}));return true;});
