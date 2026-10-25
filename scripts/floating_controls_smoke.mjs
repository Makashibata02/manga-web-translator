import {chromium} from 'playwright';
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),dir=path.join(root,'.local/floating-controls-extension');
await mkdir(dir,{recursive:true});await cp('dist/extension',dir,{recursive:true});
const svg=(color,label)=>'<svg xmlns="http://www.w3.org/2000/svg" width="700" height="900"><rect width="700" height="900" fill="'+color+'"/><text x="70" y="130" font-size="32">'+label+'</text></svg>';
const original=svg('white','Original image'),output=i=>svg(i%2?'#e4e9ff':'#e1f2ec','Translation task '+i),data=s=>'data:image/svg+xml;base64,'+Buffer.from(s).toString('base64');
let creates=0,artifactCalls=0,textCalls=0,pauseCalls=0;const batches=[],held=new Map();let holdNext=false;
const profiles=[{id:'free-bing',provider:'bing',name:'免费 Bing'},{id:'free-tencent',provider:'tencent',name:'免费腾讯'},{id:'owned-ds',provider:'openai',name:'DeepSeek',model:'owned-mock',has_key:true}];
const server=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 res.setHeader('Content-Type','application/json');
 if(req.url==='/v1/profiles')return res.end(JSON.stringify(profiles));
 if(req.url==='/v1/batches'&&req.method==='POST'){
  const spec=JSON.parse(body),id='owned-task-'+(++creates);
  const b={...spec,id,rules:'owned-rule-'+creates,state:'completed',profile:profiles.find(p=>p.id===spec.profile_id),usage_kind:'characters',usage:{characters:0,tokens:0,requests:0,yuan:0,reserved_tokens:0,reserved_yuan:0},pages:spec.pages.map(p=>({...p,hash:'identical-original',revision:0,render_version:0,state:'completed',stage:'done',error:'',output:'owned-output'})),error:''};batches.push(b);return res.end(JSON.stringify(b));
 }
 if(req.url==='/v1/batches')return res.end(JSON.stringify(batches));
 const b=batches.find(b=>req.url.startsWith('/v1/batches/'+b.id));
 if(b){
  if(req.url.endsWith('/translated')){artifactCalls++;const finish=()=>{res.setHeader('Content-Type','image/svg+xml');res.end(output(batches.indexOf(b)+1));};if(holdNext){holdNext=false;held.set(b.id,finish);}else finish();return;}
  if(req.url.endsWith('/text')){textCalls++;return res.end(JSON.stringify(Object.fromEntries(Object.keys(JSON.parse(body).blocks).map(k=>[k,'用于验证切换服务后的中文译文 '+b.id]))));}
  if(req.url.endsWith('/action')&&JSON.parse(body||'{}').action==='pause'){pauseCalls++;b.state='paused';}
  return res.end(JSON.stringify(b));
 }
 res.statusCode=404;res.end('{}');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const manifest=JSON.parse(await readFile(dir+'/manifest.json','utf8'));manifest.host_permissions.push('https://www.webtoons.com/*','https://shonenjumpplus.com/*');manifest.content_scripts=[{matches:['https://www.webtoons.com/*','https://shonenjumpplus.com/*'],js:['content.js']}];await writeFile(dir+'/manifest.json',JSON.stringify(manifest));
