import {rpc,usageText,stateLabel,costText,phaseText,type Batch,type Profile,type TaskPage} from './types';
const main=document.querySelector('main')!;
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const x=document.createElement(tag);x.textContent=text;return x;};
const status=el('p');status.role='status';status.className='status';status.setAttribute('aria-live','polite');
function action(label:string,fn:()=>Promise<any>,parent:HTMLElement=main){const wrap=el('div');wrap.className='action';const b=el('button',label);const feedback=el('p');feedback.role='status';wrap.append(b,feedback);parent.append(wrap);b.onclick=async()=>{b.disabled=true;feedback.textContent='处理中…';try{const result=await fn();feedback.textContent=typeof result==='string'?result:'完成';}catch(e){feedback.textContent=String(e);}finally{b.disabled=false;}};return b;}
const api=(path:string,method='GET',body?:unknown)=>rpc('api',{path,method,body});
const path=location.pathname;
if(path.endsWith('popup.html')){
 main.append(el('h1','漫译'),el('p','本地识别，整章翻译，连续阅读。'));
 action('打开当前页翻译面板',()=>rpc('inject'));action('设置与本地图片',()=>rpc('options'));
}else if(path.endsWith('settings.html'))void settings();else void reader();
async function settings(){
 main.append(el('h1','漫译 · 0.1.1'),el('p','默认免费。兼容 API 只需地址、模型名和 Key；图片识别与擦字留在本机。'));
 const config=el('section');main.append(config);config.append(el('h2','翻译服务'));
 const provider=el('select');provider.id='provider';
 for(const [v,n]of [['tencent','免费腾讯交互翻译（实验性、免 Key）'],['bing','免费 Bing 网页翻译（实验性、免 Key）'],['openai','DeepSeek / OpenAI 兼容 API']]){const o=el('option',n);o.value=v;provider.append(o);}
 const pl=el('label','选择服务');pl.append(provider);config.append(pl);
 const apiFields=el('div');apiFields.id='api-fields';apiFields.hidden=true;config.append(apiFields);
 const saved=el('select');saved.id='profile-select';const sl=el('label','已保存的配置');sl.append(saved);const savedRow=el('div');savedRow.className='saved-profile-row';savedRow.append(sl);apiFields.append(savedRow);
 function field(parent:HTMLElement,label:string,id:string,value='',type='text'){const l=el('label',label),i=el('input');i.id=id;i.type=type;i.value=value;if(type==='number'){i.step='0.01';i.min='0';}l.htmlFor=id;l.append(i);parent.append(l);return i;}
 const name=field(apiFields,'配置名称（可选）','profile-name');name.placeholder='例如：漫画用 DeepSeek；留空使用模型名';
 const endpoint=field(apiFields,'API 地址','endpoint','https://api.deepseek.com');endpoint.placeholder='https://api.example.com/v1';
 const model=field(apiFields,'模型名','model','deepseek-flash');model.placeholder='填写服务商提供的模型名';
 const key=field(apiFields,'API Key','api-key','','password');key.autocomplete='off';key.placeholder='新配置需填写；已有配置留空保留 Key';
 const hint=el('p');hint.className='hint';config.append(hint);
 const buttons=el('div');buttons.className='config-actions';config.append(buttons);
 const detail=el('details');detail.append(el('summary','高级选项（可选）'));main.append(detail);
 const pricing=el('select');pricing.id='pricing-mode';for(const [v,n]of [['auto','自动估算（无需填写价格）'],['manual','手动填写估算价格']]){const o=el('option',n);o.value=v;pricing.append(o);}
 const pricingLabel=el('label','费用估算');pricingLabel.append(pricing);detail.append(pricingLabel);
 const inputPrice=field(detail,'输入估算单价（元 / 百万 tokens）','input-price','','number'),outputPrice=field(detail,'输出估算单价（元 / 百万 tokens）','output-price','','number');
 const priceNote=el('p');priceNote.className='hint';detail.append(priceNote);
 const amount=field(detail,'每任务估算金额上限（元；仅有单价时有效）','amount','5','number');
 const promptLabel=el('label','补充提示词（API）'),prompt=el('textarea');prompt.id='prompt';promptLabel.append(prompt);detail.append(promptLabel);
 const target=el('select');for(const [v,n]of [['zh-CN','简体中文'],['zh-TW','繁体中文'],['en','英语']]){const o=el('option',n);o.value=v;target.append(o);}const tl=el('label','目标语言');tl.append(target);detail.append(tl);
 const glossary=el('textarea');glossary.placeholder='每行一个：原词=译名（API）';const gl=el('label','固定称呼 / 术语');gl.append(glossary);detail.append(gl);
 let existing:Profile|undefined,list:Profile[]=[],caps:any={deepseek:{endpoint:'https://api.deepseek.com',model:'deepseek-flash'},pricing_presets:{'deepseek-flash':[2,8]},price_checked:'2026-10-24'};
 const stored=await chrome.storage.local.get(['defaults','profileId']),defaults=stored.defaults as any||{};
 amount.value=String(defaults.budget?.yuan||5);target.value=defaults.target||'zh-CN';glossary.value=Object.entries(defaults.glossary||{}).map(([a,b])=>a+'='+b).join('\n');
 function updateList(id?:string){saved.replaceChildren();const fresh=el('option','＋ 新增配置');fresh.value='';saved.append(fresh);for(const p of list.filter(p=>p.provider==='openai')){const o=el('option',p.name+' · '+p.model);o.value=p.id;saved.append(o);}saved.value=id||'';}
 function clearFeedback(){for(const p of config.querySelectorAll<HTMLElement>('[role=status]'))p.textContent='';}
 function show(p?:Profile){clearFeedback();existing=p;name.value=p?.name||'';endpoint.value=p?.endpoint||caps.deepseek.endpoint;model.value=p?.model||caps.deepseek.model;key.value='';prompt.value=p?.prompt||'';pricing.value=p?.pricing_mode||(p?.input_yuan_per_million!=null&&p?.output_yuan_per_million!=null?'manual':'auto');inputPrice.value=p?.input_yuan_per_million==null?'':String(p.input_yuan_per_million);outputPrice.value=p?.output_yuan_per_million==null?'':String(p.output_yuan_per_million);saved.value=p?.id||'';change();}
 function knownRate(){if(pricing.value==='manual')return inputPrice.value!==''&&outputPrice.value!=='';try{const u=new URL(endpoint.value.trim().replace(/\/chat\/completions\/?$/,''));return u.protocol==='https:'&&u.hostname==='api.deepseek.com'&&(!u.port||u.port==='443')&&['','/v1'].includes(u.pathname.replace(/\/$/,''))&&!!caps.pricing_presets[model.value.trim()];}catch{return false;}}
 function change(){const paid=provider.value==='openai',known=knownRate();apiFields.hidden=!paid;pricingLabel.hidden=!paid;priceNote.hidden=!paid;for(const input of [inputPrice,outputPrice]){input.parentElement!.hidden=!paid||pricing.value!=='manual';input.disabled=!paid||pricing.value!=='manual';}for(const input of [prompt,glossary])input.disabled=!paid;pricing.disabled=!paid;amount.disabled=!paid||!known;amount.parentElement!.hidden=!paid;
  copy.parentElement!.hidden=!paid||!existing;remove.hidden=!paid||!existing;
  priceNote.textContent=known?(pricing.value==='manual'?'按手填单价估算，实际以服务账单为准。':'费用仅为估算；官方 DeepSeek 按高峰未缓存价格保守估计（'+caps.price_checked+'核验），实际以服务账单为准。'):'此接口或模型没有内置单价。可不填价格，按 token／请求次数保护；无法估算或执行人民币上限。';
  hint.textContent=paid?(known?'仅发送文字。保存不调用模型；保存并测试仅发一次短文本，保留估算金额、token与请求上限。':'仅发送文字。无需填写价格；费用未估算，保留默认100万 tokens／1000次请求上限。测试只发一次短文本，可能产生服务费用。'):'实验性免费接口，无需 Key。仅按字符和请求次数统计；限流时暂停，不会切换收费服务。';
 }
 provider.onchange=()=>{clearFeedback();change();};saved.onchange=()=>show(list.find(p=>p.id===saved.value));for(const input of [pricing,endpoint,model,inputPrice,outputPrice])input.addEventListener(input===pricing?'change':'input',()=>{clearFeedback();change();});name.oninput=clearFeedback;key.oninput=clearFeedback;
 async function save(asNew=false){
  const paid=provider.value==='openai';
  const value=paid?{provider:'openai',id:asNew?undefined:existing?.id,existing_id:existing?.id,name:name.value.trim()||model.value.trim(),key:key.value,endpoint:endpoint.value.trim(),model:model.value.trim(),pricing_mode:pricing.value,...(pricing.value==='manual'?{input_yuan_per_million:inputPrice.value===''?null:Number(inputPrice.value),output_yuan_per_million:outputPrice.value===''?null:Number(outputPrice.value)}:{}),prompt:prompt.value,max_output:existing?.max_output||4096}:{provider:provider.value};
  if(paid&&(!endpoint.value.trim()||!model.value.trim()))throw Error('请填写 API 地址和模型名');
  const p:Profile=await api('/v1/profiles','POST',value);key.value='';
  await chrome.storage.local.set({profileId:p.id,defaults:{...defaults,source:defaults.source||'ja',target:target.value,budget:{...defaults.budget,tokens:defaults.budget?.tokens||1000000,requests:paid?1000:2000,characters:1000000,yuan:Number(amount.value)||5},glossary:paid?Object.fromEntries(glossary.value.split('\n').filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1).trim()];})): {}}});
  list=await api('/v1/profiles');updateList(p.id);if(paid)show(p);return p;
 }
 action('保存配置',async()=>{const p=await save();return '已保存：'+p.name+'；未调用翻译服务。';},buttons);
 action('保存并测试连接',async()=>{
  const p=await save();
  if(!await chrome.permissions.contains({origins:['https://*/*','http://*/*']})){
   const granted=await chrome.permissions.request({origins:['https://*/*','http://*/*']});
   if(granted){await chrome.scripting.unregisterContentScripts({ids:['floating']}).catch(()=>{});await chrome.scripting.registerContentScripts([{id:'floating',matches:['https://*/*','http://*/*'],js:['content.js'],runAt:'document_idle',persistAcrossSessions:true}]);}
  }
  const result=await api('/v1/profiles/'+p.id+'/test','POST');
  return '连接成功：'+result.translation+' · '+(p.provider==='openai'?result.usage.tokens+' tokens · '+(result.cost_known===false?'费用未估算':'估算 ¥'+result.usage.yuan.toFixed(4)):result.usage.characters+' 字符 · '+result.usage.requests+' 次请求');
 },buttons);
 const copy=action('另存为新配置',async()=>{const p=await save(true);return '已另存：'+p.name+'；旧配置和任务保持不变。';},buttons);copy.parentElement!.hidden=true;
 const remove=action('删除配置',async()=>{
  const p=existing;if(!p)throw Error('请先选择要删除的配置');
  if(!confirm('删除配置「'+p.name+'」？\n从可选模型列表移除；相关运行任务会暂停，已有请求正常结算。历史任务、译文、Key 和累计用量保留，旧任务可手动继续。'))return '已取消删除。';
  const removed=await api('/v1/profiles/'+encodeURIComponent(p.id),'DELETE');
  const current=(await chrome.storage.local.get('profileId')).profileId;const wasCurrent=current===p.id;
  if(wasCurrent)await chrome.storage.local.set({profileId:'free-tencent'});
  list=await api('/v1/profiles');const next=wasCurrent?undefined:list.find(p=>p.id===current&&p.provider==='openai');updateList(next?.id);show(next);
  return '已删除：'+p.name+'。'+(wasCurrent?'当前翻译服务已切换为免费腾讯；':'')+(removed.paused_tasks?'已暂停 '+removed.paused_tasks+' 个相关任务；':'')+'历史任务和用量保留，旧任务可手动继续。';
 },savedRow);remove.id='delete-profile';remove.className='danger';remove.hidden=true;
 try{
  caps=await api('/v1/capabilities');list=await api('/v1/profiles');updateList();
  const selected=list.find(p=>p.id===stored.profileId);provider.value=selected&&['bing','tencent','openai'].includes(selected.provider)?selected.provider:'tencent';
  show(selected?.provider==='openai'?selected:[...list].reverse().find(p=>p.provider==='openai'));
 }catch(e){change();hint.textContent=String(e)+'。请先运行匹配的安装程序，再重新打开设置。';}
 const tools=el('details');tools.append(el('summary','本地图片与任务'));main.append(tools);
 const input=el('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.multiple=true;tools.append(input);
 const kind=el('select');for(const [v,n]of [['manga','日文漫画'],['image','普通图片']]){const o=el('option',n);o.value=v;kind.append(o);}tools.append(kind);
 action('翻译本地图片',async()=>{const files=[...input.files||[]];if(!files.length)throw Error('请先选择图片');const b=await rpc('newLocal',{count:files.length,title:files[0].name,kind:kind.value});for(const [index,file]of files.entries()){const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(file);});await rpc('localUpload',{id:b.id,index,data});}await rpc('reader',{id:b.id});},tools);
 action('允许网页显示悬浮球',async()=>{
  const allowed=await chrome.permissions.request({origins:['https://*/*','http://*/*']});if(!allowed)throw Error('未授权，可从工具栏启动当前页');
  await chrome.scripting.unregisterContentScripts({ids:['floating']}).catch(()=>{});
  await chrome.scripting.registerContentScripts([{id:'floating',matches:['https://*/*','http://*/*'],js:['content.js'],runAt:'document_idle',persistAcrossSessions:true}]);
 },tools);
 action('刷新任务列表',async()=>{const old=tools.querySelector('[data-tasks]');old?.remove();const rows=el('div');rows.dataset.tasks='true';for(const b of await api('/v1/batches') as Batch[]){const a=el('a',b.title+' · '+stateLabel(b.state));a.href='reader.html?batch='+b.id;rows.append(a,el('br'));}tools.append(rows);},tools);
}
async function reader(){
 const id=new URLSearchParams(location.search).get('batch');if(!id){main.textContent='缺少章节任务，请从漫画页启动。';return;}
 const header=el('header');header.className='reader-header';main.append(header);
 const bar=el('div');bar.className='reader-bar';const title=el('h1','连续阅读');
 const toggle=el('button','展开工具');toggle.className='reader-toggle';toggle.setAttribute('aria-controls','reader-tools');toggle.setAttribute('aria-expanded','false');
 bar.append(title,toggle);header.append(bar,status);
 const controls=el('div');controls.id='reader-tools';controls.className='controls';controls.hidden=true;header.append(controls);
 toggle.onclick=()=>{controls.hidden=!controls.hidden;toggle.setAttribute('aria-expanded',String(!controls.hidden));toggle.textContent=controls.hidden?'展开工具':'收起工具';};
 let original=false,refreshing=false;let batch:Batch|undefined;
 const cards=new Map<number,{root:HTMLElement,img:HTMLImageElement,info:HTMLElement,hash:string}>();
 action('原图 / 译图',async()=>{original=!original;for(const c of cards.values())c.hash='';await update();},controls);
 for(const [label,op]of [['暂停','pause'],['继续','resume'],['重试失败页','retry'],['取消任务','cancel']]){
  action(label,async()=>{await api('/v1/batches/'+id+'/action','POST',{action:op});await update();},controls);
 }
 action('追加额度',async()=>{
  if(batch?.usage_kind==='characters'){
   if(!confirm('为本任务追加100万字符、2000次免费请求？'))return;
   await api('/v1/batches/'+id+'/action','POST',{action:'extend',extra:{characters:1000000,requests:2000}});await update();return;
  }
  if(batch?.cost_known===false){if(!confirm('为本任务追加100万 tokens、1000次请求？本接口未配置单价，无法限制人民币费用。'))return;await api('/v1/batches/'+id+'/action','POST',{action:'extend',extra:{tokens:1000000,requests:1000}});await update();return;}
  const amount=prompt('本章追加金额（元）；同时追加100万 tokens、1000次请求','5');if(amount===null)return;if(!(Number(amount)>0))throw Error('请输入正数');
  await api('/v1/batches/'+id+'/action','POST',{action:'extend',extra:{tokens:1000000,requests:1000,yuan:Number(amount)}});await update();
 },controls);
 const unknownButton=action('确认未知用量',async()=>{
  if(!confirm('请先核对服务账单。未知请求按完整预留保留额度；确认后可以手动重试，可能再次收费。'))return;
  await api('/v1/batches/'+id+'/action','POST',{action:'acknowledge'});await update();
 },controls);
 action('导出已完成图片',async()=>{await rpc('export',{id});},controls);
 const jump=el('input');jump.type='number';jump.min='1';jump.placeholder='跳转页码';controls.append(jump);
 action('跳转',async()=>{cards.get(Number(jump.value)-1)?.root.scrollIntoView();},controls);
 const list=el('div');list.className='pages';main.append(list);
 async function edit(p:TaskPage){
  const dialog=el('dialog');dialog.append(el('h2','编辑译文 · 不重复调用翻译模型'));const rows:{id:string;input:HTMLTextAreaElement;vertical:HTMLInputElement;order:HTMLSelectElement;size:HTMLInputElement;keep:HTMLInputElement;box:HTMLInputElement[]}[]=[];
  for(const r of p.regions||[]){
   const block=el('section');block.append(el('p',r.source));const input=el('textarea');input.value=r.translation;
   const vl=el('label','竖排');const vertical=el('input');vertical.type='checkbox';vertical.checked=r.vertical;vl.append(vertical);
   const ol=el('label','竖排列顺序'),order=el('select');for(const [value,label]of [['rtl','从右到左'],['ltr','从左到右']]){const option=el('option',label);option.value=value;order.append(option);}order.value=r.column_order||'rtl';order.disabled=!vertical.checked;vertical.onchange=()=>{order.disabled=!vertical.checked;};ol.append(order);
   const size=el('input');size.type='number';size.min='8';size.max='120';size.value=String(r.font_size||32);
   const keep=el('input');keep.type='checkbox';keep.checked=!!r.note;const kl=el('label','保留原图区域');kl.append(keep);
   const coords=el('div');coords.append(el('p','排版区域：左、上、右、下（像素）；不会修改原图擦字蒙版'));
   const box=(r.text_box||r.box).map((v,i)=>{const input=el('input');input.type='number';input.min='0';input.value=String(v);input.setAttribute('aria-label',['左','上','右','下'][i]);coords.append(input);return input;});
   block.append(input,vl,ol,size,kl,coords,el('p',r.note));dialog.append(block);rows.push({id:r.id,input,vertical,order,size,keep,box});
  }
  action('保存并重新排版',async()=>{await api('/v1/batches/'+id+'/pages/'+p.index+'/edit','POST',{regions:rows.map(r=>({id:r.id,translation:r.input.value,vertical:r.vertical.checked,column_order:r.order.value,font_size:Number(r.size.value),note:r.keep.checked?'用户保留原图':'',text_box:r.box.map(input=>Number(input.value))}))});cards.get(p.index)!.hash='';dialog.close();dialog.remove();await update();},dialog);
  action('关闭',async()=>{dialog.close();dialog.remove();},dialog);document.body.append(dialog);dialog.showModal();
 }
 async function update(){
  const anchor=[...cards.values()].find(c=>c.root.getBoundingClientRect().bottom>0);
  const top=anchor?.root.getBoundingClientRect().top,startY=scrollY;
  if(refreshing)return;refreshing=true;
  try{
   batch=await rpc('status',{id});title.textContent=batch!.title;title.title=batch!.title;
   const b=batch!;const count=(s:string)=>b.pages.filter(p=>p.state===s).length;
   unknownButton.parentElement!.hidden=b.usage_kind==='characters';
   status.textContent='已发现 '+b.pages.length+(b.total?' / '+b.total:'（总数待确认）')+' · 完成 '+(count('completed')+count('review'))+' · 排队 '+count('queued')+' · 失败 '+count('failed')+'\n'+stateLabel(b.state)+' · '+usageText(b)+' · '+b.usage.requests+'次请求'+(' · '+costText(b,true))+(b.error?'\n'+b.error:'');
   const visible:number[]=[];
   for(const p of b.pages){
    let card=cards.get(p.index);
    if(!card){
     const root=el('section');root.className='page';root.dataset.index=String(p.index);const info=el('p');const img=el('img');img.alt='第 '+(p.index+1)+' 页';img.loading='lazy';img.hidden=true;
     root.append(info,img);action('编辑这一页',async()=>{const current:Batch=await rpc('status',{id});await edit(current.pages.find(v=>v.index===p.index)!);},root);
     list.append(root);card={root,img,info,hash:''};cards.set(p.index,card);
    }
    if(p.width&&p.height){card.root.style.minHeight=Math.ceil(Math.min(card.root.clientWidth-20,p.width)*p.height/p.width+100)+'px';card.img.width=p.width;card.img.height=p.height;card.img.style.aspectRatio=p.width+'/'+p.height;}
    card.info.textContent='第 '+(p.index+1)+' 页 · '+p.stage+(phaseText(p)?' · '+phaseText(p):'')+(p.error?' · '+p.error:'');
    const rect=card.root.getBoundingClientRect();if(rect.bottom>0&&rect.top<innerHeight)visible.push(p.index);
    const key=p.hash+':'+(p.render_version||0)+':'+(original?'original':p.output||'original');
    if((rect.bottom< -innerHeight*3||rect.top>innerHeight*5)&&card.hash){card.root.style.minHeight=rect.height+'px';card.img.removeAttribute('src');card.img.hidden=true;card.hash='';}
    if(p.hash&&key!==card.hash&&rect.bottom>-innerHeight&&rect.top<innerHeight*3){
     const response=await rpc('artifact',{id,index:p.index,original:original||!p.output});card.img.src=response.data;card.img.hidden=false;card.hash=key;card.img.onload=()=>{card!.img.style.aspectRatio=card!.img.naturalWidth+'/'+card!.img.naturalHeight;card!.root.style.minHeight=card!.root.getBoundingClientRect().height+'px';};
    }
   }
   if(anchor&&top!==undefined&&Math.abs(scrollY-startY)<2)scrollBy(0,anchor.root.getBoundingClientRect().top-top);
   await rpc('viewport',{id,visible});
  }catch(e){status.textContent=String(e);}finally{refreshing=false;}
 }
 const saved=await chrome.storage.local.get('position:'+id);await update();
 const position=saved['position:'+id] as any;
 if(position&&typeof position==='object'){const card=cards.get(position.index);if(card)scrollBy(0,card.root.getBoundingClientRect().top-position.offset);}
 else if(position)window.scrollTo(0,Number(position));
 let timer:number;window.addEventListener('scroll',()=>{clearTimeout(timer);timer=window.setTimeout(()=>{const current=[...cards.values()].find(c=>c.root.getBoundingClientRect().bottom>0);if(current)void chrome.storage.local.set({['position:'+id]:{index:Number(current.root.dataset.index),offset:current.root.getBoundingClientRect().top}});void update();},200);},{passive:true});
 setInterval(()=>void update(),1500);
}
