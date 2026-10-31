#!/usr/bin/env node
// First-run DOM integration proof using real ESM modules in disposable Chromium.
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {dirname,isAbsolute,join,normalize,relative,resolve,sep} from 'node:path';
import {runBrowser} from '../browser-proof/chromium.mjs';
const ROOT=resolve('.');
const ENTRY='system/surface/ui/first-run.mjs';
const NATIVE_STATE_ADAPTER='system/adapters/native/first-run-state.mjs';
const RE=/\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?["']([^"']+)["']/g;
const DYNAMIC=/\bimport\(\s*["']([^"']+)["']\s*\)/g;
const key=p=>'ordax-oobe/'+p.split('/').map(encodeURIComponent).join('/');
function dependency(path,sub) {
 if(!sub.startsWith('.'))throw Error('Non-local dependency: '+sub);
 const next=normalize(join(dirname(path),sub)).replaceAll('\\','/');
 const r=relative(ROOT,resolve(ROOT,next));
 if(r==='..'||r.startsWith('..'+sep)||isAbsolute(r))throw Error('Dependency escapes root');
 return next;
}
async function sources() {
 const waiting=[ENTRY,NATIVE_STATE_ADAPTER], found=new Map();
 while(waiting.length) {
  const p=waiting.pop();if(found.has(p))continue;
  const s=await readFile(join(ROOT,p),'utf8');found.set(p,s);
  for(const m of [...s.matchAll(RE),...s.matchAll(DYNAMIC)])waiting.push(dependency(p,m[1]));
 }
 return Object.fromEntries([...found].map(([p,s])=>[p,
   s.replace(RE,(all,sub)=>all.replace(sub,key(dependency(p,sub))))
    .replace(DYNAMIC,(all,sub)=>all.replace(sub,key(dependency(p,sub))))
 ]));
}

const SYMBOL_PATH='system/surface/ui/brand/ordax-symbol.png';

// Serve the exact checked-out ESM sources and canonical brand asset from one
// ephemeral loopback origin. A blob:null module cannot resolve import.meta.url
// relative assets; an actual Native/Web Surface has a hierarchical origin.
async function createProofSourceServer(modules) {
 const symbol=await readFile(join(ROOT,SYMBOL_PATH));
 const server=createServer((request,response)=>{
  let path;
  try { path=decodeURIComponent(new URL(request.url??'/', 'http://127.0.0.1').pathname.slice(1)); }
  catch { response.writeHead(400);response.end();return; }
  const isModule=Object.hasOwn(modules,path);
  if(!isModule && path!==SYMBOL_PATH){response.writeHead(404);response.end();return;}
  response.writeHead(200,{
   'Content-Type':isModule?'text/javascript; charset=utf-8':'image/png',
   'Access-Control-Allow-Origin':'*',
   'Cache-Control':'no-store',
   'X-Content-Type-Options':'nosniff',
  });
  response.end(isModule?modules[path]:symbol);
 });
 await new Promise((resolvePromise,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolvePromise);
 });
 const address=server.address();
 if(!address || typeof address==='string')throw Error('Proof source server has no port');
 return {
  origin:'http://127.0.0.1:'+address.port,
  close:()=>new Promise(resolvePromise=>server.close(resolvePromise)),
 };
}

