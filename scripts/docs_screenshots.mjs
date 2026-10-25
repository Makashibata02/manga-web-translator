// Capture the real extension UI in a disposable, entirely local demo browser.
import {chromium} from 'playwright';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),dir=path.join(root,'.local/docs-extension');await mkdir(dir,{recursive:true});await cp('dist/extension',dir,{recursive:true});await mkdir('.local/demo-screenshots',{recursive:true});
const profiles=[{id:'free-tencent',provider:'tencent',name:'免费腾讯交互翻译',experimental:true},{id:'free-bing',provider:'bing',name:'免费 Bing',experimental:true}];
const demo=JSON.parse(await readFile('.local/docs-demo/meta.json','utf8'));
const batch={id:'docs-demo',chapter_id:'docs-demo',title:'日文漫画 · 连续阅读示例',kind:'manga',source:'ja',target:'zh-CN',rules:'comic-v16',state:'completed',complete:true,total:1,profile:profiles[0],cost_known:true,usage_kind:'characters',usage:{characters:0,tokens:0,requests:0,yuan:0,reserved_tokens:0,reserved_yuan:0},budget:{tokens:1000000,characters:1000000,requests:2000,yuan:5},pages:[{index:0,url:'https://docs.example/demo.png',width:760,height:980,hash:'docs-artwork',revision:0,render_version:1,state:'completed',stage:'完成',regions:demo.regions,error:'',output:'demo.png',timings:{render_s:demo.render_s}}],error:''};
const translations={
 'Read at your own pace':'按照自己的节奏阅读',
 'A calmer way to explore the web':'轻松阅读，发现更多内容',
 'Keep the original paragraph, then read the translation just below it. Links, images, and the shape of the page stay familiar.':'保留原文段落，在下方阅读译文。链接、图片和页面结构依然保持熟悉的样子。',
 'One click, two languages':'点击一下，双语阅读',
 'Start with the floating button. Click it again whenever you want to return to the original page.':'点击悬浮球开始翻译，再次点击即可切回原文。',
 'A chapter that keeps moving':'整章翻译，连续阅读',
 'Current pages come first. The rest of the chapter waits in a queue while you continue reading.':'优先处理当前页面，其余章节内容排队处理，你可以继续向下阅读。',
 'Your pictures stay on your computer':'图片保留在本机',
 'Text recognition and image cleanup run locally. Only recognized text is sent to your chosen translation service.':'文字识别和擦字在本机完成，只有识别出的文字会发送给你选择的翻译服务。'
};
let webId=0;const web=[];
const server=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;res.setHeader('Content-Type','application/json');
 if(req.url==='/v1/profiles')return res.end(JSON.stringify(profiles));
 if(req.url==='/v1/capabilities')return res.end(JSON.stringify({profile_management:4,comic_layout:'vertical-rtl',deepseek:{endpoint:'https://api.deepseek.com',model:'deepseek-flash'},pricing_presets:{'deepseek-flash':[2,8]},price_checked:'2026-10-24'}));
 if(req.url==='/v1/batches'&&req.method==='POST'){const spec=JSON.parse(body),b={...batch,...spec,id:'docs-web-'+(++webId),pages:[],state:'active'};web.push(b);return res.end(JSON.stringify(b));}
 if(req.url==='/v1/batches')return res.end(JSON.stringify([batch,...web]));
 if(req.url?.endsWith('/translated')||req.url?.endsWith('/original')){res.setHeader('Content-Type','image/png');return res.end(await readFile('.local/docs-demo/'+(req.url.endsWith('/original')?'original.png':'translated.png')));}
 if(req.url?.endsWith('/text')){const blocks=JSON.parse(body).blocks;return res.end(JSON.stringify(Object.fromEntries(Object.entries(blocks).map(([k,v])=>[k,translations[String(v).trim()]||String(v)]))));}
 const b=[batch,...web].find(b=>req.url?.startsWith('/v1/batches/'+b.id));if(b)return res.end(JSON.stringify(b));res.statusCode=404;res.end('{}');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const manifest=JSON.parse(await readFile(dir+'/manifest.json','utf8'));manifest.host_permissions.push('https://docs.example/*');manifest.content_scripts=[{matches:['https://docs.example/*'],js:['content.js']}];await writeFile(dir+'/manifest.json',JSON.stringify(manifest));
