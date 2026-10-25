import {rpc} from './types';
import {academicPage,academicCandidates,academicIgnored,academicText,checkAcademicTranslation,appendAcademicTranslation,type AcademicText} from './arxiv';

type Mode='dual'|'mono'|'original';
export type WebState={phase:'starting'|'running'|'ready'|'paused'|'error'|'original';count:number};
type BlockKind='content'|'navigation'|'brand'|'topic'|'dialog'|'control';
type Block={academic?:AcademicText;kind:BlockKind;element:HTMLElement;source:string;id:string;translation?:string;node?:HTMLElement;pending?:boolean;error?:string;displayMode?:Mode;saved:Map<HTMLElement,string|null>;originals:Node[];originalParent?:HTMLElement};
const MARK='data-mwt';
const excluded='input,textarea,select,pre,code,script,style,noscript,svg,math,[contenteditable],[translate=no],.notranslate,.sr-only,.visually-hidden,.screen-reader-text,['+MARK+']';
const chromeAreas='nav,footer,button,[role=navigation],[role=button],[role=banner]';
const selectors='h1,h2,h3,h4,h5,h6,p,figcaption,blockquote,li,dd,dt,summary,[role=heading]';
const dialogs='dialog,[role=dialog],[role=alertdialog],[aria-modal=true],#CybotCookiebotDialog,#onetrust-banner-sdk,#onetrust-pc-sdk,#didomi-host,#usercentrics-root,.qc-cmp2-container,[id^=sp_message_container]';
const topicSelector='[class*="RibbonContainer"]';
function parentAcross(el:Element):Element|null{const root=el.getRootNode();return el.parentElement||(root instanceof ShadowRoot?root.host:null);}
function closestAcross(el:Element,selector:string):Element|null{for(let p:Element|null=el;p;p=parentAcross(p))if(p.matches(selector))return p;return null;}
function dialogContext(el:Element){return closestAcross(el,dialogs);}
function topicSite(){return /(^|\.)wsj\.com$/i.test(location.hostname);}
function topicRoots():HTMLElement[]{return topicSite()?[...document.querySelectorAll<HTMLElement>(topicSelector)]:[];}
function ignored(el:HTMLElement){
 if(academicIgnored(el)||closestAcross(el,excluded)||topicSite()&&el.closest(topicSelector))return true;
 if(!dialogContext(el)&&closestAcross(el,chromeAreas))return true;
 const header=closestAcross(el,'header');if(header&&!closestAcross(header,'article')&&!dialogContext(el))return true;
 for(let p:Element|null=el;p&&p!==document.body;p=parentAcross(p)){
  // Container names do not determine whether already-visible article/consent text is readable.
  if(/(?:^|[-_\s])(logo|masthead|ticker|stock|quotes|advert|advertisement|adblock|ads|ad-slot|menu)(?:$|[-_\s])/i.test(p.getAttribute('class')+' '+p.id)&&!dialogContext(el))return true;
 }
 return false;
}
function visible(el:Element){
 if(!el.isConnected||!el.getClientRects().length)return false;
 const css=getComputedStyle(el),r=el.getBoundingClientRect();
 return css.visibility!=='hidden'&&css.visibility!=='collapse'&&css.display!=='none'&&r.width>2&&r.height>2&&css.clip==='auto'&&!/inset\(50%/.test(css.clipPath);
}
function originalText(el:HTMLElement){
 const walk=(node:Node):string=>{
  if(node.nodeType===Node.TEXT_NODE)return node.textContent||'';
  if(!(node instanceof Element))return '';
  if(node!==el){
   if(node.matches('['+MARK+'],.notranslate,.sr-only,.visually-hidden,.screen-reader-text,[translate=no],script,style,noscript,svg'))return '';
   const css=getComputedStyle(node);if(css.display==='none'||css.visibility==='hidden')return '';
  }
  if(node.tagName==='BR')return '\n';
  return [...node.childNodes].map(walk).join('');
 };
 return walk(el).trim();
}
function blockText(el:HTMLElement){return academicText(el)?.source??originalText(el);}
function codeLabel(el:HTMLElement,source:string){
 if(closestAcross(el,'code,pre'))return true;
 if([...el.querySelectorAll<HTMLElement>('code')].some(code=>originalText(code)===source))return true;
 return el.matches('h1,h2,h3,h4,h5,h6')&&!!document.querySelector('main code,article code')&&/^[A-Za-z_$][\w$]*(?:\.[\w$]+)*(?:\(\))?$/.test(source)&&(/[a-z][A-Z]/.test(source)||/\(\)$/.test(source));
}

function openContentRoots():ShadowRoot[]{
 const roots:ShadowRoot[]=[];
 const visit=(root:ParentNode)=>{for(const el of root.querySelectorAll('*')){
  if(!el.shadowRoot||closestAcross(el,'['+MARK+'],.notranslate,[id^=immersive-translate]'))continue;
  roots.push(el.shadowRoot);visit(el.shadowRoot);
 }};
 visit(document);return roots;
}
export function collectBlocks(roots:ParentNode[]=[document,...openContentRoots()]):HTMLElement[]{
 const academic=academicCandidates();
 const candidates=new Set<HTMLElement>(academic??roots.flatMap(root=>[...root.querySelectorAll<HTMLElement>(selectors)])),controls=new Set<HTMLElement>(),fallbacks=new Set<HTMLElement>();
 for(const root of roots){
  if(academic)for(const el of root.querySelectorAll<HTMLElement>(selectors))if(dialogContext(el))candidates.add(el);
  // Consent portals commonly sit outside main and use DIV text and short buttons/tabs.
  for(const el of root.querySelectorAll<HTMLElement>('button,[role=button],[role=tab],a[href]'))if(dialogContext(el)&&(el.matches('button,[role=button],[role=tab]')||el.parentElement&&originalText(el.parentElement)===originalText(el))){candidates.add(el);controls.add(el);}
  const walker=document.createTreeWalker(root===document?document.body:root as Node,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
   const node=walker.currentNode,parent=node.parentElement;
   if(academic&&parent&&!dialogContext(parent))continue;
   if(!parent||!(node.textContent||'').trim()||ignored(parent)||closestAcross(parent,'h1,h2,h3,h4,h5,h6,p,figcaption,blockquote,summary,[role=heading]')||closestAcross(parent,'button,[role=button],[role=tab]'))continue;
   const structural=closestAcross(parent,'li,dd,dt');
   if(structural){let separate=false;for(let p:Element|null=parent;p&&p!==structural;p=parentAcross(p))if(/^(block|flow-root|flex|grid|table-cell)/.test(getComputedStyle(p).display)){separate=true;break;}if(!separate)continue;}
   let el:HTMLElement|null=parent;
   while(el&&el!==document.body&&!/^(block|flow-root|flex|grid|table-cell|list-item|inline-block)/.test(getComputedStyle(el).display))el=el.parentElement;
   if(!el||el.matches('body,html,main,article')||ignored(el)||!visible(el))continue;
   if(el.querySelector(selectors)||[...el.children].some(child=>!child.matches('['+MARK+'],.notranslate,script,style')&&/^(block|flow-root|flex|grid|table|list-item)/.test(getComputedStyle(child).display)))continue;
   const source=originalText(el);if(source.length>=24||/[\u3040-\u30ff]/.test(source)){candidates.add(el);fallbacks.add(el);}
  }
 }
 return [...candidates].filter(el=>{
  if(ignored(el)||!visible(el)||el.querySelector(selectors))return false;
  // A tab/button inside a list owns its label; never translate both its wrapper and itself.
  if(!controls.has(el)&&[...el.querySelectorAll<HTMLElement>('button,[role=button],[role=tab],a[href]')].some(child=>controls.has(child)))return false;
  if(el.matches('li,dd,dt')&&[...fallbacks].some(child=>child!==el&&el.contains(child)))return false;
  const source=academicText(el)?.prose??originalText(el),minimum=dialogContext(el)?2:3;
  if(source.length<minimum||!/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/.test(source))return false;
  if(!academic&&codeLabel(el,source))return false;
  if(!/[\u3040-\u30ff]/.test(source)&&/[\u4e00-\u9fff]/.test(source)&&!/[A-Za-z]{3}/.test(source))return false;
  return true;
 });
}
function headerKind(el:HTMLElement):BlockKind{
 if(topicSite()&&el.closest(topicSelector))return 'topic';
 const css=getComputedStyle(el);
 return css.backgroundImage!=='none'&&parseFloat(css.textIndent)<0||!!el.querySelector('svg,img')&&/logo|brand/i.test(el.className+' '+el.getAttribute('aria-label'))?'brand':'navigation';
}
function collectHeaderBlocks(roots:ShadowRoot[]):HTMLElement[]{
 if(academicPage())return [];
 const headerSelector='header,nav,[role=banner],[role=navigation],nav-hat';
 const areas:ParentNode[]=[...document.querySelectorAll(headerSelector),...roots.flatMap(root=>[...root.querySelectorAll(headerSelector),...(closestAcross(root.host,headerSelector)?[root]:[])]),...topicRoots()];
 const elements=[...new Set(areas.flatMap(area=>[...area.querySelectorAll<HTMLElement>('a[href],button,[role=menuitem],.logo')]))];
 return elements.filter(el=>{
  if(dialogContext(el)||closestAcross(el,'footer,form,[contenteditable],[translate=no],.notranslate,['+MARK+'],.sr-only,.visually-hidden,.screen-reader-text'))return false;
  if(el.querySelector('a[href],button,[role=menuitem]')||!visible(el))return false;
  for(let parent:Element|null=el;parent;parent=parentAcross(parent)){
   if(/(?:^|[-_\s])(ticker|stock|quotes|advert|ads|avatar|user-profile)(?:$|[-_\s])/i.test(parent.getAttribute('class')+' '+parent.id))return false;
  }
  const source=originalText(el);
  return source.length>=2&&source.length<=160&&/[A-Za-z\u3040-\u30ff]/.test(source)&&!el.matches('input,textarea,select')&&!codeLabel(el,source);
 });
}
export class WebTranslation{
 private blocks=new Map<HTMLElement,Block>();private running=false;private starting=false;private mode:Mode='original';private generation=0;private batchId='';private batches=0;
 private observer:MutationObserver;private inflight=0;private scheduled=false;private dirty=true;private pumping=false;
 private headerRoots:ShadowRoot[]=[];private scrollRoots=new WeakSet<ShadowRoot>();private currentURL=location.href;
 private config:{provider:string;target:string}={provider:'tencent',target:'zh-CN'};
 constructor(private status:(message:string,state?:WebState)=>void){
  window.addEventListener('scroll',()=>this.schedule(),{passive:true,capture:true});
  const refresh=()=>{this.dirty=true;this.schedule();};window.addEventListener('resize',refresh);window.addEventListener('popstate',refresh);window.addEventListener('hashchange',refresh);document.addEventListener('visibilitychange',refresh);
  // attachShadow on an existing host emits no mutation in the light DOM. Only check roots/route here.
  window.setInterval(()=>{if(!this.running||document.visibilityState!=='visible')return;const roots=openContentRoots();if(location.href!==this.currentURL||roots.length!==this.headerRoots.length||roots.some(r=>!this.headerRoots.includes(r))){this.currentURL=location.href;refresh();}},1500);
  this.observer=new MutationObserver(records=>{
   const meaningful=records.some(r=>{
    const el=r.target instanceof Element?r.target:r.target.parentElement;
    if(el&&closestAcross(el,'['+MARK+'],.notranslate,[id^=immersive-translate]'))return false;
    if(r.type==='childList')return [...r.addedNodes,...r.removedNodes].some(n=>!(n instanceof Element&&n.matches('['+MARK+'],.notranslate')));
    return true;
   });
   if(meaningful){this.dirty=true;this.schedule();}
  });
  this.observe();
 }
 get active(){return this.starting||this.running||this.mode!=='original'&&[...this.blocks.values()].some(b=>!!b.node);}
 private report(message:string,phase:WebState['phase']){this.status(message,{phase,count:[...this.blocks.values()].filter(b=>b.translation).length});}
 private observe(){
  for(const root of [document.documentElement,...this.headerRoots.filter(r=>r.host.isConnected)]){
   this.observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','open','aria-hidden']});
   if(root instanceof ShadowRoot&&!this.scrollRoots.has(root)){root.addEventListener('scroll',()=>this.schedule(),{passive:true,capture:true});this.scrollRoots.add(root);}
  }
 }
 private editDOM(fn:()=>void){
  // Preserve any queued site changes, but do not rediscover our own inserted or moved nodes.
  if(this.observer.takeRecords().length)this.dirty=true;
  this.observer.disconnect();try{fn();}finally{this.observe();}
 }
 async toggle(){if(this.active)this.restore();else await this.retry();}
 resetProfile(){this.restore();this.blocks.clear();this.batchId='';this.dirty=true;}
 async start(mode:Mode='dual'){
  if(mode==='original'){this.restore();return;}
  this.mode=mode;
  if(this.running){this.applyMode();this.schedule();return;}
  if(this.starting)return;
  const token=++this.generation;this.starting=true;this.report('正在连接翻译服务…','starting');
  try{
   const b=await rpc('webStart',{title:document.title});if(token!==this.generation)return;
   this.batchId=b.id;this.config={provider:b.profile?.provider||'tencent',target:b.target||'zh-CN'};
   this.running=true;this.dirty=true;this.applyMode();this.report('正在翻译当前阅读位置…','running');this.schedule();
  }catch(e){if(token===this.generation){this.running=false;this.report(String(e),'error');}throw e;}
  finally{if(token===this.generation)this.starting=false;}
 }
 pause(){this.running=false;this.starting=false;this.generation++;this.report('已暂停，已完成译文保留。','paused');}
 restore(){
  this.running=false;this.starting=false;this.generation++;this.mode='original';
  this.editDOM(()=>{for(const b of this.blocks.values())this.clearDisplay(b);});
  this.report('已切回原文；点击浮球显示双语。','original');
 }
 switchMode(mode:Mode){if(mode==='original')this.restore();else void this.start(mode).catch(()=>{});}
 private clearDisplay(b:Block){
  b.node?.remove();b.node=undefined;b.displayMode=undefined;
  for(const [el,style]of b.saved){if(style===null){el.getAttribute('style');el.removeAttribute('style');}else el.setAttribute('style',style);}b.saved.clear();
  if(b.originals.length){(b.originalParent||b.element).append(...b.originals);b.originals=[];b.originalParent=undefined;}
 }
 private saveStyle(b:Block,el:HTMLElement){if(!b.saved.has(el))b.saved.set(el,el.getAttribute('style'));}
 private displayHeader(b:Block){
  const el=b.element,css=getComputedStyle(el),rect=el.getBoundingClientRect();
  const translated=document.createElement('span');translated.setAttribute(MARK,'translation');translated.lang=this.config.target;
  translated.textContent=b.translation!;translated.title=b.translation!;
  translated.style.cssText='padding:0;margin:0;border:0;height:auto;min-height:0;max-height:none;box-sizing:border-box;text-indent:0;text-transform:none;letter-spacing:normal;font-family:Arial,"Microsoft YaHei",sans-serif;font-weight:inherit;font-size:12px;line-height:1.25;white-space:normal;overflow-wrap:break-word;color:inherit;';
  if(b.kind==='control'){
   const label=[...el.querySelectorAll<HTMLElement>('span')].reverse().find(child=>originalText(child)===b.source&&!child.closest('['+MARK+'],.notranslate'))||el;
   translated.style.cssText='display:inline;font:inherit;color:inherit;line-height:inherit;letter-spacing:normal;white-space:normal;overflow-wrap:break-word;';
   translated.style.marginInlineStart=this.mode==='mono'?'0':'.35em';
   if(this.mode==='mono'){b.originalParent=label;b.originals=[...label.childNodes];for(const n of b.originals)n.parentNode?.removeChild(n);}
   label.append(translated);
  }else if(b.kind==='topic'){
   // Keep one flex item in the original anchor, just as the source's inline text flows.
   const label=[...el.querySelectorAll<HTMLElement>('span')].reverse().find(child=>originalText(child)===b.source&&!child.closest('['+MARK+'],.notranslate'))||el;
   this.saveStyle(b,label);label.style.whiteSpace='nowrap';
   translated.style.display='inline';translated.style.whiteSpace='nowrap';translated.style.fontFamily='inherit';
   translated.style.fontSize='0.92em';translated.style.lineHeight='inherit';translated.style.marginInlineStart=this.mode==='mono'?'0':'.4em';
   if(this.mode==='mono'){b.originalParent=label;b.originals=[...label.childNodes];for(const n of b.originals)n.parentNode?.removeChild(n);}
   label.append(translated);
  }else if(b.kind==='brand'){
   // Keep the original image/background and link intact. A caption uses the accessible source text.
   this.saveStyle(b,el);el.style.position='relative';el.style.overflow='visible';
   translated.style.cssText+='position:absolute;display:block;top:100%;left:0;right:0;text-align:center;font-size:14px;line-height:20px;color:'+getComputedStyle(el.parentElement||el).color+';';
   el.append(translated);
   const captionHeight=translated.getBoundingClientRect().height;
   const parent=el.parentElement;
   if(parent?.matches('h1,h2,[role=heading]')){
    this.saveStyle(b,parent);const padding=parseFloat(getComputedStyle(parent).paddingBottom)||0;parent.style.height='auto';parent.style.paddingBottom=(padding+captionHeight)+'px';
   }else{
    // Sticky mastheads commonly use a flex row. Reserve space on the link, never add a sibling flex item.
    el.style.marginBottom=(parseFloat(css.marginBottom)||0)+captionHeight+'px';
   }
  }else{
   const menu=el.closest('[role=menubar],nav ul,nav ol');
   const stacked=!!menu&&!(el.getRootNode() instanceof ShadowRoot)&&rect.height<48;
   if(stacked){
    const texts=[...el.querySelectorAll<HTMLElement>('span')].filter(child=>originalText(child)===b.source&&!child.querySelector('span'));
    const label=texts[0]||el,labelStyle=getComputedStyle(label),width=label.getBoundingClientRect().width;
    if(label===el){
     this.saveStyle(b,el);el.style.display='block';el.style.height='auto';el.style.whiteSpace='normal';
     translated.style.display='block';translated.style.marginTop='2px';translated.style.fontSize='.88em';
     if(this.mode==='mono'){b.originalParent=el;b.originals=[...el.childNodes];for(const n of b.originals)n.parentNode?.removeChild(n);}
     el.append(translated);b.node=translated;b.displayMode=this.mode;return;
    }
    this.saveStyle(b,label);label.style.display='inline-block';label.style.verticalAlign='middle';label.style.lineHeight='1.05';label.style.boxSizing='border-box';label.style.height='auto';label.style.paddingBlockStart='0';label.style.paddingBlockEnd='0';
    if(width>2)label.style.width=width+'px';
    this.saveStyle(b,el);el.style.display='inline-flex';el.style.verticalAlign='top';el.style.height='auto';el.style.alignItems='center';
    translated.style.display='block';translated.style.marginTop='2px';translated.style.fontSize=Math.max(10,Math.min(12,(parseFloat(labelStyle.fontSize)||14)*.82))+'px';
    // Keep short labels within their original column; very long translations can wrap naturally.
    if(this.mode==='mono'){b.originalParent=label;b.originals=[...label.childNodes];for(const n of b.originals)n.parentNode?.removeChild(n);translated.style.marginTop='0';}
    label.append(translated);
    const linkHeight=el.getBoundingClientRect().height,contentHeight=label.getBoundingClientRect().height;
    if(contentHeight>linkHeight){this.saveStyle(b,el);el.style.height='auto';el.style.minHeight=contentHeight+'px';}
   }else{
    this.saveStyle(b,el);el.style.whiteSpace='nowrap';
    translated.style.display='inline';translated.style.whiteSpace='nowrap';translated.style.fontSize='0.88em';translated.style.marginInlineStart=this.mode==='mono'?'0':'.35em';
    if(this.mode==='mono'){b.originalParent=el;b.originals=[...el.childNodes];for(const n of b.originals)n.parentNode?.removeChild(n);}
    el.append(translated);
   }
  }
  b.node=translated;b.displayMode=this.mode;
 }
 private display(b:Block){
  if(!b.translation||!b.element.isConnected||this.mode==='original')return;
  if(b.node?.isConnected&&b.displayMode===this.mode)return;
  this.editDOM(()=>{
   this.clearDisplay(b);
   if(b.kind!=='content'&&b.kind!=='dialog'){this.displayHeader(b);return;}
   const anchor=[...b.element.querySelectorAll<HTMLAnchorElement>('a[href]')].find(a=>originalText(a)===b.source);
   let container:HTMLElement=b.element.matches('summary')?b.element:anchor||b.element;
   const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT);let longest=0,sourceElement:HTMLElement=container;
   while(!b.academic&&!b.element.matches('summary')&&walker.nextNode()){
    const text=walker.currentNode.textContent?.trim()||'',parent=walker.currentNode.parentElement;
    if(parent&&!parent.closest('['+MARK+'],.notranslate')&&text.length>longest){longest=text.length;sourceElement=parent;}
   }
   // Do not add a second flex/grid item next to a title. Place the translation inside its text leaf.
   if(sourceElement!==container&&originalText(sourceElement)===b.source)container=sourceElement;
   // On news cards the visible typeface commonly belongs to an inner link/span, not its h3 wrapper.
   const style=getComputedStyle(sourceElement),fontSize=parseFloat(style.fontSize)||16;
   const translated=document.createElement('span');translated.setAttribute(MARK,'translation');translated.lang=this.config.target;
   const heading=b.element.matches('h1,h2,h3,h4,h5,h6,[role=heading]');
   translated.style.cssText='display:block;overflow-wrap:break-word;word-break:normal;white-space:pre-line;letter-spacing:normal;text-transform:none;';
   translated.style.marginBlockStart=this.mode==='mono'?'0':heading?'.3em':'.45em';
   // Inherit each card's type scale and colour. Chinese needs more vertical room than Latin display fonts.
   translated.style.fontFamily=style.fontFamily;translated.style.fontWeight=style.fontWeight;
   translated.style.fontSize=style.fontSize;translated.style.color=style.color;translated.style.textAlign=getComputedStyle(b.element).textAlign;
   translated.style.lineHeight=String(Math.max(parseFloat(style.lineHeight)/fontSize||1.4,heading?1.35:1.5));
   if(b.element.matches('summary')){
    const layout=getComputedStyle(container).display;
    if(layout.includes('flex')){this.saveStyle(b,container);container.style.flexWrap='wrap';translated.style.flexBasis='100%';translated.style.width='100%';}
    if(layout.includes('grid'))translated.style.gridColumn='1 / -1';
   }

   if(b.academic)appendAcademicTranslation(translated,b.translation!,b.academic);else translated.textContent=b.translation!;
   if(this.mode==='mono'){b.originalParent=container;b.originals=[...container.childNodes];for(const n of b.originals)n.parentNode?.removeChild(n);}
   container.append(translated);b.node=translated;b.displayMode=this.mode;
   // Computed height is normally a pixel value, even for natural block layout. Only expand actual clipping.
   const adjustments=[...new Set([container,b.element])];
   const parent=container.parentElement;
   if(parent?.matches('a')&&/hidden|clip/.test(getComputedStyle(parent).overflowY))adjustments.push(parent);
   for(const el of adjustments){
    const css=getComputedStyle(el);
    const clamp=parseInt(css.webkitLineClamp)>0;
    const clipped=/hidden|clip/.test(css.overflowY)&&el.scrollHeight>el.clientHeight+1;
    const capped=css.maxHeight!=='none'&&el.scrollHeight>el.clientHeight+1;
    if(!clamp&&!clipped&&!capped)continue;
    b.saved.set(el,el.getAttribute('style'));
    el.style.setProperty('-webkit-line-clamp','unset');el.style.setProperty('max-height','none');
    el.style.setProperty('height','auto');el.style.setProperty('overflow','visible');
   }
  });
 }
 private applyMode(){for(const b of this.blocks.values())if(b.translation)this.display(b);}
 private schedule(){
  if(!this.running||this.scheduled)return;this.scheduled=true;
  window.setTimeout(()=>{this.scheduled=false;void this.pump();},75);
 }
 private discover(){
  this.dirty=false;this.headerRoots=openContentRoots();this.observe();
  const header=new Set(collectHeaderBlocks(this.headerRoots));
  for(const element of [...header,...collectBlocks([document,...this.headerRoots])]){
   const old=this.blocks.get(element);
   // A site's own update in mono mode replaces the source; do not append retained old children over it.
   if(old?.originals.length&&(!old.node?.isConnected||blockText(element))){old.originals=[];old.originalParent=undefined;}
   const academic=old?.originals.length?old.academic:academicText(element);
   const source=old?.originals.length?old.source:academic?.source??originalText(element);
   if(old&&source===old.source){
    if(academic&&old.academic?.version!==academic.version){this.editDOM(()=>this.clearDisplay(old));old.academic=academic;}
    continue;
   }
   if(old)this.editDOM(()=>this.clearDisplay(old));
   this.blocks.set(element,{academic,kind:header.has(element)?headerKind(element):dialogContext(element)?element.matches('button,[role=button],[role=tab],a[href],summary')?'control':'dialog':'content',element,source,id:'b'+(++this.batches),saved:new Map(),originals:[]});
  }
  for(const [element,b]of this.blocks)if(!element.isConnected){this.editDOM(()=>this.clearDisplay(b));this.blocks.delete(element);}
 }
 private async pump(){
  if(!this.running||this.pumping)return;this.pumping=true;
  try{
   if(this.dirty)this.discover();
   this.applyMode();
   const limit=this.config.provider==='openai'?2:1;
   while(this.running&&this.inflight<limit){
    const eligible=[...this.blocks.values()].filter(b=>{
     const r=b.element.getBoundingClientRect();return !b.translation&&!b.pending&&!b.error&&visible(b.element)&&r.bottom>-innerHeight&&r.top<innerHeight*2;
    }).map(b=>({b,r:b.element.getBoundingClientRect()})).sort((a,b)=>{
     const rank=(item:{b:Block;r:DOMRect})=>item.r.bottom>0&&item.r.top<innerHeight?(item.b.kind==='dialog'||item.b.kind==='control'?0:item.b.kind==='content'?1:2):3;
     return rank(a)-rank(b)||a.r.top-b.r.top;
    }).map(v=>v.b);
    if(!eligible.length){
     if(!this.inflight)this.report(this.blocks.size?'已翻译 '+[...this.blocks.values()].filter(b=>b.translation).length+' 段 · 滚动后继续':'未发现可翻译正文，请确认页面已正常加载。','ready');
     break;
    }
    const items:Block[]=[];let chars=0;
    for(const b of eligible){if(items.length&&(items.length>=(this.config.provider==='bing'?1:8)||chars+b.source.length>4000))break;items.push(b);chars+=b.source.length;if(chars>=4000)break;}
    for(const b of items)b.pending=true;
    const token=this.generation,batch=this.batchId;this.inflight++;
    this.report('正在翻译 · 已完成 '+[...this.blocks.values()].filter(b=>b.translation).length+' 段','running');
    void this.send(items,token,batch).finally(()=>{this.inflight--;this.schedule();});
   }
  }finally{this.pumping=false;}
 }
 private async send(items:Block[],token:number,batch:string){
  try{
   const pieces:{key:string;text:string}[]=[];
   for(const b of items){let text=b.source,index=0;while(text.length){let cut=Math.min(2000,text.length);if(cut<text.length){const boundaries=[...text.slice(0,cut).matchAll(/[。！？.!?;；]\s*|\s+/g)].map(m=>m.index!+m[0].length);cut=boundaries.filter(x=>x>1000).pop()||cut;}pieces.push({key:b.id+':'+index++,text:text.slice(0,cut)});text=text.slice(cut);}}
   const value:Record<string,string>={};let offset=0;
   while(offset<pieces.length){const chunk=[];let size=0;while(offset<pieces.length&&chunk.length<8){const p=pieces[offset];if(chunk.length&&size+p.text.length>4000)break;chunk.push(p);size+=p.text.length;offset++;}
    if(token!==this.generation)return;
    Object.assign(value,await rpc('text',{id:batch,scope:academicPage()?'arxiv-v1':'web-v2',blocks:Object.fromEntries(chunk.map(p=>[p.key,p.text]))}));
   }
   for(const b of items){
    const currentAcademic=b.originals.length?b.academic:academicText(b.element);
    const source=b.originals.length?b.source:currentAcademic?.source??originalText(b.element);
    if(this.blocks.get(b.element)!==b||!b.element.isConnected||source!==b.source)continue;
    const translated=pieces.filter(p=>p.key.startsWith(b.id+':')).map(p=>value[p.key]);
    if(translated.some(t=>typeof t!=='string'||!t.trim()))throw Error('译文不完整，请手动重试。');
    b.academic=currentAcademic;
    const text=translated.join('');if(b.academic)checkAcademicTranslation(text,b.academic);
    b.translation=text;b.error=undefined;
    // Retain a completed response for the next toggle, but never insert it after restore/pause.
    if(token===this.generation)this.display(b);
   }
   if(token===this.generation)this.report('已翻译 '+[...this.blocks.values()].filter(b=>b.translation).length+' 段 · 当前阅读位置优先','running');
  }catch(e){
   if(token!==this.generation)return;
   for(const b of items)b.error=String(e);
   this.running=false;this.starting=false;this.generation++;
   this.report(String(e)+'；已完成译文保留，点击重试。','error');
  }finally{for(const b of items)b.pending=false;}
 }
 async retry(mode:Mode='dual'){for(const b of this.blocks.values())b.error=undefined;await this.start(mode);}
}
