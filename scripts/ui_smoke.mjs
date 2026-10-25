import {chromium} from 'playwright';
import {readFile,mkdir,cp,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
const root=process.cwd(),fixture=path.join(root,'.local/browser-extension');
await mkdir(fixture,{recursive:true});await cp('dist/extension',fixture,{recursive:true});
const manifest=JSON.parse(await readFile(fixture+'/manifest.json','utf8'));
manifest.host_permissions.push('http://mwt.example/*');
manifest.content_scripts=[{matches:['http://mwt.example/*'],js:['content.js']}];
await writeFile(fixture+'/manifest.json',JSON.stringify(manifest));
const prefix="chrome.runtime.sendNativeMessage=(_name,_message,callback)=>callback({url:'http://127.0.0.1:18768',token:'ui-test-placeholder',protocol:1});\n";
await writeFile(fixture+'/background.js',prefix+await readFile(fixture+'/background.js','utf8'));
const server=createServer(async(req,res)=>{
 if(req.url?.startsWith('/image')){
  res.setHeader('Content-Type','image/png');res.end(await readFile('.local/fixtures/japanese.png'));return;
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.end('<!doctype html><html lang="ja"><title>40页模拟漫画章节</title><body data-manga-reader style="max-width:800px;margin:auto"><h1>40页模拟漫画</h1><p>Hello world. Do not change the number 12.</p><pre>do_not_translate()</pre>'+Array.from({length:40},(_,i)=>'<img width="800" height="1200" src="/image?i='+i+'">').join('')+'</body></html>');
});
await new Promise(r=>server.listen(18769,'127.0.0.1',r));
const context=await chromium.launchPersistentContext(path.join(root,'.local/browser-profile-'+Date.now()),{
 executablePath:process.env.MWT_BROWSER||chromium.executablePath(),
 headless:true,viewport:{width:1360,height:900},
 args:['--disable-extensions-except='+fixture,'--load-extension='+fixture,'--host-resolver-rules=MAP mwt.example 127.0.0.1','--no-proxy-server']
});
try{
 let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const id=worker.url().split('/')[2];
 const service=await fetch('http://127.0.0.1:18768/v1/profiles',{headers:{Authorization:'Bearer ui-test-placeholder'}}).then(r=>r.json());
 await worker.evaluate(async({profileId})=>{await chrome.storage.local.set({profileId});},{profileId:service.find(p=>p.provider==="mock").id});
 const page=await context.newPage();await page.goto('chrome-extension://'+id+'/settings.html');
 await page.locator('#provider').waitFor();
 await page.screenshot({path:'.local/settings.png',fullPage:true});
 const site=await context.newPage();await site.goto('http://mwt.example:18769/');
 // Closed shadow root cannot be queried by normal Playwright selectors; use visible coordinates.
 await site.mouse.click(1314,431,{button:'right'});await site.screenshot({path:'.local/panel.png'});
 const cdp=await context.newCDPSession(site);await cdp.send('DOM.enable');
 async function clickShadow(label){
  const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
  const text=n=>(n.nodeValue||'')+(n.children||[]).map(text).join('');
  function find(n){if((n.nodeName==='BUTTON'||n.nodeName==='SUMMARY')&&text(n)===label)return n;for(const child of [...(n.children||[]),...(n.shadowRoots||[])]){const found=find(child);if(found)return found;}}
  const node=find(root);if(!node)throw Error('Missing shadow button: '+label);
  const {object}=await cdp.send('DOM.resolveNode',{nodeId:node.nodeId});
  await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){this.click();}'});
 }
 await site.evaluate(()=>scrollTo(0,600));const anchor=await site.evaluate(()=>scrollY);
 await clickShadow('更多工具');await clickShadow('扫描本章');await site.waitForTimeout(850);await site.keyboard.press('Escape');await site.waitForTimeout(900);
 if(Math.abs(await site.evaluate(()=>scrollY)-anchor)>3)throw Error('Scan did not restore reading anchor');
 // Start chapter through the real service worker route with the fixture tab as sender,
 // while the consumer-facing panel itself is visually captured above.
 const tabId=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({url:'http://mwt.example/*'});return tabs[0].id;});
 const result=await worker.evaluate(async({tabId})=>{
  const [{result}]=await chrome.scripting.executeScript({target:{tabId},func:async()=>{
   return chrome.runtime.sendMessage({type:'start',chapter:{id:'fixture:40-v011',title:'40页模拟漫画章节',site:location.hostname,reader:false,complete:true,total:40,pages:[...document.images].map((im,index)=>({index,url:im.src}))}});
  }});return result;
 },{tabId});
 if(!result.ok)throw Error(result.error);
 await fetch('http://127.0.0.1:18768/v1/batches/'+result.value.id+'/action',{method:'POST',headers:{Authorization:'Bearer ui-test-placeholder','Content-Type':'application/json'},body:JSON.stringify({action:'resume'})});
 const reader=await context.newPage();await reader.goto('chrome-extension://'+id+'/reader.html?batch='+result.value.id);
 await reader.getByRole('heading',{name:'40页模拟漫画章节'}).waitFor({timeout:15000});
 await reader.waitForFunction(()=>document.querySelector('.page img')?.naturalWidth>0,{},{timeout:45000});
 await reader.waitForFunction(()=>[...document.querySelectorAll('.page>p')].some(p=>p.textContent.includes('完成')),{},{timeout:45000});
 if(await reader.locator('#reader-tools').isVisible())throw Error('Reader toolbar must start collapsed');
 if(await reader.getByRole('button',{name:'展开工具',exact:true}).getAttribute('aria-expanded')!=='false')throw Error('Collapsed toolbar state missing');
 await reader.screenshot({path:'.local/reader.png'});
 await reader.getByRole('button',{name:'展开工具',exact:true}).click();
 if(!await reader.locator('#reader-tools').isVisible())throw Error('Toolbar did not expand');
 await reader.getByPlaceholder('跳转页码').fill('25');await reader.getByRole('button',{name:'跳转',exact:true}).click();
 await reader.screenshot({path:'.local/reader-jump.png'});
 await reader.waitForFunction(()=>[...document.querySelectorAll('.page>p')].filter(p=>p.textContent.includes('完成')).length===40,{},{timeout:90000});
 const after=await fetch('http://127.0.0.1:18768/v1/batches/'+result.value.id,{headers:{Authorization:'Bearer ui-test-placeholder'}}).then(r=>r.json());
 if(after.usage.requests>1)throw Error('Identical image cache charged more than once');
 if(after.pages.length!==40)throw Error('Chapter did not contain 40 pages');
 await reader.getByRole('button',{name:'暂停',exact:true}).click();
 await reader.getByRole('button',{name:'收起工具',exact:true}).click();
 if(await reader.locator('#reader-tools').isVisible())throw Error('Toolbar did not collapse again');
 await reader.reload();await reader.getByRole('button',{name:'展开工具',exact:true}).waitFor();
 if(await reader.locator('#reader-tools').isVisible())throw Error('Reload must default to collapsed');
 console.log(JSON.stringify({browser:context.browser()?.version(),extensionId:id,pages:after.pages.length,completed:after.pages.filter(p=>['completed','review'].includes(p.state)).length,usage:after.usage,uiChecks:['scanCancelAnchor','chapter40','jump25','toolbarCollapsedByDefault','toolbarToggle','toolbarCollapsedAfterReload'],screenshots:['settings.png','panel.png','reader.png','reader-jump.png']}));
}finally{await context.close();server.close();}
