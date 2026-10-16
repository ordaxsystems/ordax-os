#!/usr/bin/env node
// Launch-Baseline First Run DOM proof using real ESM modules in disposable Chromium.
import {readFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,normalize,relative,resolve,sep} from 'node:path';
import {runBrowser} from '../browser-proof/chromium.mjs';
const ROOT=resolve('.');
const ENTRY='system/surface/ui/first-run.mjs';
const NATIVE_STATE_ADAPTER='system/adapters/native/first-run-state.mjs';
const RE=/\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?["']([^"']+)["']/g;
const DYNAMIC=/\bimport\(\s*["']([^"']+)["']\s*\)/g;
const key=p=>'ordax-oobe/'+p.split('/').map(encodeURIComponent).join('/');
function dependency(path,sub){
 if(!sub.startsWith('.'))throw Error('Non-local dependency: '+sub);
 const next=normalize(join(dirname(path),sub)).replaceAll('\\','/');
 const r=relative(ROOT,resolve(ROOT,next));
 if(r==='..'||r.startsWith('..'+sep)||isAbsolute(r))throw Error('Dependency escapes root');
 return next;
}
async function sources(){
 const waiting=[ENTRY,NATIVE_STATE_ADAPTER],found=new Map();
 while(waiting.length){
  const p=waiting.pop();if(found.has(p))continue;
  const s=await readFile(join(ROOT,p),'utf8');found.set(p,s);
  for(const m of [...s.matchAll(RE),...s.matchAll(DYNAMIC)])waiting.push(dependency(p,m[1]));
 }
 return Object.fromEntries([...found].map(([p,s])=>[p,s.replace(RE,(all,sub)=>all.replace(sub,key(dependency(p,sub)))).replace(DYNAMIC,(all,sub)=>all.replace(sub,key(dependency(p,sub))))]));
}
async function scenario(modules,css,entry,nativeStateAdapter){
 document.open();document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><main id="proof-root"></main></body></html>');document.close();
 const style=document.createElement('style');style.textContent=css;document.head.append(style);
 const urls={},map={};
 for(const [path,source] of Object.entries(modules)){urls[path]=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));map['ordax-oobe/'+path.split('/').map(encodeURIComponent).join('/')]=urls[path];}
 const script=document.createElement('script');script.type='importmap';script.textContent=JSON.stringify({imports:map});document.head.append(script);
 const {mountFirstRunExperience}=await import(urls[entry]);
 const {createNativeFirstRunStateStore}=await import(urls[nativeStateAdapter]);
 const root=document.querySelector('#proof-root');
 const delay=()=>new Promise(done=>setTimeout(done,0));
 const get=kind=>document.querySelector('[data-first-run-action="'+kind+'"]');
 const click=async kind=>{const b=get(kind);if(!b||b.disabled)throw Error('Missing/disabled '+kind);b.click();await delay();};
 const defaultState=()=>({schema:'ordax.first-run-state/1',completed:false,locale:'pt-BR',timeZone:'America/Bahia',accountMode:null});
 async function fixture({identity=false,failReceipt=false,failPreferences=false}={}){
  let state=defaultState(),session=identity?{state:'signed-in',subjectId:'owner-A',displayName:'Proof User'}:{state:'unavailable'};
  let failSave=failReceipt,failPrefs=failPreferences,refreshSession=null,prefs={};
  const writes=[],preferenceWrites=[],listeners=new Set();let reads=0,posts=0;
  const transport={async fetch(path,options){
   if(path!=='/__ordax/native/first-run'||options.credentials!=='same-origin'||options.cache!=='no-store')throw Error('Unexpected Native state transport');
   if(options.method==='GET'){reads++;return new Response(JSON.stringify(state),{status:200,headers:{'Content-Type':'application/json'}});}
   if(options.method==='POST'){posts++;if(failSave)return new Response(null,{status:503});const next=JSON.parse(options.body);state=next;writes.push(next);return new Response(null,{status:204});}
   throw Error('Unexpected Native method');
  }};
  const stateStore=await createNativeFirstRunStateStore(transport);
  const preferences={schema:'ordax.preference-runtime/1',getSnapshot:()=>prefs,set(key,value){prefs={...prefs,[key]:value};return prefs;},async setManyConfirmed(changes){if(failPrefs)throw Error('preference persistence failed');prefs={...prefs,...changes};preferenceWrites.push(structuredClone(changes));return prefs;},subscribe(){return ()=>{};}};
  const identitySession={schema:'ordax.identity-session/1',getSnapshot:()=>session,subscribe(listener){listeners.add(listener);listener(session);return()=>listeners.delete(listener);},async refresh(){if(refreshSession)session=refreshSession;return session;}};
  const identityActions={schema:'ordax.identity-actions/1',getSnapshot:()=>({supportedActions:session.state==='signed-in'?['sign-out']:[]}),subscribe(listener){listener(this.getSnapshot());return()=>{};},async execute(){throw Error('unavailable proof identity');}};
  return {ports:{stateStore,preferences,identitySession,identityActions},get state(){return state;},get prefs(){return prefs;},get writes(){return writes;},get preferenceWrites(){return preferenceWrites;},get reads(){return reads;},get posts(){return posts;},failReceipt(v){failSave=v;},failPreferences(v){failPrefs=v;},onRefresh(v){refreshSession=v;},session(v){session=v;for(const fn of listeners)fn(v);},async freshStateStore(){return createNativeFirstRunStateStore(transport);}};
 }
 async function reachAccount(){await click('next');if(!document.querySelector('[data-first-run-locale]'))throw Error('Missing language');await click('next');await click('next');await click('next');await click('next');if(!get('account-local'))throw Error('Missing account');}
 async function reachReviewLocal(){await click('account-local');await click('next');await click('next');await click('next');if(!get('finish'))throw Error('Missing review');}
 async function completeAndEnter(){await click('finish');if(!get('enter-surface'))throw Error('Missing completion');await click('enter-surface');}
 const checks={};
 const offline=await fixture();
 const first=mountFirstRunExperience(root,offline.ports);
 checks.wizardShown=first.shown===true&&!!document.querySelector('.ordax-first-run');
 checks.modalAccessibility=document.querySelector('.ordax-first-run')?.getAttribute('aria-modal')==='true';
 await reachAccount();await reachReviewLocal();await click('finish');
 checks.receiptDurable=offline.state.completed&&offline.state.accountMode==='local-only'&&offline.writes.length===1;
 checks.completionStaysExplicit=!!get('enter-surface')&&!!document.querySelector('.ordax-first-run');
 checks.preferencesConfirmed=offline.prefs['regional.locale']==='pt-BR'&&offline.prefs['memory.auto-capture']==='on'&&offline.preferenceWrites.length===1;
 await click('enter-surface');
 checks.rootRestored=root.inert===false&&root.getAttribute('aria-hidden')===null;
 checks.noReplay=mountFirstRunExperience(root,{...offline.ports,stateStore:await offline.freshStateStore()}).shown===false;

 const preferenceFailure=await fixture({failPreferences:true});
 mountFirstRunExperience(root,preferenceFailure.ports);await reachAccount();await reachReviewLocal();await click('finish');
 checks.preferenceFailureBlocksReceipt=!!document.querySelector('.ordax-first-run-error')&&!preferenceFailure.state.completed&&preferenceFailure.posts===0;
 preferenceFailure.failPreferences(false);await click('finish');
 checks.preferenceRetryCompletes=preferenceFailure.state.completed&&!!get('enter-surface');await click('enter-surface');

 const receiptFailure=await fixture({failReceipt:true});
 mountFirstRunExperience(root,receiptFailure.ports);await reachAccount();await reachReviewLocal();await click('finish');
 checks.receiptFailureKeepsWizard=!!document.querySelector('.ordax-first-run-error')&&!!get('finish')&&!receiptFailure.state.completed;
 checks.receiptFailurePreservesAppliedOwners=receiptFailure.prefs['regional.locale']==='pt-BR'&&receiptFailure.prefs['memory.auto-capture']==='on';
 receiptFailure.failReceipt(false);await click('finish');
 checks.receiptRetryIdempotent=receiptFailure.state.completed&&receiptFailure.posts===2&&!!get('enter-surface');await click('enter-surface');

 const identity=await fixture({identity:true});
 mountFirstRunExperience(root,identity.ports);await reachAccount();await click('account-identity');await click('next');await click('next');await click('next');
 identity.onRefresh({state:'signed-in',subjectId:'owner-B',displayName:'Other User'});await click('finish');
 checks.identityRefreshRevalidated=!!get('account-local')&&!identity.state.completed&&identity.writes.length===0;
 await reachReviewLocal();await completeAndEnter();
 checks.localFallbackAfterIdentityChange=identity.state.completed&&identity.state.accountMode==='local-only';

 const current=await fixture({identity:true});
 mountFirstRunExperience(root,current.ports);await reachAccount();await click('account-identity');await click('next');await click('next');await click('next');await click('finish');
 checks.identityReceipt=current.state.completed&&current.state.accountMode==='identity'&&!Object.prototype.hasOwnProperty.call(current.state,'subjectId')&&!!get('enter-surface');await click('enter-surface');

 for(const url of Object.values(urls))URL.revokeObjectURL(url);
 const failed=Object.entries(checks).filter(([,pass])=>!pass).map(([name])=>name);
 return {passed:failed.length===0,assertions:Object.keys(checks).length,failed,checks};
}
const modules=await sources();
const css=(await Promise.all(['system/surface/ui/tokens.css','system/surface/ui/first-run.css'].map(p=>readFile(join(ROOT,p),'utf8')))).join('\n');
const expression='('+scenario.toString()+')('+JSON.stringify(modules)+','+JSON.stringify(css)+','+JSON.stringify(ENTRY)+','+JSON.stringify(NATIVE_STATE_ADAPTER)+')';
runBrowser(async client=>{const response=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text);const result=response.result?.value;if(!result?.passed)throw Error('OOBE browser assertions: '+JSON.stringify(result));console.log('ORDAX_FIRST_RUN_CHROMIUM_E2E=PASS');console.log('ORDAX_FIRST_RUN_ASSERTIONS='+result.assertions);}).catch(error=>{console.error(error);process.exitCode=1;});
