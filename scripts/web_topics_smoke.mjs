import {chromium} from 'playwright';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const compiled=await build({stdin:{contents:"import {WebTranslation} from './extension/web.ts';window.web=new WebTranslation((text,state)=>window.feedback={text,state});",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',target:'chrome120'});
const browser=await chromium.launch({executablePath:process.env.MWT_BROWSER||chromium.executablePath(),headless:true});
await mkdir('.local',{recursive:true});
const labels={'Submit Your Questions':'提交您的问题','The Power Balance':'权力平衡','Far-Left Donors':'极左翼捐助者','Blue-Collar Voters':'蓝领选民',"’Rooted In’ Series":'根植于系列','House Tracker':'众议院追踪','Senate Tracker':'参议院追踪',"Editor's Note":'编者按','Newsletter':'新闻简报','Live Updates':'即时更新','Late Topic':'稍后专题'};
const html=`<!doctype html><meta charset=utf-8><title>WSJ ribbon layout fixture</title><style>
body{margin:0;font:14px/20px Arial;color:#222}header{height:65px;text-align:center;font-size:28px;line-height:65px;border-bottom:1px solid #ddd}.topic-band{display:flex;width:100%;max-width:1260px;margin:auto}.election-logo{flex:0 0 186px;height:48px;display:flex;align-items:center;font-size:21px;font-weight:bold}.RibbonContainer{display:flex;flex:1;min-width:0;height:48px;overflow-x:scroll;overflow-y:auto;scrollbar-width:none}.SectionHeading{display:none}.LinkContainer{display:flex;height:48px}.TabContainer{display:flex;align-items:center;padding-right:24px;height:48px}.TabContainer a{display:flex;white-space:nowrap;font-size:14px;font-weight:600;line-height:20px;color:inherit;text-decoration:none}main{max-width:1260px;margin:auto;display:grid;grid-template-columns:280px 1fr 280px;gap:20px}h2{font-size:23px;line-height:1.25}p{font-size:16px;line-height:1.5}.center{height:250px;background:#d9e4e2}
</style><header>The Daily Journal</header><div class=topic-band><div class=election-logo>ELECTION<span style="color:#c00">2026</span></div><div class="css-fixture-RibbonContainer" id=ribbon><div class=SectionHeading><a href=#elections>Election 2026</a></div><div class=LinkContainer>${Object.keys(labels).slice(0,9).map((t,i)=>`<div class=TabContainer><a id=topic${i} href="#topic${i}"><span>${t}</span></a></div>`).join('')}</div></div></div><main><article><h2>A news card retains its column width</h2><p>Keep the article content below the topic ribbon.</p></article><div class=center></div><article><h2>Opinion</h2></article></main>`;
try{
 const page=await browser.newPage({viewport:{width:1400,height:800}});
 await page.route('https://www.wsj.com/**',route=>route.fulfill({contentType:'text/html',body:html.replace('css-fixture-RibbonContainer','RibbonContainer css-fixture-RibbonContainer')}));
 await page.goto('https://www.wsj.com/');
 const baseline=await page.locator('.topic-band').evaluate(e=>e.innerHTML);
 const before=await page.locator('#ribbon').evaluate(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,pageWidth:document.documentElement.scrollWidth}));
 await page.evaluate(labels=>{
  window.calls=[];window.clicks=0;window.waiters=[];window.hold=false;window.originalLinks=[...document.querySelectorAll('#ribbon a')];
  document.querySelector('#topic0').addEventListener('click',e=>{e.preventDefault();window.clicks++;});
  window.chrome={runtime:{sendMessage:async m=>{
   window.calls.push(m);
   if(m.type==='webStart')return {ok:true,value:{id:'topic-test',profile:{provider:'tencent'},target:'zh-CN'}};
   if(m.type==='text'){
    if(window.hold&&Object.values(m.blocks).includes('Late Topic'))await new Promise(r=>window.waiters.push(r));
    return {ok:true,value:Object.fromEntries(Object.entries(m.blocks).map(([k,t])=>[k,labels[t]||'保持新闻页面原有的多栏排版。']))};
   }throw Error('Unexpected message '+m.type);
  }}};
 },labels);
 await page.addScriptTag({content:compiled.outputFiles[0].text});await page.evaluate(()=>window.web.retry());
 await page.waitForFunction(()=>document.querySelectorAll('#ribbon [data-mwt=translation]').length===9&&window.feedback.state.phase==='ready');
 const after=await page.locator('#ribbon').evaluate(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,pageWidth:document.documentElement.scrollWidth,scrollWidth:e.scrollWidth,overflowX:getComputedStyle(e).overflowX}));
 assert.equal(after.height,before.height);assert.equal(after.width,before.width);assert.equal(after.pageWidth,before.pageWidth);assert.ok(after.scrollWidth>after.width);assert.equal(after.overflowX,'scroll');
 assert.equal(await page.locator('.SectionHeading [data-mwt]').count(),0,'Hidden heading translated');
 assert.ok(await page.locator('#ribbon .TabContainer a').evaluateAll(es=>es.every(e=>{const t=e.querySelector('[data-mwt]'),r=e.getBoundingClientRect(),tr=t.getBoundingClientRect();return e.children.length===1&&getComputedStyle(t).display==='inline'&&tr.top>=r.top-1&&tr.bottom<=r.bottom+1&&r.height<=22;})),'Link gained a flex sibling or translation wrapped/clipped');
 assert.equal(await page.locator('#ribbon .TabContainer a').evaluateAll(es=>es.every((e,i)=>e===window.originalLinks[i+1]&&e.getAttribute('href')==='#topic'+i)),true,'Original link nodes/hrefs changed');
 assert.equal(await page.evaluate(()=>window.calls.filter(m=>m.type==='text').flatMap(m=>Object.values(m.blocks)).filter(t=>t==='Submit Your Questions').length),1,'Topic submitted more than once');
 await page.locator('#topic0 [data-mwt]').click();assert.equal(await page.evaluate(()=>window.clicks),1);
 await page.screenshot({path:'.local/web-topics-fixed.png'});
 await page.setViewportSize({width:980,height:800});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),980,'Narrow page acquired horizontal overflow');
 await page.locator('#topic8').scrollIntoViewIfNeeded();
 assert.ok(await page.locator('#topic8').evaluate(e=>{const r=e.getBoundingClientRect(),p=e.closest('#ribbon').getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1;}),'Last topic is inaccessible in narrow ribbon');
 await page.setViewportSize({width:1400,height:800});
 const calls=await page.evaluate(()=>window.calls.filter(m=>m.type==='text').length);
 await page.evaluate(()=>window.web.start('mono'));assert.equal(await page.locator('#topic0').textContent(),'提交您的问题');
 await page.locator('#topic0 [data-mwt]').click();assert.equal(await page.evaluate(()=>window.clicks),2,'Mono topic event lost');
 await page.evaluate(()=>window.web.restore());assert.equal(await page.locator('.topic-band').evaluate(e=>e.innerHTML),baseline,'Ribbon source/styles not restored');
 await page.evaluate(()=>window.web.retry());await page.waitForFunction(()=>document.querySelectorAll('#ribbon [data-mwt]').length===9);
 assert.equal(await page.evaluate(()=>window.calls.filter(m=>m.type==='text').length),calls,'Mode switch called translator again');
 await page.evaluate(()=>{const box=document.createElement('div');box.className='TabContainer';box.innerHTML='<a id=live href=#live><span>Live Updates</span></a>';document.querySelector('.LinkContainer').append(box);});
 await page.locator('#live [data-mwt]').waitFor();assert.equal(await page.locator('#ribbon [data-mwt=translation]').count(),10,'Dynamic topic not discovered');
 await page.evaluate(()=>{window.hold=true;const box=document.createElement('div');box.className='TabContainer';box.innerHTML='<a id=late href=#late><span>Late Topic</span></a>';document.querySelector('.LinkContainer').append(box);});
 await page.waitForFunction(()=>window.waiters.length>0);await page.evaluate(()=>{window.web.restore();window.hold=false;window.waiters.splice(0).forEach(r=>r());});
 await page.waitForTimeout(200);assert.equal(await page.locator('[data-mwt=translation]').count(),0,'Late result reinserted after restore');
 const lateCalls=await page.evaluate(()=>window.calls.filter(m=>m.type==='text').length);
 await page.evaluate(()=>window.web.retry());await page.locator('#late [data-mwt]').waitFor();assert.equal(await page.evaluate(()=>window.calls.filter(m=>m.type==='text').length),lateCalls,'Late completed result not cached');
 const other=await browser.newPage();await other.route('https://example.org/**',r=>r.fulfill({contentType:'text/html',body:html}));await other.goto('https://example.org/');
 await other.evaluate(()=>{window.chrome={runtime:{sendMessage:async m=>({ok:true,value:m.type==='webStart'?{id:'other',profile:{provider:'tencent'}}:Object.fromEntries(Object.keys(m.blocks).map(k=>[k,'普通正文译文']))})}};});
 await other.addScriptTag({content:compiled.outputFiles[0].text});await other.evaluate(()=>window.web.retry());await other.waitForFunction(()=>window.feedback.state.phase==='ready');
 assert.equal(await other.locator('#ribbon [data-mwt]').count(),0,'WSJ-specific rule affected unrelated site');
 const report={browser:browser.version(),before,after,checks:['nineTopicsDiscovered','inlineInsideOriginalTextLeaf','originalLinksAndEvents','ribbonHeightAndWidthPreserved','noPageHorizontalOverflow','nativeHorizontalScrollPreserved','hiddenHeadingSkipped','narrowLastTopicReachable','monoAndRestore','modeSwitchNoRepeat','dynamicTopic','restoreWhilePendingAndCache','WSJRuleIsolation'],realProvider:false};
 await writeFile('.local/web-topics-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
