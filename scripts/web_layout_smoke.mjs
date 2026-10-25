import {chromium} from 'playwright';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const compiled=await build({stdin:{contents:"import {WebTranslation} from './extension/web.ts';window.web=new WebTranslation((text,state)=>window.feedback={text,state});",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',target:'chrome120'});
const browser=await chromium.launch({executablePath:process.env.MWT_BROWSER||chromium.executablePath(),headless:true});
const page=await browser.newPage({viewport:{width:1400,height:1000}});
await mkdir('.local',{recursive:true});
try{
 await page.setContent(`<!doctype html><title>News layout regression</title><style>
 body{font:16px/1.45 Arial;color:#222;margin:30px}nav{padding:12px;background:#eee}main{display:grid;grid-template-columns:280px 560px 280px;gap:24px;margin:auto;max-width:1170px}h3{font-family:Arial;font-size:18px;line-height:1.15}h3 a{font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#111;text-decoration:none;font-weight:600}p{margin:12px 0}img{width:100%;height:160px;object-fit:cover}.card{border-bottom:1px solid #ccc;padding-bottom:18px}.clamped{max-height:42px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}a{color:#175879}
 header{max-width:1170px;margin:auto}header h1{height:65px;margin:0 0 8px;text-align:center}header .brand-logo{display:block;width:570px;height:65px;margin:auto;text-indent:-9999px;background:center / contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='570' height='65'%3E%3Ctext x='0' y='48' font-size='39'%3ETHE DAILY JOURNAL%3C/text%3E%3C/svg%3E")}nav{height:33px;padding:0}nav ul{display:flex;gap:20px;height:33px;margin:0;padding:0;list-style:none}nav li{height:34px}nav a{display:inline-block;height:24px;font-size:14px}nav span{white-space:nowrap;height:24px;padding:4px 8px 0}.topic{display:inline-flex;gap:15px;height:30px}.brand-strip{display:flex;gap:15px;background:#222;color:#fff}.brand-strip a{color:inherit}
 h3 a.flex-title{display:flex;flex-direction:row;font-family:Arial;font-size:18px}h3 a.flex-title .headline{font-family:Georgia,'Times New Roman',serif;font-size:24px}
 </style><nav-hat></nav-hat><header><h1 id="masthead"><a id="brand" class="brand-logo" href="#brand" aria-label="Journal Logo">The Daily Journal</a></h1><nav id="nav"><ul role="menubar"><li><a href="#world" id="world"><span>World</span></a></li><li><a href="#business"><span>Business</span></a></li><li><a href="#us"><span>U.S.</span></a></li></ul></nav><div class="topic"><a id="video" href="#video">Video</a><button id="signin">Sign In</button></div><div class="ticker">Nikkei 67544.67</div><form><button id="form">Send</button></form></header><main>
 <section><h2 id="hidden-title" style="position:absolute;width:1px;height:1px;overflow:hidden">Top Stories</h2><article class="card"><h3 id="title"><a id="title-link" class="flex-title" href="#article"><div class="headline">Markets, Pulled in Two Directions, End a Volatile Week</div></a></h3><p id="visible-summary" aria-hidden="true">A visible summary can be excluded from screen-reader duplication.</p><p id="natural" style="color:rgb(34,34,34)">Inflation and technology are competing for attention.<br>Do not change the number 12.</p></article><article><h3>Another news headline</h3><p id="clamp" class="clamped">A summary with a clipping limit should grow when the translation is inserted.</p></article></section>
 <section><img alt="Public fixture" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='560' height='160'%3E%3Crect width='560' height='160' fill='%23cddcdb'/%3E%3C/svg%3E"><article><h3 id="center" style="text-align:center"><a href="#center">A Centre-Aligned News Headline With Its Original Link</a></h3><p id="links">Read <a id="inline-link" href="#inline">the report</a> and follow the evidence.</p></article></section>
 <section><h3>Opinion</h3><p>A third column remains in its original position.</p></section></main>`);
 await page.evaluate(()=>{
  document.querySelector('nav-hat').attachShadow({mode:'open'}).innerHTML='<style>nav{height:31px;background:#222;color:#fff}ul{display:flex;gap:20px;height:31px;margin:0;list-style:none}a{display:block;color:inherit}span{white-space:normal}</style><nav><ul><li><a id=shadow-brand href=#wsj><span>WSJ</span></a></li><li><a href=#barrons><span>Barron’s</span></a></li></ul></nav>';
  window.calls=[];window.pending=[];window.hold=false;window.clicks=0;window.scans=0;window.navClicks=0;window.brandClicks=0;
  document.querySelector('#world').addEventListener('click',e=>{e.preventDefault();window.navClicks++;});
  document.querySelector('#brand').addEventListener('click',e=>{e.preventDefault();window.brandClicks++;});
  const query=document.querySelectorAll.bind(document);document.querySelectorAll=function(selector){if(selector==='main,article,[role=main]')window.scans++;return query(selector);};
  document.querySelector('#title-link').addEventListener('click',e=>{e.preventDefault();window.clicks++;});
  document.querySelector('#inline-link').addEventListener('click',e=>{e.preventDefault();window.clicks++;});
  window.chrome={runtime:{sendMessage:async m=>{
   window.calls.push(m);
   if(m.type==='webStart')return {ok:true,value:{id:'layout-test',profile:{provider:'tencent'},target:'zh-TW'}};
   if(m.type==='text'){
    if(window.hold)await new Promise(resolve=>window.pending.push(resolve));
    const labels={'World':'世界','Business':'商业','U.S.':'美国','Video':'视频','Sign In':'登录','The Daily Journal':'每日新闻','WSJ':'华尔街日报','Barron’s':'巴伦周刊'};
    return {ok:true,value:Object.fromEntries(Object.entries(m.blocks).map(([k,t])=>[k,labels[t]||'用于检查网页布局的完整中文译文，保留标题、段落以及链接。']))};
   }
   throw Error('Unexpected RPC '+m.type);
  }}};
 });
 const headerBaseline=await page.locator('header').evaluate(e=>e.innerHTML);
 const originalNavWidth=await page.locator('#world').evaluate(e=>e.getBoundingClientRect().width);
 const brandBackground=await page.locator('#brand').evaluate(e=>getComputedStyle(e).backgroundImage);
 const baseline=await page.locator('#natural').getAttribute('style');
 const widths=await page.locator('main>section').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().width));
 await page.addScriptTag({content:compiled.outputFiles[0].text});
 await page.evaluate(()=>window.web.retry());
 await page.waitForFunction(()=>document.querySelectorAll('[data-mwt=translation]').length>=8);
 await page.waitForFunction(()=>window.feedback.state.phase==='ready');
 assert.equal(await page.locator('#natural').getAttribute('style'),baseline,'Natural paragraph style changed');
 assert.equal(await page.locator('#brand [data-mwt=translation]').textContent(),'每日新闻');
 assert.equal(await page.locator('#brand').evaluate(e=>getComputedStyle(e).backgroundImage),brandBackground,'Brand graphic changed');
 assert.ok(await page.locator('#brand [data-mwt=translation]').evaluate(e=>e.getBoundingClientRect().top>=e.parentElement.getBoundingClientRect().bottom-1),'Brand caption overlaps original');
 assert.equal(await page.locator('#world > span > [data-mwt=translation]').textContent(),'世界');
 assert.ok(await page.locator('#world').evaluate(e=>{const tr=e.querySelector('[data-mwt]'),r=e.getBoundingClientRect(),t=tr.getBoundingClientRect();return t.width<=r.width+1&&t.bottom<=r.bottom+1;}),'Nav translation spills outside link');
 assert.ok(await page.locator('#nav').evaluate(e=>e.getBoundingClientRect().top>=document.querySelector('#brand [data-mwt]').getBoundingClientRect().bottom),'Brand caption overlaps nav');
 assert.equal(await page.locator('nav-hat').evaluate(e=>e.shadowRoot.querySelectorAll('[data-mwt=translation]').length),2,'Open shadow header skipped');
 assert.ok(await page.locator('#world').evaluate((e,width)=>Math.abs(e.getBoundingClientRect().width-width)<1,originalNavWidth),'Navigation padding increased its width');
 assert.ok(await page.locator('#world [data-mwt=translation]').evaluate(e=>e.getBoundingClientRect().bottom<=document.querySelector('#nav').getBoundingClientRect().bottom),'Fixed-height nav clips translation');
 assert.ok(await page.locator('nav-hat').evaluate(e=>{const a=e.shadowRoot.querySelector('#shadow-brand'),r=a.getBoundingClientRect(),t=a.querySelector('[data-mwt]').getBoundingClientRect();return t.top>=r.top&&t.bottom<=r.bottom+1&&r.height<32;}),'Brand bar wraps or clips translation');
 assert.equal(await page.locator('#form [data-mwt=translation]').count(),0,'Form submitted text translated');
 await page.locator('#world [data-mwt=translation]').click();assert.equal(await page.evaluate(()=>window.navClicks),1);
 await page.locator('#brand [data-mwt=translation]').click();assert.equal(await page.evaluate(()=>window.brandClicks),1);

 assert.equal(await page.locator('#title').getAttribute('style'),null,'Natural title style changed');
 assert.equal(await page.locator('#visible-summary [data-mwt=translation]').count(),1,'Visible aria-hidden summary skipped');
 assert.equal(await page.locator('#hidden-title [data-mwt=translation]').count(),0,'Screen-reader-only heading translated');
 assert.equal(await page.locator('#hidden-title').evaluate(e=>e.getBoundingClientRect().height),1,'Hidden heading expanded into visible content');
 assert.equal(await page.locator('#title-link [data-mwt=translation]').count(),1,'Translated title is outside original link');
 assert.equal(await page.locator('#title-link > *').count(),1,'Translation added a second flex item beside original title');
 assert.equal(await page.locator('#title-link .headline > [data-mwt=translation]').count(),1,'Translation not inside original title text leaf');
 const typography=await page.locator('#title-link [data-mwt=translation]').evaluate(e=>({font:getComputedStyle(e).fontFamily,size:getComputedStyle(e).fontSize,color:getComputedStyle(e).color,line:getComputedStyle(e).lineHeight,lang:e.lang}));
 assert.match(typography.font,/Georgia/);assert.equal(typography.size,'24px');assert.equal(typography.color,'rgb(17, 17, 17)');assert.equal(typography.lang,'zh-TW');
 assert.equal(await page.locator('#center [data-mwt=translation]').evaluate(e=>getComputedStyle(e).textAlign),'center');
 assert.deepEqual(await page.locator('main>section').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().width)),widths);
 assert.ok(await page.locator('#clamp').evaluate(e=>e.clientHeight>42),'Clamped summary remains clipped');
 assert.ok(await page.evaluate(()=>window.calls.some(m=>m.type==='text'&&Object.values(m.blocks).some(t=>t.includes('attention.\nDo not')))),'BR boundary lost');
 const originalNode=await page.locator('#title-link [data-mwt=translation]').evaluate(e=>{window.keptTranslation=e;return true;});
 const scans=await page.evaluate(()=>window.scans);await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>window.scans),scans,'Own insertions caused repeated discovery');
 await page.evaluate(()=>window.web.start('dual'));
 assert.equal(await page.locator('#title-link [data-mwt=translation]').evaluate(e=>e===window.keptTranslation),originalNode,'Same-mode switch rebuilt translation');
 await page.locator('#title-link [data-mwt=translation]').click();assert.equal(await page.evaluate(()=>window.clicks),1);
 await page.screenshot({path:'.local/web-layout-fixed.png'});
 await page.setViewportSize({width:1000,height:1000});
 assert.ok(await page.locator('#world').evaluate(e=>e.querySelector('[data-mwt]').getBoundingClientRect().bottom<=e.getBoundingClientRect().bottom+1),'Resized nav is clipped');
 await page.setViewportSize({width:1400,height:1000});
 await page.evaluate(()=>window.web.start('mono'));
 await page.locator('#title-link [data-mwt=translation]').click();assert.equal(await page.evaluate(()=>window.clicks),2,'Mono link event lost');
 await page.locator('#world [data-mwt=translation]').click();assert.equal(await page.evaluate(()=>window.navClicks),2,'Mono nav link event lost');
 await page.evaluate(()=>window.web.restore());assert.equal(await page.locator('[data-mwt=translation]').count(),0);
 assert.equal(await page.locator('header').evaluate(e=>e.innerHTML),headerBaseline,'Header nodes/styles were not restored');
 assert.equal(await page.locator('nav-hat').evaluate(e=>e.shadowRoot.querySelectorAll('[data-mwt=translation]').length),0);
 assert.equal(await page.locator('#natural').getAttribute('style'),baseline);assert.equal((await page.locator('#clamp').getAttribute('style'))||null,null);
 await page.locator('#inline-link').click();assert.equal(await page.evaluate(()=>window.clicks),3,'Original inline event lost');
 await page.evaluate(()=>{window.hold=true;const p=document.createElement('p');p.id='pending';p.textContent='Pending source to test late responses';document.querySelector('main section').prepend(p);});
 await page.evaluate(()=>window.web.retry());await page.waitForFunction(()=>window.pending.length>0);
 await page.evaluate(()=>{window.web.restore();window.hold=false;window.pending.splice(0).forEach(resolve=>resolve());});
 await page.waitForTimeout(250);assert.equal(await page.locator('[data-mwt=translation]').count(),0,'Late response reinserted after restore');
 const count=await page.evaluate(()=>window.calls.filter(m=>m.type==='text').length);
 await page.evaluate(()=>window.web.retry());await page.locator('#pending [data-mwt=translation]').waitFor();
 assert.equal(await page.evaluate(()=>window.calls.filter(m=>m.type==='text').length),count,'Toggle repeated completed request');
 await page.evaluate(()=>{window.hold=true;const p=document.createElement('p');p.id='changed';p.textContent='Old dynamic source';document.querySelector('main section').prepend(p);});
 await page.waitForFunction(()=>window.pending.length>0);
 await page.evaluate(()=>{window.web.restore();document.querySelector('#changed').textContent='Replacement source';window.hold=false;window.pending.splice(0).forEach(resolve=>resolve());});
 await page.waitForTimeout(250);assert.equal(await page.locator('#changed').textContent(),'Replacement source');
 await page.evaluate(()=>window.web.retry('mono'));await page.locator('#changed [data-mwt=translation]').waitFor();
 await page.evaluate(()=>{document.querySelector('#changed').textContent='New source supplied by the website during mono mode';});
 await page.waitForFunction(()=>document.querySelector('#changed [data-mwt=translation]'));
 await page.evaluate(()=>window.web.restore());
 assert.equal(await page.locator('#changed').textContent(),'New source supplied by the website during mono mode','Mono restore appended stale retained source');
 const report={browser:browser.version(),typography,columns:widths,checks:['nestedLinkTypography','titleRemainsClickable','monoLinkEvents','naturalStylesUntouched','clampExpansionAndRestore','BRBoundaries','columnWidthsPreserved','noOwnMutationRescan','sameModeNoRebuild','restoreWhilePending','lateResponseCached','dynamicSourceProtected','monoDynamicSourceProtected','screenReaderHeadingPreserved','flexTitleHasOneItem','visibleAriaHiddenSummary','headerNavTranslated','headerLinkEvents','brandGraphicPreserved','brandCaptionOutsideGraphic','brandCaptionNoNavOverlap','shadowHeaderTranslated','headerRestore','resizedNav','monoNavEvents','fixedHeightNavNoClipping','navigationPaddingWidthPreserved','shadowBrandSingleLine'],realProvider:false};
 await writeFile('.local/web-layout-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
