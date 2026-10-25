import {surfaceStamp,type Surface} from './site-readers';

/** A non-interactive visual layer; the website retains its canvas and all handlers. */
export class CanvasOverlay{
 private entries=new Map<Element,{surface:Surface;image:HTMLImageElement;key:string}>();
 private root=document.createElement('div');
 constructor(){
  this.root.dataset.mwt='canvas-output';this.root.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147480000';
  document.documentElement.append(this.root);
  window.addEventListener('scroll',()=>this.update(),true);window.addEventListener('resize',()=>this.update());
  new MutationObserver(records=>{if(records.some(r=>!(r.target instanceof Element)||!r.target.closest('[data-mwt]')))this.update();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data','data-index','data-page','data-page-index','data-page-number','src','data-src','data-url','class','style']});
 }
 show(surface:Surface,data:string,key:string){
  const old=this.entries.get(surface.element);if(old?.key===key){this.update();return;}
  old?.image.remove();const image=document.createElement('img');image.alt='当前漫画页译图';image.src=data;
  image.style.cssText='position:fixed;pointer-events:none;max-width:none!important;max-height:none!important;object-fit:fill;margin:0;padding:0;border:0';
  this.root.append(image);this.entries.set(surface.element,{surface,image,key});this.update();
 }
 clear(){for(const e of this.entries.values())e.image.remove();this.entries.clear();}
 reconcile(surfaces:Surface[]){for(const [el,e] of this.entries)if(!surfaces.some(s=>s.element===el&&s.page.url===e.surface.page.url)){e.image.remove();this.entries.delete(el);}this.update();}
 private update(){
  for(const [el,entry]of this.entries){
   if(!el.isConnected||surfaceStamp(el)!==entry.surface.stamp){entry.image.remove();this.entries.delete(el);continue;}
   const r=el.getBoundingClientRect();let left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
   for(let p=el.parentElement;p;p=p.parentElement){const css=getComputedStyle(p),b=p.getBoundingClientRect();if(/hidden|clip|scroll|auto/.test(css.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/hidden|clip|scroll|auto/.test(css.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}
   const css=getComputedStyle(el);const shown=css.visibility!=='hidden'&&css.display!=='none'&&right>left&&bottom>top;
   const value={display:shown?'block':'none',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',clipPath:`inset(${Math.max(0,top-r.top)}px ${Math.max(0,r.right-right)}px ${Math.max(0,r.bottom-bottom)}px ${Math.max(0,left-r.left)}px)`};
   // Avoid triggering our own style observer when bounds have not changed.
   for(const [k,v]of Object.entries(value))if((entry.image.style as any)[k]!==v)(entry.image.style as any)[k]=v;
  }
 }
}
