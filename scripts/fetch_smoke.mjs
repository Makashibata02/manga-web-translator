import {chromium} from 'playwright';
import {readFile,writeFile,cp} from 'node:fs/promises';import path from 'node:path';import {build} from 'esbuild';
const folder=path.resolve('.local/fetch-extension');await cp('dist/extension',folder,{recursive:true});
const m=JSON.parse(await readFile(folder+'/manifest.json','utf8'));m.host_permissions.push('https://*/*');await writeFile(folder+'/manifest.json',JSON.stringify(m));
const bundle=await build({entryPoints:['extension/network.ts'],bundle:true,write:false,format:'iife',globalName:'networkTest'});await writeFile(folder+'/background.js',bundle.outputFiles[0].text+"\nglobalThis.networkTest=networkTest;\n");
const ctx=await chromium.launchPersistentContext(path.resolve('.local/fetch-profile-v2'),{executablePath:process.env.MWT_BROWSER||chromium.executablePath(),headless:true,args:['--disable-extensions-except='+folder,'--load-extension='+folder]});
try{const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
for(const url of ['https://www.mangabz.com/m517253-p2/','https://www.yymanhua.com/m517253-p2/']){
 const p=await ctx.newPage();await p.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
 await p.waitForFunction(()=>document.querySelector('#cp_image')?.naturalWidth>100,{},{timeout:20000});
 const src=await p.locator('#cp_image').getAttribute('src');
 const result=await sw.evaluate(async({src,url})=>{try{const r=await networkTest.fetchImage(src,url);return {status:r.status,bytes:(await r.arrayBuffer()).byteLength,type:r.headers.get('content-type'),rulesRemaining:(await chrome.declarativeNetRequest.getSessionRules()).length};}catch(e){return {error:String(e)};}},{src,url});
 console.log(JSON.stringify({site:new URL(url).hostname,page:2,download:result}));await p.close();
}}finally{await ctx.close();}
