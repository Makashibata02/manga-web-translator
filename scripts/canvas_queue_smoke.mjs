import {chromium} from 'playwright';
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),dir=path.join(root,'.local/canvas-test-extension');
await mkdir(dir,{recursive:true});await cp('dist/extension',dir,{recursive:true});
const manifest=JSON.parse(await readFile(dir+'/manifest.json','utf8'));
manifest.host_permissions.push('https://shonenjumpplus.com/*');manifest.content_scripts=[{matches:['https://shonenjumpplus.com/*'],js:['content.js']}];await writeFile(dir+'/manifest.json',JSON.stringify(manifest));
await writeFile(dir+'/background.js',"chrome.runtime.sendNativeMessage=(_a,_b,cb)=>cb({url:'http://127.0.0.1:18768',token:'ui-test-placeholder',protocol:1});\n"+await readFile(dir+'/background.js','utf8'));
const context=await chromium.launchPersistentContext(path.join(root,'.local/canvas-test-profile-'+Date.now()),{executablePath:process.env.MWT_BROWSER||chromium.executablePath(),headless:true,viewport:{width:1100,height:900},args:['--disable-extensions-except='+dir,'--load-extension='+dir]});
const api=async(path,method='GET',body)=>{const r=await fetch('http://127.0.0.1:18768'+path,{method,headers:{Authorization:'Bearer ui-test-placeholder','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(await r.text());return r.json();};
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const profiles=await api('/v1/profiles');
 await worker.evaluate(async id=>chrome.storage.local.set({profileId:id}),profiles.find(p=>p.provider==='mock').id);
 const page=await context.newPage();let paint=Array.from({length:4},(_,i)=>'<p class="js-page-area"><canvas width="400" height="600" data-index="'+i+'" class="js-page-image"></canvas></p>').join('');
 const sample='data:image/png;base64,'+(await readFile('.local/fixtures/japanese.png')).toString('base64');
 const html='<!doctype html><title>Owned Canvas queue</title><style>body{margin:0}.viewer{width:800px;overflow:auto}.js-viewer-content{display:flex;width:1600px}.js-page-area{flex:0 0 400px;margin:0}canvas{display:block}</style><div class="viewer"><div class="js-viewer-content">'+paint+'</div></div><button id="next">Next pages</button><script>const sample=new Image();sample.onload=()=>{for(const c of document.querySelectorAll("canvas"))c.getContext("2d").drawImage(sample,0,0,400,600);};sample.src="'+sample+'";document.querySelector("#next").onclick=()=>document.querySelector(".viewer").scrollLeft=800;</script>';
 await page.route('**/*',r=>r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:html}):r.fulfill({status:204,body:''}));
 await page.goto('https://shonenjumpplus.com/episode/owned-fixture-'+Date.now());
 await page.waitForSelector('[data-mwt-build="layout-20261024-profiles1"]',{state:'attached'});await page.mouse.click(1054,431);
 let batch;for(let i=0;i<35;i++){batch=(await api('/v1/batches')).filter(b=>b.chapter_id===page.url()).at(-1);if(batch?.pages.filter(p=>p.hash).length>=2)break;await page.waitForTimeout(700);}
 assert.ok(batch,'Floating ball did not create batch');assert.equal(batch.pages.length,4);assert.equal(batch.pages.filter(p=>p.hash).length,2,'Only current spread should upload');
 await page.getByRole('button',{name:'Next pages',exact:true}).click();
 for(let i=0;i<45;i++){batch=await api('/v1/batches/'+batch.id);if(batch.pages.every(p=>p.output))break;await page.waitForTimeout(700);}
 assert.ok(batch.pages.every(p=>p.hash),'All four normal reader canvases must enter the local queue');assert.ok(batch.pages.every(p=>p.output),'Mock pipeline must produce all four outputs');assert.equal(batch.usage.yuan,0);assert.ok(batch.pages.some(p=>p.regions?.some(r=>r.translation&&r.translation!==r.source)),'The pipeline must actually translate a text region');
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-mwt="canvas-output"] img')].some(im=>getComputedStyle(im).display!=='none'&&im.naturalWidth>0));
 const bounds=await page.locator('canvas').evaluateAll(xs=>xs.map(x=>[x.width,x.height,x.getBoundingClientRect().width,x.getBoundingClientRect().height]));assert.ok(bounds.every(x=>x.join(',')==='400,600,400,600'));
 const tabs=await worker.evaluate(()=>chrome.tabs.query({url:'https://shonenjumpplus.com/*'}));
 const reject=await worker.evaluate(async({tabId,id})=>{const [{result}]=await chrome.scripting.executeScript({target:{tabId},func:async(id)=>chrome.runtime.sendMessage({type:'pagePixels',id,chapterId:'another-chapter',index:0,source:'mwt-local:0',data:'data:image/png;base64,AA=='}),args:[id]});return result;},{tabId:tabs[0].id,id:batch.id});assert.equal(reject.ok,false);
 await page.screenshot({path:'.local/canvas-queue.png'});
 await writeFile('.local/canvas-queue-report.json',JSON.stringify({pages:4,uploaded:4,outputs:4,yuan:batch.usage.yuan,sourcePixelsLocal:true,wrongChapterRejected:true,sizesUnchanged:true,liveSite:false,browser:context.browser().version()},null,2));
 console.log('Canvas queue: 4 pages captured locally, 4 outputs, wrong chapter refused, zero real API calls.');
}finally{await context.close();}