await writeFile(dir+'/background.js',"chrome.runtime.sendNativeMessage=(_a,_b,cb)=>cb({url:'http://127.0.0.1:"+port+"',token:'owned-mock-placeholder',protocol:1});\n"+await readFile(dir+'/background.js','utf8'));
const context=await chromium.launchPersistentContext(path.join(root,'.local/floating-controls-profile-'+Date.now()),{executablePath:process.env.MWT_BROWSER||chromium.executablePath(),headless:true,viewport:{width:1100,height:900},args:['--disable-extensions-except='+dir,'--load-extension='+dir]});
const checks=[];
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>chrome.storage.local.set({profileId:'free-bing'}));
 let html='<!doctype html><title>Owned floating controls fixture</title><div id="_imageList"><img width="700" height="900" style="border:0" srcset="https://cdn.example/original.svg 1x" data-url="https://cdn.example/original.svg" src="https://cdn.example/original.svg"></div>';
 await context.route('https://**/*',r=>r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:html}):r.fulfill({contentType:'image/svg+xml',body:original}));
 const page=await context.newPage();await page.goto('https://www.webtoons.com/en/canvas/owned/viewer?title_no=123&episode_no=1');
 const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');
 async function control(id,fn,arg){const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});function find(n){const a=n.attributes||[];if(a.some((v,i)=>v==='id'&&a[i+1]===id))return n;for(const c of [...n.children||[],...n.shadowRoots||[]]){const found=find(c);if(found)return found;}}const n=find(root);assert.ok(n,'Missing control '+id);const {object}=await cdp.send('DOM.resolveNode',{nodeId:n.nodeId});const result=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:fn,arguments:arg===undefined?[]:[{value:arg}],awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
 const click=id=>control(id,'function(){this.click();}');
 async function menu(){await page.mouse.click(1054,431,{button:'right'});for(let i=0;i<30;i++){if(await control('service','function(){return !this.disabled;}'))return;await page.waitForTimeout(100);}throw Error('Service menu did not load');}
 async function select(id){await control('service','function(value){this.value=value;this.dispatchEvent(new Event("change",{bubbles:true}));}',id);for(let i=0;i<40;i++){if(await control('service','function(){return !this.disabled;}')&&(await worker.evaluate(()=>chrome.storage.local.get('profileId'))).profileId===id)return;await page.waitForTimeout(100);}throw Error('Service selection did not finish');}
 await page.waitForSelector('[data-mwt-build="layout-20261024-performance1"]',{state:'attached'});await click('ball');
 await page.waitForFunction(src=>document.querySelector('#_imageList img').src===src,data(output(1)));
 batches[0].pages[0].timings={ocr_s:4.2,translation_s:1.5,render_s:.2,cpu_wait_s:0};
 const priorReaderArtifacts=artifactCalls;const reader=await context.newPage();await reader.goto('chrome-extension://'+worker.url().split('/')[2]+'/reader.html?batch='+batches[0].id);await reader.waitForFunction(()=>document.querySelector('.page>p')?.textContent.includes('识别 4.2s · 翻译 1.5s · 擦字排版 0.2s'));
 assert.equal(await reader.locator('#reader-tools').isVisible(),false);await reader.screenshot({path:'.local/reader-phase-timings.png'});await reader.close();const readerArtifactRequests=artifactCalls-priorReaderArtifacts;checks.push('reader shows per-page OCR/translation/render timings with toolbar still collapsed');
 const before=await page.locator('#_imageList img').boundingBox();await click('ball');
 await page.waitForFunction(()=>!document.querySelector('#_imageList img').dataset.mwtSource);await page.waitForTimeout(1900);
 assert.equal(await page.locator('#_imageList img').getAttribute('srcset'),'https://cdn.example/original.svg 1x');assert.equal(await page.locator('#_imageList img').evaluate(el=>el.style.aspectRatio),'');assert.equal(creates,1);assert.equal(artifactCalls-readerArtifactRequests,1);
 await click('ball');await page.waitForFunction(src=>document.querySelector('#_imageList img').src===src,data(output(1)));assert.equal(creates,1);assert.equal(artifactCalls-readerArtifactRequests,1);checks.push('ball toggles original and cached translation without creating or billing another task');
 await click('ball');await page.reload();await page.waitForSelector('[data-mwt-build]',{state:'attached'});await page.waitForTimeout(1900);assert.equal(await page.locator('#_imageList img[data-mwt-source]').count(),0);await click('ball');await page.waitForFunction(src=>document.querySelector('#_imageList img').src===src,data(output(1)));checks.push('original view survives refresh and source attributes/styles are restored');
 await menu();const visibleButtons=await control('toggle','function(){return [...this.getRootNode().querySelectorAll("#panel button")].filter(b=>b.getClientRects().length).map(b=>b.textContent);}');assert.deepEqual(visibleButtons,['×','显示原图','设置']);
 await page.screenshot({path:'.local/floating-controls-menu.png'});checks.push('compact menu shows only service, view toggle and settings; tools start collapsed');
 await select('owned-ds');assert.equal(creates,1);assert.equal(textCalls,0);assert.equal(await control('service','function(){return this.nextElementSibling.textContent.includes("消耗额度");}'),true);checks.push('selecting DeepSeek makes no model call and shows cost hint');
 await select('free-tencent');assert.equal(creates,1);assert.equal(pauseCalls,0);await page.reload();await page.waitForSelector('[data-mwt-build]',{state:'attached'});await page.waitForTimeout(1900);assert.equal(await page.locator('#_imageList img[data-mwt-source]').count(),0);await click('ball');
 await page.waitForFunction(src=>document.querySelector('#_imageList img').src===src,data(output(2)));assert.equal(creates,2);assert.equal(batches[1].profile.id,'free-tencent');const after=await page.locator('#_imageList img').boundingBox();assert.equal(before.width,after.width);assert.equal(before.height,after.height);checks.push('model switch survives refresh, starts distinct task only on click and replaces same-hash old output');await menu();
 await select('free-bing');holdNext=true;await click('ball');
 for(let i=0;i<40&&!held.size;i++)await page.waitForTimeout(100);assert.ok(held.size);await click('ball');for(const finish of held.values())finish();held.clear();await page.waitForTimeout(2000);assert.equal(await page.locator('#_imageList img[data-mwt-source]').count(),0);checks.push('late image response cannot overwrite restored original');
 html='<!doctype html><title>Owned canvas toggle</title><div class="js-viewer-content"><p class="js-page-area"><canvas class="js-page-image" data-index="0" width="700" height="900"></canvas></p></div><script>const g=document.querySelector("canvas").getContext("2d");g.fillStyle="white";g.fillRect(0,0,700,900);g.fillStyle="black";g.fillRect(100,100,30,150);</script>';
 await page.goto('https://shonenjumpplus.com/episode/owned-toggle');await page.waitForSelector('[data-mwt-build]',{state:'attached'});await click('ball');await page.waitForSelector('[data-mwt="canvas-output"] img');await click('ball');await page.waitForTimeout(1900);assert.equal(await page.locator('[data-mwt="canvas-output"] img').count(),0);await click('ball');await page.waitForSelector('[data-mwt="canvas-output"] img');checks.push('canvas overlay disappears and restores using cached output');
 await menu();await select('free-tencent');holdNext=true;await click('ball');for(let i=0;i<40&&!held.size;i++)await page.waitForTimeout(100);assert.ok(held.size);await click('ball');for(const finish of held.values())finish();held.clear();await page.waitForTimeout(2000);assert.equal(await page.locator('[data-mwt="canvas-output"] img').count(),0);checks.push('late canvas response cannot repaint after original toggle');
 html='<!doctype html><title>Owned article toggle</title><main><article><h1>An ordinary webpage heading</h1><p id="prose">This paragraph verifies translation and restoration using the same floating control.</p></article></main>';
 await page.goto('https://www.webtoons.com/en/about/owned-article');await page.waitForSelector('[data-mwt-build]',{state:'attached'});await click('ball');await page.waitForSelector('#prose [data-mwt=translation]');await click('ball');assert.equal(await page.locator('[data-mwt=translation]').count(),0);const calls=textCalls;await click('ball');await page.waitForSelector('#prose [data-mwt=translation]');assert.equal(textCalls,calls);checks.push('ordinary webpage toggle restores and reuses translations');
 await menu();await select('free-bing');assert.equal(await page.locator('[data-mwt=translation]').count(),0);const prior=textCalls;await click('toggle');await page.waitForSelector('#prose [data-mwt=translation]');assert.ok(textCalls>prior);assert.equal(batches.at(-1).profile.id,'free-bing');checks.push('webpage model change discards old provider display/cache');
 await writeFile('.local/floating-controls-report.json',JSON.stringify({checks,modelCalls:0,apiKeysRead:false,realSite:false,creates,artifactCalls,textCalls},null,2));
 console.log(JSON.stringify({checks:checks.length,realModelCalls:0,passed:true}));
}finally{for(const finish of held.values())finish();await context.close();await new Promise(r=>server.close(r));}
