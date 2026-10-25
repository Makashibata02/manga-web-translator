import {siteChapter,siteReader,readerSurfaces,readerImageSource,surfaceVisible} from './site-readers';
import type {Chapter,PageRef} from './types';
export function safeURL(raw:string,base=location.href):string{
 try {const u=new URL(raw,base);if(!['http:','https:'].includes(u.protocol))return '';if(u.username||u.password||/^(localhost|127\.|0\.|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(u.hostname))return '';return u.href;}catch{return '';}
}
export function imageSource(img:HTMLImageElement):string{
 return readerImageSource(img);
}
function dimensions(img:HTMLImageElement){return img.naturalWidth>32&&img.naturalHeight>32?{width:img.naturalWidth,height:img.naturalHeight}:{};}
function scalar(name:string):string{
 for(const script of document.scripts){
  const m=script.textContent?.match(new RegExp('\\b'+name+'\\s*=\\s*["\\x27]?([^;\\s"\\x27]+)'));
  if(m)return m[1];
 }return '';
}
export function readChapter():Chapter{
 const host=location.hostname; const pages:PageRef[]=[];
 let id=location.origin+location.pathname,title=document.title.replace(/<[^>]*>/g,''),total:number|undefined,complete=false,reader=false;
 let images:HTMLImageElement[]=[];
 if((host==='godamh.com'||host.endsWith('.godamh.com'))){
  const meta=document.querySelector<HTMLElement>('#chapterContent');id=host+':'+(meta?.dataset.ms||location.pathname)+':'+(meta?.dataset.cs||'');
  title=title||meta?.dataset.ct||'漫画章节';
  images=[...document.querySelectorAll<HTMLImageElement>('#chapcontent img[data-src][data-index]')];
  images.forEach((im,i)=>pages.push({index:Number(im.dataset.index)||i,url:imageSource(im),...dimensions(im)}));
  total=images.length||undefined; complete=images.length>0;
 }else if(/(^|\.)(mangabz|yymanhua)\.com$/.test(host)){
  const prefix=host.includes('yymanhua')?'YYMANHUA_':'MANGABZ_';const count=Number(scalar(prefix+'IMAGE_COUNT'));const cid=scalar(prefix+'CID')||location.pathname.split('-p')[0];
  id=host+':'+cid; reader=true;
  const current=Number(scalar(prefix+'PAGEINDEX'))||Number(location.pathname.match(/-p(\d+)/)?.[1])||1;
  const img=document.querySelector<HTMLImageElement>('#cp_image');
  if(count>0&&count<10000){
   total=count;complete=true;const base=location.pathname.replace(/-p\d+\/?$/,'/').replace(/\/$/,'');
   for(let i=0;i<count;i++)pages.push({index:i,url:i===current-1&&img?imageSource(img):'',pageURL:location.origin+base+(i?'-p'+(i+1)+'/':'/')});
  }else if(img)pages.push({index:current-1,url:imageSource(img)});
  images=img?[img]:[];
 }else if((host==='manhuabika.com'||host.endsWith('.manhuabika.com'))){
  const route=location.pathname.match(/\/comic\/reader\/([^/]+)\/([^/]+)/);if(route)id=host+':'+route[1]+':'+route[2];
  images=[...document.querySelectorAll<HTMLImageElement>('.vw-image-item[data-index] img.vw-image')];
  images.forEach(im=>pages.push({index:Number(im.closest<HTMLElement>('[data-index]')!.dataset.index),url:imageSource(im),...dimensions(im)}));
 }else{
  const shared=siteChapter();if(shared)return shared;
  images=[...document.images].filter(im=>!im.closest('[data-mwt]')&&(im.naturalWidth>=400||im.width>=400)&&(im.naturalHeight>=300||im.height>=300));
  const seen=new Set<string>();images.forEach(im=>{const url=imageSource(im);if(url&&!seen.has(url)){seen.add(url);pages.push({index:pages.length,url,...dimensions(im)});}});
 }
 return {id,title,site:host,pages:pages.filter(p=>p.url||p.pageURL),total,complete,reader};
}
export function readingScroller():HTMLElement{
 const virtual=document.querySelector<HTMLElement>('.vw-virtuoso-container [data-virtuoso-scroller],.vw-virtuoso-container');if(virtual)return virtual;
 const seed=document.querySelector('.js-viewer-content')||document.querySelector('#_imageList,.reading-content,#readerarea,.reader-container,[data-manga-reader]');
 for(let p=seed;p instanceof HTMLElement;p=p.parentElement){const css=getComputedStyle(p);if((/auto|scroll/.test(css.overflowY)&&p.scrollHeight>p.clientHeight+5)||(/auto|scroll/.test(css.overflowX)&&p.scrollWidth>p.clientWidth+5))return p;}
 return document.scrollingElement as HTMLElement;
}
export function visibleIndices(ch:Chapter):number[]{
 const result:number[]=[];
 for(const s of readerSurfaces(ch)){const r=s.element.getBoundingClientRect();if(r.width>100&&surfaceVisible(s.element))result.push(s.page.index);}
 for(const im of document.images){
  const rect=im.getBoundingClientRect();if(rect.bottom<0||rect.top>innerHeight||rect.width<100)continue;
  const url=imageSource(im);const p=ch.pages.find(p=>p.url===url);if(p)result.push(p.index);
 }return result;
}

export function isMangaReader():boolean{
 const host=location.hostname;
 if((host==='godamh.com'||host.endsWith('.godamh.com')))return !!document.querySelector('#chapterContent[data-cs],#chapcontent img[data-index]');
 if(/(^|\.)(mangabz|yymanhua)\.com$/.test(host))return !!document.querySelector('#cp_image')&&readChapter().pages.length>0;
 if((host==='manhuabika.com'||host.endsWith('.manhuabika.com')))return /\/comic\/reader\//.test(location.pathname)&&!!document.querySelector('.vw-image-item');
 return siteReader()||!!document.querySelector('[data-manga-reader],[data-comic-reader]');
}
