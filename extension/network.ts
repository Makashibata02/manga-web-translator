let nextRule=1;
const prepared=chrome.declarativeNetRequest.getSessionRules().then(rules=>chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:rules.map(r=>r.id)}));
/** Preserve the actual public reading page's origin only for our own image request. */
export async function fetchImage(url:string,sourceURL?:string):Promise<Response>{
 let rule:number|undefined;
 if(sourceURL){
  const source=new URL(sourceURL);
  if(['http:','https:'].includes(source.protocol)){
   await prepared;rule=nextRule++;
   const escaped=[...url].map(c=>'.*+?^$()[]{}|\\'.includes(c)?'\\'+c:c).join('');
   await chrome.declarativeNetRequest.updateSessionRules({addRules:[{
    id:rule,priority:1,
    action:{type:chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,requestHeaders:[{header:'Referer',operation:chrome.declarativeNetRequest.HeaderOperation.SET,value:source.origin+'/'}]},
    condition:{regexFilter:'^'+escaped+'$',initiatorDomains:[chrome.runtime.id],resourceTypes:[chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST]}
   }]});
  }
 }
 try{return await fetch(url,{credentials:'include',redirect:'follow',signal:AbortSignal.timeout(25000)});}
 finally{if(rule!==undefined)await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[rule]});}
}
