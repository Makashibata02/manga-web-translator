import {build} from 'esbuild';
import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {createHash,generateKeyPairSync} from 'node:crypto';
const out='dist/extension'; await mkdir(out,{recursive:true});
let key;
try { key=(await readFile('extension/public-key.txt','utf8')).trim(); }
catch {key=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64'); await writeFile('extension/public-key.txt',key+'\n');}
const id=[...createHash('sha256').update(Buffer.from(key,'base64')).digest().subarray(0,16)].map(v=>String.fromCharCode(97+(v>>4),97+(v&15))).join('');
await build({entryPoints:['extension/background.ts','extension/content.ts','extension/app.ts'],bundle:true,outdir:out,format:'iife',target:'chrome120',sourcemap:false});
await cp('extension/static',out,{recursive:true});
const manifest={manifest_version:3,name:'漫译 · 本地图片与网页翻译',version:'0.1.1',version_name:'0.1.1 漫画右起竖排',key,description:'本地识别与擦字，整章排队，连续阅读，免费优先，支持 DeepSeek。',
permissions:['storage','activeTab','scripting','nativeMessaging','contextMenus','alarms','downloads','declarativeNetRequestWithHostAccess'],
host_permissions:['http://127.0.0.1/*'],
optional_host_permissions:['https://*/*','http://*/*'],
background:{service_worker:'background.js'},
action:{default_popup:'popup.html',default_title:'漫译'},
options_page:'settings.html',
content_security_policy:{extension_pages:"script-src 'self'; object-src 'self'"},
icons:{'48':'icon.png','128':'icon.png'}};
await writeFile(out+'/manifest.json',JSON.stringify(manifest,null,2));
await mkdir('build',{recursive:true});await writeFile('build/extension-id.txt',id);
console.log('Extension ID: '+id);
