import {chromium} from 'playwright';import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';import path from 'node:path';
const folder=path.resolve('.local/real-extension');await mkdir(folder,{recursive:true});await cp('dist/extension',folder,{recursive:true});
const m=JSON.parse(await readFile(folder+'/manifest.json','utf8'));m.host_permissions.push('https://*/*');m.content_scripts=[{matches:['https://*/*'],js:['content.js']}];await writeFile(folder+'/manifest.json',JSON.stringify(m));
await writeFile(folder+'/background.js',"chrome.runtime.sendNativeMessage=(_n,_m,cb)=>cb({url:'http://127.0.0.1:18771',token:'live-test-placeholder',protocol:1});\n"+await readFile(folder+'/background.js','utf8'));
const ctx=await chromium.launchPersistentContext(path.resolve('.local/real-profile-'+Date.now()),{executablePath:process.env.MWT_BROWSER||chromium.executablePath(),headless:true,viewport:{width:1440,height:1000},args:['--disable-extensions-except='+folder,'--load-extension='+folder]});const out=[];
try{
 const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');await new Promise(r=>setTimeout(r,300));
 await sw.evaluate(()=>chrome.storage.local.set({profileId:'free-tencent',defaults:{source:'auto',target:'zh-CN',budget:{characters:10000,requests:8}}}));
 for(const [name,url]of [['news','https://www.wsj.com/'],['long','https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API'],['japanese','https://ja.wikipedia.org/wiki/日本語']]){
  const page=await ctx.newPage();let result={name,url};
  try{
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(1300);
   const before=await page.locator('img').evaluateAll(imgs=>imgs.map(im=>({src:im.getAttribute('src'),width:im.width,height:im.height})));
   const beforeNav=await page.locator('nav').allTextContents();const start=Date.now();await page.mouse.click(1394,476);
   await page.locator('[data-mwt=translation]').first().waitFor({timeout:25000});result.firstTranslationMs=Date.now()-start;
   await page.waitForTimeout(4000);result.translatedBlocks=await page.locator('[data-mwt=translation]').count();result.samples=(await page.locator('[data-mwt=translation]').allTextContents()).slice(0,3);
   result.navPreserved=JSON.stringify(beforeNav)===JSON.stringify(await page.locator('nav').allTextContents());
   result.imageSourcesPreserved=JSON.stringify(before.map(x=>x.src))===JSON.stringify(await page.locator('img').evaluateAll(imgs=>imgs.map(im=>im.getAttribute('src'))));
   await page.screenshot({path:'.local/real-'+name+'-011.png',fullPage:false});
  }catch(e){result.error=String(e).split('\n')[0];await page.screenshot({path:'.local/real-'+name+'-failed.png'}).catch(()=>{});}
  out.push(result);await page.close();
 }
}finally{await ctx.close();}
await writeFile('.local/real-web-report.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