await writeFile(dir+'/background.js',"chrome.runtime.sendNativeMessage=(_a,_b,cb)=>cb({url:'http://127.0.0.1:"+port+"',token:'docs-test-placeholder',protocol:1});\n"+await readFile(dir+'/background.js','utf8'));
const context=await chromium.launchPersistentContext(path.join(root,'.local/docs-browser-profile-'+Date.now()),{executablePath:process.env.MWT_BROWSER||chromium.executablePath(),headless:true,viewport:{width:1200,height:900},args:['--disable-extensions-except='+dir,'--load-extension='+dir]});
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=worker.url().split('/')[2];await worker.evaluate(()=>chrome.storage.local.set({profileId:'free-tencent'}));
 const settings=await context.newPage();await settings.goto('chrome-extension://'+id+'/settings.html');await settings.locator('#provider').waitFor();await settings.waitForFunction(()=>document.querySelector('#provider').value==='tencent');await settings.screenshot({path:'.local/demo-screenshots/settings.png',clip:{x:80,y:10,width:1040,height:510}});
 const reader=await context.newPage();await reader.setViewportSize({width:1080,height:1230});await reader.goto('chrome-extension://'+id+'/reader.html?batch=docs-demo');await reader.waitForFunction(()=>document.querySelector('.page img')?.naturalWidth>0);assert.equal(await reader.locator('#reader-tools').isVisible(),false);await reader.screenshot({path:'.local/demo-screenshots/manga-reader.png'});
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Reading Journal · Demo</title><style>body{margin:0;background:#f8faf9;color:#27352f;font:18px/1.7 system-ui}header{padding:20px 8%;border-bottom:1px solid #d9e3dd;background:white;font-weight:700;color:#507361}main{max-width:820px;margin:34px auto;padding:28px 44px;background:white;border:1px solid #e2e8e3;border-radius:16px}h1{font-family:Georgia,serif;font-size:40px;line-height:1.22;margin:10px 0 20px}h2{font-size:23px;line-height:1.4;margin:24px 0 8px}p{margin:8px 0;font-size:17px}small{font-size:13px;color:#788a7f}#eyebrow{font-size:13px;letter-spacing:2px;color:#5b806b}</style><header>READING JOURNAL <small>· 本地演示页面</small></header><main><article><p id="eyebrow">Read at your own pace</p><h1>A calmer way to explore the web</h1><p>Keep the original paragraph, then read the translation just below it. Links, images, and the shape of the page stay familiar.</p><h2>One click, two languages</h2><p>Start with the floating button. Click it again whenever you want to return to the original page.</p><h2>A chapter that keeps moving</h2><p>Current pages come first. The rest of the chapter waits in a queue while you continue reading.</p><h2>Your pictures stay on your computer</h2><p>Text recognition and image cleanup run locally. Only recognized text is sent to your chosen translation service.</p></article></main></html>`;
 await context.route('https://docs.example/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html}));const page=await context.newPage();await page.goto('https://docs.example/reading');await page.waitForSelector('[data-mwt-build]',{state:'attached'});
 const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');const {root:dom}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
 function find(n){const a=n.attributes||[];if(a.some((v,i)=>v==='id'&&a[i+1]==='ball'))return n;for(const c of [...n.children||[],...n.shadowRoots||[]]){const f=find(c);if(f)return f;}}
 const node=find(dom);assert.ok(node);const {object}=await cdp.send('DOM.resolveNode',{nodeId:node.nodeId});await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){this.click();}'});
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-mwt="translation"]')].some(el=>el.textContent.includes('文字识别和擦字在本机完成')));await page.screenshot({path:'.local/demo-screenshots/web-bilingual.png',fullPage:true});
 console.log(JSON.stringify({screenshots:3,ownedDemoOnly:true,realModelCalls:0,personalKeysRead:false}));
}finally{await context.close();await new Promise(r=>server.close(r));}