async function scenario(modules,css,origin) {
 document.open();
 document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><main id="proof-root"></main></body></html>');
 document.close();
 const style=document.createElement('style');style.textContent=css;document.head.append(style);
 const urls={},map={};
 for(const path of Object.keys(modules)) {
  urls[path]=origin+'/'+path.split('/').map(encodeURIComponent).join('/');
  map['ordax-oobe/'+path.split('/').map(encodeURIComponent).join('/')]=urls[path];
 }
 const script=document.createElement('script');script.type='importmap';
 script.textContent=JSON.stringify({imports:map});document.head.append(script);
 const {mountFirstRunExperience}=await import(urls['system/surface/ui/first-run.mjs']);
 const {createNativeFirstRunStateStore}=await import(urls['system/adapters/native/first-run-state.mjs']);
 const root=document.querySelector('#proof-root');
 const delay=()=>new Promise(done=>setTimeout(done,0));
 const get=kind=>document.querySelector('[data-first-run-action="'+kind+'"]');
 const click=async kind=>{
  if(kind==='finish'){
   const consent=document.querySelector('[data-first-run-system-terms-acceptance]');
   if(!consent)throw Error('Missing OS terms acknowledgement');
   if(!consent.checked){
    if(!get('finish')?.disabled)throw Error('OS entry must require acknowledgement');
    consent.checked=true;consent.dispatchEvent(new Event('change',{bubbles:true}));
   }
  }
  const b=get(kind);if(!b||b.disabled)throw Error('Missing/disabled '+kind);
  b.click();await delay();
 };
 const defaultState=()=>({schema:'ordax.first-run-state/1',completed:false,locale:'pt-BR',timeZone:'America/Bahia',accountMode:null});
 async function fixture({identity=false,signedOut=false,publicSignupEnabled=false,failSave=false,holdIdentityProbe=false}={}) {
  let state=defaultState(),session=identity?{state:'signed-in',subjectId:'owner-A',displayName:'Proof User'}:signedOut?{state:'signed-out'}:{state:'unavailable'};
  let fail=failSave;let refreshSession=null;let releaseIdentityProbe=null;const writes=[],listeners=new Set();let prefs={};
  let reads=0,posts=0;
  // Disposable HTTP semantics; the real native JS adapter owns GET/POST handling.
  // Actual disk durability and native host authorization are tested separately.
  const transport={
   async fetch(path,options) {
    if(path!=='/__ordax/native/first-run' || options.credentials!=='same-origin'
       || options.cache!=='no-store') throw Error('Unexpected Native state transport');
    if(options.method==='GET') {
     reads+=1;
     return new Response(JSON.stringify(state),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(options.method==='POST') {
     posts+=1;
     if(options.headers?.['Content-Type']!=='application/json')throw Error('Native JSON content-type missing');
     if(fail)return new Response(null,{status:503});
     const next=JSON.parse(options.body);
     if(state.completed && JSON.stringify(state)!==JSON.stringify(next))return new Response(null,{status:409});
     state=next;writes.push(next);
     return new Response(null,{status:204});
    }
    throw Error('Unexpected Native HTTP method');
   },
  };
  const stateStore=await createNativeFirstRunStateStore(transport);
  const preferences={schema:'ordax.preference-runtime/1',getSnapshot:()=>prefs,
   set(key,value){prefs={...prefs,[key]:value};},subscribe(){return ()=>{};}};
  const identitySession={schema:'ordax.identity-session/1',getSnapshot:()=>session,
   subscribe(listener){listeners.add(listener);listener(session);return ()=>listeners.delete(listener);},
   async refresh(){
    if(holdIdentityProbe)await new Promise(resolve=>{releaseIdentityProbe=resolve;});
    if(refreshSession)session=refreshSession;return session;
   }};
  const identityActions={schema:'ordax.identity-actions/1',getSnapshot:()=>({supportedActions:session.state==='signed-in'?['sign-out']:session.state==='signed-out'?['sign-in']:[]}),
   subscribe(listener){listener(this.getSnapshot());return ()=>{};},async execute(action){
    if(action!=='sign-out')throw Error('unavailable proof identity');
    session={state:'signed-out'};refreshSession=null;
    for(const listener of listeners)listener(session);
   }};
  const identityCredentials=signedOut?{
   schema:'ordax.identity-credentials/1',
   async signIn(){throw Error('Sign-in cannot run during hosted-registration proof');},
   async register(){throw Error('Direct Native registration must not run during hosted-registration proof');},
   async registrationPolicy(){return {
     registrationEnabled:false,publicRegistrationEnabled:publicSignupEnabled,
   };},
  }:null;
  return {ports:{stateStore,preferences,identitySession,identityActions,identityCredentials},
   get state(){return state;},get writes(){return writes;},get prefs(){return prefs;},
   get reads(){return reads;},get posts(){return posts;},
   releaseIdentityProbe(){releaseIdentityProbe?.();releaseIdentityProbe=null;},
   async freshStateStore(){return createNativeFirstRunStateStore(transport);},
   failSave(v){fail=v;},onRefresh(next){refreshSession=next;},session(next){session=next;for(const fn of listeners)fn(next);}};
 }
 async function reachAccount(){
  if(!document.querySelector('[data-first-run-locale]'))throw Error('Missing welcome language selector');
  await click('next');
  await click('next');
  if(!get('account-local'))throw Error('Missing account step');
 }
 async function finishLocal(){
  await click('account-local');
  await click('next');
  if(!document.querySelector('.ordax-first-run-availability')?.textContent.includes('nome do dispositivo está indisponível'))throw Error('Missing device-name fallback');
  await click('next');
  await click('finish');
 }
 const checks={};

 // A native Surface relaunch must reread the keyboard owner; First Run must
 // not invent an intermediate receipt or pretend the physical layout changed.
 const keyboardOwner=await fixture();
 let keyboardReads=0,keyboardMutations=0;
 let keyboardState={
  configuredLayoutId:'br-abnt2',appliedLayoutId:'br-abnt2',
  supportedLayoutIds:['br-abnt2','us'],restartRequired:false,
 };
 keyboardOwner.ports.keyboardLayout={
  schema:'ordax.keyboard-layout/1',
  async read(){keyboardReads+=1;return {...keyboardState};},
  async configure(){keyboardMutations+=1;throw Error('OOBE must stay read-only');},
 };
 const keyboardFirst=mountFirstRunExperience(root,keyboardOwner.ports);
 await delay();
 const firstStatus=document.querySelector('[data-first-run-keyboard-status]')?.textContent??'';
 checks.nativeKeyboardReadOnly=firstStatus.includes('ABNT2')
  && firstStatus.includes('Layout configurado:')
  && !document.querySelector('[data-first-run-keyboard-layout]')
  && keyboardMutations===0;
 keyboardFirst.destroy();
 checks.restartWithoutReceipt=!keyboardOwner.state.completed && keyboardOwner.writes.length===0;

 keyboardState={
  configuredLayoutId:'us',appliedLayoutId:'us',
  supportedLayoutIds:['br-abnt2','us'],restartRequired:false,
 };
 const keyboardSecond=mountFirstRunExperience(root,{
  ...keyboardOwner.ports,stateStore:await keyboardOwner.freshStateStore(),
 });
 await delay();
 const resumedStatus=document.querySelector('[data-first-run-keyboard-status]')?.textContent??'';
 checks.relaunchRefreshesNativeKeyboard=resumedStatus.includes('English (US)')
  && !resumedStatus.includes('ABNT2') && keyboardReads===2
  && keyboardMutations===0;
 checks.noKeyboardOwnerInReceipt=!Object.prototype.hasOwnProperty.call(keyboardOwner.state,'keyboardLayoutId')
  && keyboardOwner.writes.length===0;
 keyboardSecond.destroy();

 const cursorFixture=await fixture();
 let checkpoint={schema:'ordax.first-run-cursor/1',step:'security'};
 const savedCursorSteps=[];
 const cursorPort={
  schema:'ordax.first-run-cursor/1',
  load(){return checkpoint;},
  async save(step){checkpoint={...checkpoint,step};savedCursorSteps.push(step);return checkpoint;},
 };
 const resumedSecurity=mountFirstRunExperience(root,{
  ...cursorFixture.ports,resumeCursor:cursorPort,
 });
 checks.resumeReconfirmsAccount=!!get('account-local');
 await click('account-local');await delay();
 checks.laterStepsPersistAccountCursor=checkpoint.step==='account'
  && document.querySelector('.ordax-first-run')?.dataset.firstRunStep==='security' && savedCursorSteps.includes('account');
 resumedSecurity.destroy();
 const resumedAccount=mountFirstRunExperience(root,{
  ...cursorFixture.ports,
  stateStore:await cursorFixture.freshStateStore(),
  resumeCursor:cursorPort,
 });
 checks.resumesAccountWithoutIdentity=!!get('account-local')
  && cursorFixture.writes.length===0 && !cursorFixture.state.completed;
 resumedAccount.destroy();

 const gated=await fixture({signedOut:true,publicSignupEnabled:false});
 const gatedWizard=mountFirstRunExperience(root,gated.ports);
 await reachAccount();await delay();
 checks.hostedSignupDeniedWhenPublicRegistrationClosed=
  !document.querySelector('[data-first-run-hosted-signup]')
  && document.querySelector('.ordax-first-run-account-help')?.textContent.includes('Novos cadastros ainda não estão disponíveis')
  && !document.querySelector('[data-first-run-action="account-mode"]')
  && !!get('account-local');
 gatedWizard.destroy();

 // Server explicitly permits public Web registration but still denies Native.
 // The First Run must expose the canonical site, not activate direct registration.
 const webEnabled=await fixture({signedOut:true,publicSignupEnabled:true});
 const webEnabledWizard=mountFirstRunExperience(root,webEnabled.ports);
 await reachAccount();await delay();
 const hostedSignup=document.querySelector('[data-first-run-hosted-signup]');
 checks.hostedSignupShownOnlyWhenPublicAuthorized=
  hostedSignup?.getAttribute('href')==='https://ordax.com.br/cadastro/'
  && hostedSignup?.getAttribute('target')==='_blank'
  && hostedSignup?.getAttribute('rel')==='noopener noreferrer'
  && !document.querySelector('[data-first-run-action="account-mode"]')
  && !!get('account-local');
 webEnabledWizard.destroy();

 const offline=await fixture();
 const first=mountFirstRunExperience(root,offline.ports);
 checks.offlineWizardShown=first.shown===true && !!document.querySelector('.ordax-first-run');
 checks.modalAccessibility=document.querySelector('.ordax-first-run')?.getAttribute('aria-modal')==='true';
 await reachAccount();await finishLocal();
 checks.offlineReceipt=offline.state.completed && offline.state.accountMode==='local-only';
 checks.osTermsReceipt=offline.state.systemTerms?.accepted===true && offline.state.systemTerms?.status==='draft';
 checks.onlyClosesAfterSave=offline.writes.length===1 && !document.querySelector('.ordax-first-run');
 checks.regionalPreference=offline.prefs['regional.locale']==='pt-BR';
 checks.setupDoesNotChangeMemory=!Object.prototype.hasOwnProperty.call(offline.prefs,'memory.auto-capture');
 checks.restoredRoot=root.inert===false && root.getAttribute('aria-hidden')===null;
 checks.noOobeReplay=mountFirstRunExperience(root,{...offline.ports,
  stateStore:await offline.freshStateStore()}).shown===false;
 checks.adapterTransportRoundTrip=offline.reads===2 && offline.posts===1;

 const pendingAccountProbe=await fixture({holdIdentityProbe:true});
 const pendingAccountFirst=mountFirstRunExperience(root,pendingAccountProbe.ports);
 await click('next');await click('next');
 checks.localSetupAvailableDuringAccountProbe=!!get('account-local')&&!get('account-local').disabled;
 await click('account-local');
 checks.localSetupContinuesWithoutWaitingForAccount=pendingAccountFirst.shown
  && document.querySelector('.ordax-first-run')?.dataset.firstRunStep==='security';
 pendingAccountProbe.releaseIdentityProbe();
 pendingAccountFirst.destroy();

 const identity=await fixture({identity:true});
 mountFirstRunExperience(root,identity.ports);await reachAccount();
 await click('account-identity');await click('next');
 identity.session({state:'signed-out'});await delay();
 checks.revokedSessionReturnsToAccount=!!get('account-local') && !identity.state.completed && identity.writes.length===0;
 await finishLocal();
 checks.localModeStillWorks=identity.state.completed && identity.state.accountMode==='local-only';

 const current=await fixture({identity:true});
 mountFirstRunExperience(root,current.ports);await reachAccount();
 await click('account-identity');await click('next');await click('next');await click('finish');
 checks.activeIdentityReceipt=current.state.completed && current.state.accountMode==='identity'
  && !Object.prototype.hasOwnProperty.call(current.state,'subjectId')
  && current.writes.length===1 && !document.querySelector('.ordax-first-run');

 const expired=await fixture({identity:true});
 mountFirstRunExperience(root,expired.ports);await reachAccount();
 await click('account-identity');await click('next');
 expired.onRefresh({state:'signed-in',subjectId:'owner-B',displayName:'Other Proof User'});
 await click('next');await click('finish');
 checks.refreshChangedOwnerReturnsToAccount=!!get('account-local')
  && !expired.state.completed && expired.writes.length===0;
 await finishLocal();
 checks.refreshedIdentityAllowsLocalFallback=expired.state.completed
  && expired.state.accountMode==='local-only';

 const storage=await fixture({failSave:true});
 mountFirstRunExperience(root,storage.ports);await reachAccount();await finishLocal();
 checks.failedSaveKeepsWizard=!!document.querySelector('.ordax-first-run-error') && !!get('finish')
  && storage.writes.length===0 && !storage.state.completed;
 storage.failSave(false);await click('finish');
 checks.retryIsDurable=storage.state.completed && storage.writes.length===1 && !document.querySelector('.ordax-first-run');
 checks.failedWriteWasNotCached=storage.posts===2
  && (await storage.freshStateStore()).load().completed===true;
 // HTTP module URLs and the canonical image are disposed with the source server.
 const failed=Object.entries(checks).filter(([,pass])=>!pass).map(([name])=>name);
 return {passed:failed.length===0,assertions:Object.keys(checks).length,failed,checks};
}
const modules=await sources();
const css=(await Promise.all(['system/surface/ui/tokens.css','system/surface/ui/first-run.css'].map(p=>readFile(join(ROOT,p),'utf8')))).join('\n');
const server=await createProofSourceServer(modules);
const expression='('+scenario.toString()+')('+JSON.stringify(modules)+','+JSON.stringify(css)+','+JSON.stringify(server.origin)+')';
try {
 await runBrowser(async client=>{
  const response=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
  if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text);
  const result=response.result?.value;
  if(!result?.passed)throw Error('OOBE browser assertions: '+JSON.stringify(result));
  console.log('ORDAX_FIRST_RUN_CHROMIUM_E2E=PASS');
  console.log('ORDAX_FIRST_RUN_ASSERTIONS='+result.assertions);
 });
} catch (error) {
 console.error(error);
 process.exitCode=1;
} finally {
 await server.close();
}
