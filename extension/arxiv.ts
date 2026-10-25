export type ArxivPaper={kind:'abs'|'html';id:string;base:string;version:string};
export function arxivPaper(value:string):ArxivPaper|undefined{
 try{
  const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password||!['arxiv.org','www.arxiv.org'].includes(u.hostname))return;
  const match=u.pathname.match(/^\/(abs|html)\/(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)\/?$/i);if(!match)return;
  const version=match[2].match(/v\d+$/i)?.[0]||'';
  return {kind:match[1].toLowerCase() as 'abs'|'html',id:match[2],base:match[2].replace(/v\d+$/i,''),version};
 }catch{return;}
}
export function arxivHTMLTarget(doc:Document=document,value:string=location.href):string|undefined{
 const paper=arxivPaper(value);if(paper?.kind!=='abs')return;
 for(const a of doc.querySelectorAll<HTMLAnchorElement>('a[href]')){
  if(a.closest('[data-mwt]')||a.href.includes('_immersive_translate'))continue;
  const p=arxivPaper(a.href);
  if(p?.kind==='html'&&p.base===paper.base&&(!paper.version||p.version===paper.version))return 'https://arxiv.org/html/'+p.id;
 }
}
export function academicPage(){return arxivPaper(location.href)?.kind;}
export function academicIgnored(el:HTMLElement){return !!academicPage()&&!!el.closest('.ltx_bibliography,.ltx_biblist,.ltx_authors,.ltx_author_notes,.ltx_contact,.authors,.dateline,.submission-history');}
export function academicCandidates():HTMLElement[]|undefined{
 const kind=academicPage();if(!kind)return;
 return kind==='abs'?[...document.querySelectorAll<HTMLElement>('h1.title,blockquote.abstract')]:[...document.querySelectorAll<HTMLElement>('article.ltx_document h1,article.ltx_document h2,article.ltx_document h3,article.ltx_document h4,article.ltx_document h5,article.ltx_document h6,article.ltx_document p,article.ltx_document figcaption,article.ltx_document .ltx_caption,article.ltx_document li,article.ltx_document th,article.ltx_document td')];
}
export type AcademicText={source:string;prose:string;prefix:string;nodes:Element[];version:string};
const protectedSelector='code,pre,math,.ltx_Math,mjx-container,.MathJax,.katex,[role=math],cite.ltx_cite,a[href],.ltx_tag';
export function academicText(el:HTMLElement):AcademicText|undefined{
 if(!academicPage())return;
 const nodes:Element[]=[];let prose='',prefix='MWT';
 while((el.textContent||'').includes(prefix))prefix+='X';
 const walk=(node:Node):string=>{
  if(node.nodeType===Node.TEXT_NODE){prose+=node.textContent||'';return node.textContent||'';}
  if(!(node instanceof Element))return '';
  if(node!==el&&node.matches('[data-mwt],.notranslate,[translate=no],script,style,noscript,.ltx_author_notes,.ltx_contact'))return '';
  if(node!==el&&node.matches(protectedSelector)){const n=nodes.push(node)-1;return '['+prefix+n+']';}
  if(node.tagName==='BR'){prose+='\n';return '\n';}
  return [...node.childNodes].map(walk).join('');
 };
 const source=walk(el).trim();return {source,prose:prose.trim(),prefix,nodes,version:nodes.map(n=>n.outerHTML).join('\n')};
}
function markers(text:string,plan:AcademicText){return [...text.matchAll(new RegExp('[\\[［【]\\s*'+plan.prefix+'\\s*(\\d+)\\s*[\\]］】]','gi'))];}
export function checkAcademicTranslation(text:string,plan:AcademicText){
 if(!plan.nodes.length)return;
 const found=markers(text,plan),ids=found.map(m=>Number(m[1]));
 if(found.length!==plan.nodes.length||new Set(ids).size!==ids.length||ids.some(n=>n>=plan.nodes.length))throw Error('公式或引用标记不完整，原文已保留；请手动重试或切换翻译服务。');
}
let cloneSequence=0;
function cloneProtected(source:Element):Element{
 const clone=source.cloneNode(true) as Element,all=[clone,...clone.querySelectorAll('*')],ids=new Map<string,string>(),prefix='mwt-ref-'+(++cloneSequence)+'-';
 for(const e of all){const id=e.getAttribute('id');if(id){ids.set(id,prefix+ids.size);e.setAttribute('id',ids.get(id)!);}}
 for(const e of all){
  if(e.tagName.toLowerCase()==='script'){e.remove();continue;}
  for(const attr of [...e.attributes]){
   if(/^on/i.test(attr.name)){e.removeAttribute(attr.name);continue;}
   if(/^(?:href|xlink:href)$/i.test(attr.name)&&/^\s*(?:javascript|data|vbscript):/i.test(attr.value)){e.removeAttribute(attr.name);continue;}
   let value=attr.value;
   if(/^(?:href|xlink:href)$/i.test(attr.name)&&value.startsWith('#')&&ids.has(value.slice(1)))value='#'+ids.get(value.slice(1));
   if(/^aria-(?:labelledby|describedby)$/.test(attr.name))value=value.split(/\s+/).map(id=>ids.get(id)||id).join(' ');
   value=value.replace(/url\(#([^)]+)\)/g,(m,id)=>ids.has(id)?'url(#'+ids.get(id)+')':m);
   if(value!==attr.value)e.setAttribute(attr.name,value);
  }
 }
 return clone;
}
export function appendAcademicTranslation(container:HTMLElement,text:string,plan:AcademicText){
 checkAcademicTranslation(text,plan);let cursor=0;
 for(const m of markers(text,plan)){
  container.append(document.createTextNode(text.slice(cursor,m.index)),cloneProtected(plan.nodes[Number(m[1])]));cursor=m.index!+m[0].length;
 }
 container.append(document.createTextNode(text.slice(cursor)));
}
export function installArxivEntry(open:(url:string)=>Promise<unknown>,summary:()=>Promise<unknown>,provider?:()=>Promise<{provider:string;label:string}>){
 if(arxivPaper(location.href)?.kind!=='abs'||document.querySelector('[data-mwt=arxiv-entry]'))return;
 const target=arxivHTMLTarget(),official=document.querySelector<HTMLAnchorElement>('#latexml-download-link,a.abs-button[href*="/pdf/"],a.download-pdf');
 const list=official?.closest('li')?.parentElement;if(!list)return;
 const li=document.createElement('li');li.dataset.mwt='arxiv-entry';
 const link=document.createElement('a');link.className='abs-button';link.id='mwt-arxiv-bilingual';link.textContent=target?'双语版本（漫译）':'双语摘要（漫译）';link.href=target||'#content';link.target=target?'_blank':'';link.rel='noopener';
 link.title=target?'使用当前翻译服务打开官方 HTML 全文，自动显示双语；沿用现有额度限制。':'此论文暂未提供官方 HTML 全文；翻译本页标题与摘要。';
 const feedback=document.createElement('span');feedback.id='mwt-arxiv-status';feedback.role='status';feedback.setAttribute('aria-live','polite');feedback.hidden=true;
 feedback.style.cssText='display:block;font-size:12px;line-height:1.5;margin:4px 0;overflow-wrap:anywhere;';
 let busy=false,started=false;
 if(provider)void provider().then(p=>{link.dataset.mwtProvider=p.provider;link.title=p.label+'。'+link.title;if(!started){feedback.textContent='当前：'+p.label;feedback.hidden=false;}}).catch(()=>{});
 link.addEventListener('click',e=>{
  // Only a user's click may authorize a translation; a page cannot trigger paid work with .click().
  e.preventDefault();if(!e.isTrusted||busy)return;started=true;busy=true;link.setAttribute('aria-disabled','true');feedback.hidden=false;feedback.textContent=target?'正在打开双语全文…':'正在翻译标题与摘要…';
  void (target?open(target):summary()).then(()=>{feedback.textContent=target?'已打开双语全文':'已开始翻译标题与摘要';},error=>{feedback.textContent=String(error);}).finally(()=>{busy=false;link.removeAttribute('aria-disabled');});
 });
 li.append(link,feedback);list.append(li);
}
