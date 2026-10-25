import {mangaSite} from './site-catalog';
import type {Chapter,PageRef} from './types';

export type Surface={page:PageRef;element:HTMLImageElement|HTMLCanvasElement;stamp:string};
const ROOTS='#_imageList,.reading-content,#readerarea,#chapter-images,.chapter-content,.chapter-images,.manga-reader,.comic-reader,.reader-container,.reader-images,#manga-reader,.viewer_img,[data-manga-reader],[data-comic-reader]';
const EXCLUDE='[data-mwt],nav,header,footer,aside,[role=banner],.ads,.advertisement,[data-ad],.chapter-list,.recommendations,.related-manga';
let chapterKey='',ledger=new Map<string,number>(),current:Surface[]=[];
function number(raw:string|null){return raw!==null&&/^\d+$/.test(raw.trim())?Number(raw):undefined;}
function hash(text:string){let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(16);}
export function canonicalChapter(){
 const u=new URL(location.href);const q=new URLSearchParams();
 for(const key of ['title_no','episode_no','chapter','chapter_id','episode','episode_id','cid','id','book_id','content_id','work_id','book','bookId','chapterId','episodeId','volume','volume_id','bid','section_id'])if(u.searchParams.has(key))q.set(key,u.searchParams.get(key)!);
 q.sort();return u.origin+u.pathname+(q.size?'?'+q:'')+(/^#\/?(?:read|chapter|episode|comic)\//i.test(u.hash)?u.hash.replace(/([?&])page=\d+/,''): '');
}
function external(raw:string){try{const u=new URL(raw,location.href);if(!['https:','http:'].includes(u.protocol))return '';if(/^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(u.hostname)||u.username||u.password)return '';return u.href;}catch{return '';}}
export function readerImageSource(im:HTMLImageElement){
 for(const key of ['data-src','data-original','data-lazy-src','data-url','data-original-src','data-cfsrc','data-echo','data-mwt-source']){
  const v=im.getAttribute(key)?.trim();if(v&&!/\b(?:blank|spacer|transparent|loading|placeholder)\b/i.test(v)){const out=external(v);if(out)return out;}
 }
 const set=im.getAttribute('data-srcset')||im.getAttribute('srcset');
 if(set){const entries=set.split(',').map(s=>s.trim().split(/\s+/)).sort((a,b)=>(parseFloat(b[1])||0)-(parseFloat(a[1])||0));const out=external(entries[0]?.[0]||'');if(out)return out;}
 return external(im.currentSrc||im.src);
}
function identityURL(url:string){try{const u=new URL(url);for(const key of [...u.searchParams.keys()])if(/^(token|expires?|signature|x-amz-.+|x-oss-.+)$/i.test(key))u.searchParams.delete(key);return u.href;}catch{return url;}}
function canvasSignature(el:HTMLCanvasElement){
 try{const c=document.createElement('canvas');c.width=16;c.height=16;const ctx=c.getContext('2d')!;ctx.drawImage(el,0,0,16,16);const a=ctx.getImageData(0,0,16,16).data;if(!a.some((v,i)=>i%4===3&&v))return 'unpainted';return hash(Array.from(a).join(','));}catch{return 'restricted';}
}
function stamp(el:Element){
 return hash((el instanceof HTMLCanvasElement?el.width+':'+el.height+':'+canvasSignature(el):'')+
[el.tagName,...['data','data-page','data-index','data-page-index','data-page-number','data-src','data-url','src'].map(k=>el.getAttribute(k)||''),el.parentElement?.getAttribute('data-index')||''].join('|'));
}
function explicitIndex(el:Element){
 for(const key of ['data-index','data-page-index']){const n=number(el.closest('['+key+']')?.getAttribute(key)??null);if(n!==undefined&&n<10000)return n;}
 for(const key of ['data-page-number','data-page']){const n=number(el.closest('['+key+']')?.getAttribute(key)??null);if(n!==undefined&&n>0&&n<=10000)return n-1;}
 if(el instanceof HTMLImageElement){const n=readerImageSource(el).match(/_p(\d+)(?:_|\.)/);if(n)return Number(n[1]);}
 return undefined;
}
function large(el:HTMLImageElement|HTMLCanvasElement,strict=false){
 const w=el instanceof HTMLImageElement?Number(el.getAttribute('width'))||el.naturalWidth||el.width:el.width;
 const h=el instanceof HTMLImageElement?Number(el.getAttribute('height'))||el.naturalHeight||el.height:el.height;
 return w>=(strict?360:180)&&h>=(strict?300:120);
}
function readerRoute(){if(/chapter[-_/]list|manga[-_/]list|\/directory(?:\/|$)/i.test(location.pathname))return false;return /\/(?:episode|chapter|read|reader|viewer|view|artworks|readcomic|read-online)(?:[\/?.-]|$)|chapter-\d|[?&](?:episode_no|chapter_id)=/i.test(location.pathname+location.search+location.hash);}
export function siteChapter():Chapter|undefined{
 const site=mangaSite(location.hostname);if(!site)return;
 const id=canonicalChapter();if(id!==chapterKey){chapterKey=id;ledger=new Map();}current=[];
 const giga=document.querySelector('.js-viewer-content');
 let root:Element|null=giga||document.querySelector(ROOTS);
 let nodes:(HTMLImageElement|HTMLCanvasElement)[]=root?[...root.querySelectorAll<HTMLImageElement|HTMLCanvasElement>('img,canvas')]:[];
 if(!root&&/pixiv\.net$/.test(site.host)&&/\/artworks\/\d+/.test(location.pathname)){
  root=document.querySelector('main');nodes=[...document.querySelectorAll<HTMLImageElement>('main img[src*="pximg.net"],main img[data-src*="pximg.net"]')];
 }
 const structured=!!root;
 if(!root&&readerRoute()){
  const candidates=[...document.querySelectorAll<HTMLImageElement|HTMLCanvasElement>('img,canvas')].filter(el=>large(el,true)&&!el.closest(EXCLUDE));
  nodes=candidates.filter(el=>{const a=el.closest<HTMLAnchorElement>('a[href]');if(!a)return true;try{const u=new URL(a.href);return /\.(png|jpe?g|webp|avif)(?:$|\?)/i.test(u.href)||u.origin===location.origin&&u.pathname===location.pathname;}catch{return false;}});
 }

 nodes=nodes.filter(el=>!el.closest(EXCLUDE)&&(large(el,!structured)||el.matches('canvas.js-page-image')||el instanceof HTMLImageElement&&!!readerImageSource(el)&&structured&&!!el.getAttribute('data-src')));
 // A catalogue page with thumbnails is never a chapter merely because its domain is listed.
 if(!structured&&(!readerRoute()||nodes.length<2&&!nodes.some(el=>el instanceof HTMLCanvasElement)))nodes=[];
 const indices=new Set<number>();
 const gigaSlots=giga?[...giga.querySelectorAll<HTMLElement>('.js-page-area')].filter(el=>!el.matches('.js-back-matter-area')&&!el.querySelector('.js-link-page,.js-page-ad')):[];
 for(const [order,element] of nodes.entries()){
  const local=element instanceof HTMLCanvasElement||element instanceof HTMLImageElement&&element.src.startsWith('blob:')&&!readerImageSource(element);
  const source=element instanceof HTMLImageElement?readerImageSource(element):'';
  if(!source&&!local)continue;
  const revision=stamp(element);
  if(!giga&&element instanceof HTMLCanvasElement&&canvasSignature(element)==='unpainted')continue;
  const key=local?'local:'+revision:identityURL(source);
  let index=explicitIndex(element);if(index===undefined)index=giga?gigaSlots.indexOf(element.closest<HTMLElement>('.js-page-area')!):root?.id==='_imageList'?order:ledger.get(key);
  if(index!==undefined&&index<0)continue;
  if(index===undefined)index=Math.max(-1,...ledger.values())+1;
  if(indices.has(index))continue;indices.add(index);ledger.set(key,index);
  const w=element instanceof HTMLImageElement?element.naturalWidth||element.width:element.width,h=element instanceof HTMLImageElement?element.naturalHeight||element.height:element.height;
  const page:PageRef={index,url:local?'mwt-local:'+index+(giga?'':':'+revision):source,...(local?{local:true}:{}),...(w>32&&h>32?{width:w,height:h}:{})};
  current.push({page,element,stamp:revision});
 }
 const count=number(root?.getAttribute('data-total-pages')??null);
 const full=giga||root?.id==='_imageList';const total=giga?gigaSlots.length:full&&current.length?current.length:count;
 const knownPages:PageRef[]=giga?gigaSlots.map((_,index)=>current.find(s=>s.page.index===index)?.page||{index,url:'mwt-local:'+index,local:true}):current.map(s=>s.page);
 const complete=!!total&&total>0&&total<=10000&&(full?knownPages.length===total:indices.size===total&&[...indices].every(i=>i<total));
 const hasCanvas=!!giga||current.some(s=>s.page.local);
 const note=current.length?(hasCanvas?'Canvas 阅读器：随阅读收集已绘制页面；可手动扫描本章。':complete?'本章页面清单已发现完整。':'当前已发现 '+current.length+' 页；未确认章尾，继续阅读或手动扫描。'):
  document.querySelector('canvas,iframe')&&readerRoute()?'阅读器尚未提供可读取画面；请先正常打开阅读页。受保护或跨域阅读器可用圈选翻译。':'请先打开具体章节；目录、封面和推荐图片不会当作漫画正文。';
 return {id,title:document.title,site:location.hostname,pages:knownPages,total:total||undefined,complete,reader:false,adapter:hasCanvas?'canvas':structured?'reader-dom':'guarded-dom',note};
}
export function readerSurfaces(ch:Chapter){siteChapter();return chapterKey===ch.id?current.filter(s=>ch.pages.some(p=>p.index===s.page.index&&p.url===s.page.url)):[];}
export function siteReader(){const ch=siteChapter();return !!ch&&(ch.pages.length>0||readerRoute()&&!!document.querySelector('canvas,iframe'));}
export function surfaceStamp(element:Element){return stamp(element);}
export function surfaceVisible(el:Element){
 const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return false;
 let left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
 for(let p:Element|null=el;p;p=p.parentElement){const css=getComputedStyle(p);if(css.visibility==='hidden'||css.display==='none'||Number(css.opacity)===0)return false;if(p===el)continue;const b=p.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(css.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/hidden|clip|auto|scroll/.test(css.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}
 return right>left&&bottom>top;
}
export async function localPixels(surface:Surface):Promise<string|null>{
 const el=surface.element;if(!el.isConnected||surface.stamp!==stamp(el))return null;
 if(!surfaceVisible(el))return null;
 if(el instanceof HTMLImageElement){const u=new URL(el.src);if(u.protocol!=='blob:'||u.origin!==location.origin)return null;const b=await(await fetch(u)).blob();if(b.size>24*1024*1024)throw Error('当前页图片超过大小上限');return blobData(b);}
 if(el.width*el.height>100000000)throw Error('当前页图片超过像素上限');
 // Read only pixels the normal reader has already painted; no tile/decryption hooks.
 const sample=document.createElement('canvas');sample.width=16;sample.height=16;const ctx=sample.getContext('2d')!;
 ctx.drawImage(el,0,0,16,16);const pixels=ctx.getImageData(0,0,16,16).data;
 if(!pixels.some((n,i)=>i%4===3&&n>0))return null; // Unpainted lazy canvas, not a blank translation.
 const b=await new Promise<Blob>((resolve,reject)=>el.toBlob(b=>b?resolve(b):reject(Error('画面尚未就绪')),'image/png'));
 if(surface.stamp!==stamp(el))return null;return blobData(b);
}
function blobData(blob:Blob){return new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(blob);});}

export function pageControls(){
 if(!document.querySelector('.js-viewer-content'))return null;
 const next=document.querySelector<HTMLElement>('.js-slide-forward'),previous=document.querySelector<HTMLElement>('.js-slide-backward');
 if(!next||!previous)return null;
 for(const el of [next,previous]){const raw=el.getAttribute('href');if(raw&&raw!=='#'&&!/^javascript:void\(0\);?$/.test(raw)){try{const u=new URL(raw,location.href);if(u.origin!==location.origin||u.pathname!==location.pathname)return null;}catch{return null;}}}
 return {next,previous};
}
