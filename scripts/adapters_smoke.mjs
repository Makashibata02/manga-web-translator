import {chromium} from 'playwright';import {build} from 'esbuild';import assert from 'node:assert/strict';
const bundle=(await build({entryPoints:['extension/adapters.ts'],bundle:true,write:false,format:'iife',globalName:'adapter'})).outputFiles[0].text;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage();let checks=0;
 async function fixture(url,html){await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto(url);await page.addScriptTag({content:bundle});}
 await fixture('https://www.yymanhua.com/m517253-p2/','<script>var YYMANHUA_IMAGE_COUNT=40;var YYMANHUA_CID=517253;var YYMANHUA_PAGEINDEX=2;</script><img id="cp_image" src="https://cdn.example.com/2.png">');
 let ch=await page.evaluate(()=>adapter.readChapter());assert.equal(ch.pages.length,40);assert.equal(ch.pages[24].pageURL,'https://www.yymanhua.com/m517253-p25/');assert.equal(ch.pages[1].url,'https://cdn.example.com/2.png');checks++;
 await fixture('https://godamh.com/test','<div id="chapterContent" data-ms="book" data-cs="chapter"></div><div id="chapcontent"><img data-src="https://cdn.example.com/1.png" data-index="0"><img data-src="https://cdn.example.com/2.png" data-index="1"></div>');
 ch=await page.evaluate(()=>adapter.readChapter());assert.equal(ch.complete,true);assert.equal(ch.total,2);checks++;
 await fixture('https://manhuabika.com/comic/reader/book/chapter','<div class="vw-image-item" data-index="0"><img class="vw-image" src="https://cdn.example.com/1.png"></div>');
 ch=await page.evaluate(()=>adapter.readChapter());assert.equal(ch.complete,false);assert.equal(ch.pages.length,1);
 await page.evaluate(()=>{document.querySelector('[data-index]').dataset.index='24';document.querySelector('img').src='https://cdn.example.com/25.png';});
 ch=await page.evaluate(()=>adapter.readChapter());assert.equal(ch.pages[0].index,24);assert.equal(ch.pages[0].url,'https://cdn.example.com/25.png');checks++;
 await page.evaluate(()=>{const im=document.querySelector('img');im.dataset.mwtSource='https://cdn.example.com/25.png';im.src='data:image/png;base64,xx';im.dataset.src='https://cdn.example.com/26.png';});
 assert.equal(await page.evaluate(()=>adapter.imageSource(document.querySelector('img'))),'https://cdn.example.com/26.png');checks++;
 const unsafe=await page.evaluate(()=>['javascript:alert(1)','http://127.0.0.1/a','http://localhost/a','data:image/png,xx','http://[::1]/a'].map(x=>adapter.safeURL(x)));assert.ok(unsafe.every(x=>x===''));checks++;
 console.log(JSON.stringify({browser:browser.version(),adapterChecks:checks,realSites:false}));
}finally{await browser.close();}
