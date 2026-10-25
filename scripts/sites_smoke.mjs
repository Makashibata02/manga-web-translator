import {chromium} from 'playwright';
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
const bundle=await build({stdin:{contents:"import {readChapter} from './extension/adapters';window.__chapter=readChapter();",resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[];
try{
 for(const url of [
 'https://godamh.com/manga/pandajunheleisajun-hiyaku/39009-3-39009_4',
 'https://www.mangabz.com/m517253/',
 'https://www.yymanhua.com/m517253/',
 'https://manhuabika.com/']){
  const page=await browser.newPage();
  try{
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
   await page.waitForTimeout(2500);await page.addScriptTag({content:bundle.outputFiles[0].text});
   const result=await page.evaluate(()=>({title:document.title,chapter:window.__chapter,imageCount:document.images.length,loaded:[...document.images].filter(im=>im.naturalWidth>300).length}));
   results.push({url,http:response?.status(),...result});
  }catch(e){results.push({url,error:String(e).split('\n')[0]});}
  finally{await page.close();}
 }
}finally{await browser.close();}
await writeFile('.local/site-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(r=>({...r,chapter:r.chapter?{...r.chapter,pages:r.chapter.pages.slice(0,2)}:null})),null,2));
