export type PageRef={index:number;url:string;pageURL?:string;width?:number;height?:number;local?:boolean};
export type Chapter={id:string;title:string;site:string;sourceURL?:string;pages:PageRef[];total?:number;complete:boolean;reader:boolean;adapter?:string;note?:string};
export type TaskPage={index:number;url:string;hash:string;revision:number;render_version?:number;width?:number;height?:number;state:string;stage:string;error:string;regions?:Region[];output?:string;timings?:{ocr_s?:number;translation_s?:number;render_s?:number;cpu_wait_s?:number;total_s?:number;ocr_reused?:boolean;artifact_reused?:boolean}};
export type Region={id:string;source:string;translation:string;box:number[];text_box?:number[];note:string;vertical:boolean;column_order?:'ltr'|'rtl';font_size?:number};
export type Batch={id:string;title:string;chapter_id:string;state:string;pages:TaskPage[];total?:number;complete:boolean;rules?:string;cost_known?:boolean;usage:{tokens:number;characters?:number;requests:number;yuan:number;reserved_tokens:number;reserved_yuan:number};budget:{tokens:number;characters?:number;requests:number;yuan:number};profile:Profile;usage_kind?:string;error:string};
export type Profile={id:string;name:string;provider:string;has_key?:boolean;model?:string;endpoint?:string;input_yuan_per_million?:number|null;output_yuan_per_million?:number|null;pricing_mode?:"auto"|"manual";price_source?:string;price_checked?:string|null;prompt?:string;max_output?:number};
export async function rpc(type:string,data:Record<string,unknown>={}):Promise<any>{
 const response=await chrome.runtime.sendMessage({type,...data}); if(!response?.ok)throw Error(response?.error||'插件未响应'); return response.value;
}

export function usageText(b:Batch){return b.usage_kind==="characters"||["bing","tencent"].includes(b.profile.provider)?(b.usage.characters||0)+" 字符":b.usage.tokens+" tokens";}

export function stateLabel(s:string){return ({active:"运行中",completed:"已完成",paused:"已暂停",budget:"等待追加额度",uncertain:"等待核对用量",cancelled:"已取消"} as Record<string,string>)[s]||s;}

// A new translation task may reuse image bytes and revision zero. Never reuse its old rendered artifact.
export function artifactKey(batch:Pick<Batch,'id'|'rules'>,page:Pick<TaskPage,'hash'|'revision'|'render_version'>){return JSON.stringify([batch.id,batch.rules||'',page.hash,page.revision,page.render_version||0]);}

export function costText(b:Batch,limit=false){return b.usage_kind==="characters"?"免费服务":b.cost_known===false?"费用未估算（按 tokens／请求数保护）":"估算 ¥"+b.usage.yuan.toFixed(4)+(limit?" / ¥"+b.budget.yuan:"");}

export function phaseText(p:TaskPage){const t=p.timings;if(!t)return '';if(t.artifact_reused)return '复用已有译图';const out:string[]=[];if(t.ocr_s!=null)out.push((t.ocr_reused?'复用识别 ':'识别 ')+t.ocr_s.toFixed(1)+'s');if(t.translation_s!=null)out.push('翻译 '+t.translation_s.toFixed(1)+'s');if(t.render_s!=null)out.push('擦字排版 '+t.render_s.toFixed(1)+'s');if((t.cpu_wait_s||0)>=1)out.push('本地等待 '+t.cpu_wait_s!.toFixed(1)+'s');return out.join(' · ');}
