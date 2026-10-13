import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runBrowser,sleep} from '../browser-proof/chromium.mjs';
const out=resolve(process.env.MERIDIAN_EVIDENCE_DIR??'out/meridian-navigation');
await mkdir(out,{recursive:true});
const checks=[];
await runBrowser(async client=>{
 await client.send('Network.enable');
 const evaluate=async expression=>{const r=await client.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??'Evaluation failed');return r.result?.value};
 const until=async expression=>{const deadline=Date.now()+10000;while(!await evaluate(expression)){if(Date.now()>deadline){console.log(JSON.stringify({page:await evaluate('document.body.innerText'),events:client.events.filter(e=>['Runtime.exceptionThrown','Runtime.consoleAPICalled','Log.entryAdded'].includes(e.method))}));throw Error('Timed out: '+expression);}await sleep(50);}};
 const nav=async query=>{await client.send('Page.navigate',{url:'about:blank'});await until('location.href==="about:blank"');await client.send('Page.navigate',{url:'http://127.0.0.1:4203/'+query});await until('!!document.querySelector("[data-meridian] #meridian-main")');await evaluate('document.fonts.ready.then(()=>true)');};
 const action=async value=>{await evaluate('(()=>{const el=[...document.querySelectorAll("[data-action]")].find(x=>x.dataset.action==='+JSON.stringify(value)+'&&x.getClientRects().length);if(!el||el.disabled)throw Error("Unavailable action "+'+JSON.stringify(value)+');el.click()})()');};
 const fill=async(selector,value)=>{await evaluate('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');if(!el)throw Error("Missing field");el.value='+JSON.stringify(value)+';el.dispatchEvent(new Event("input",{bubbles:true}));})()');};
 const consent=async()=>{await evaluate('document.querySelector(".md-journey-consent input").click()');};
 const check=async(label,expression)=>{assert.ok(await evaluate(expression),label);checks.push(label);};
 const shot=async name=>{await evaluate('Promise.all([...document.images].map(img=>img.decode())).then(()=>true)');await evaluate('Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getComputedTiming().iterations)).map(a=>a.finished.catch(()=>{}))).then(()=>true)');const r=await client.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(out,name+'.png'),Buffer.from(r.data,'base64'));};
 const size=async(width,height)=>client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});


 await size(1440,900);await nav('?surface=desktop');
 await check('Desktop sidebar has no Central shortcut',`!document.querySelector('.md-sidebar [data-action="route:central"]')`);
 await action('file:brief');await fill('#md-note-draft','Rascunho antes da navegação');
 for(const route of ['spaces','apps','profiles','devices','store','activity','settings']){
  await action('route:'+route);
  await check('Desktop opens '+route+' as a window',`document.querySelector('[data-meridian]').dataset.presentation==='desktop'&&!!document.querySelector('[data-window="section:${route}"]')`);
 }
 await shot('desktop-ajustes');
 await action('route:devices');await action('route:devices');
 await check('Repeated navigation reuses existing window',`document.querySelectorAll('[data-window="section:devices"]').length===1`);
 await action('window-minimize:section:devices');await action('app:section:devices');
 await check('Taskbar restores destination window','document.querySelector(".md-dock-app.is-active").dataset.action==="app:section:devices"');
 await action('window-compact:section:devices');await action('route:apps');
 await check('Navigation preserves compact companion',`document.querySelector('[data-window="section:devices"]').classList.contains('is-compact')`);
 await shot('desktop-apps-com-dispositivos');
 await action('route:intelligence');
 await fill('#md-intelligence-prompt','Uma tarefa no Desktop');await evaluate('document.querySelector("#md-intelligence-prompt").closest("form").requestSubmit()');
 await check('Intelligence request stays in Desktop','document.querySelector("[data-meridian]").dataset.presentation==="desktop"&&!!document.querySelector("[data-window=intelligence]")');
 await action('presentation:toggle');
 await check('Central remains reachable by bottom switch','document.querySelector("[data-meridian]").dataset.presentation==="central"');
 await check('Central nav also has no duplicate shortcut',`!document.querySelector('.md-sidebar nav [data-action="route:central"]')`);
 for(const route of ['devices','apps','settings']){await action('route:'+route);await check('Central keeps '+route+' as a page','document.querySelector("[data-meridian]").dataset.presentation==="central"&&!document.querySelector("[data-window]")');}
 await action('app:section:devices');
 await check('Dock restores Desktop section from Central','document.querySelector("[data-meridian]").dataset.presentation==="desktop"&&document.querySelector(".md-dock-app.is-active").dataset.action==="app:section:devices"');
 await action('app:notes');await check('Navigation preserved original draft','document.querySelector("#md-note-draft").value==="Rascunho antes da navegação"');
 await size(390,844);await nav('?surface=desktop');await action('panel:menu');await action('route:devices');
 await check('Mobile menu keeps Desktop presentation','document.querySelector("[data-meridian]").dataset.presentation==="desktop"&&document.documentElement.scrollWidth<=innerWidth+1');await shot('desktop-dispositivos-mobile');
 const errors=client.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params);assert.equal(errors.length,0);
 await writeFile(resolve(out,'quick-check.json'),JSON.stringify({checks,uncaughtErrors:errors,scope:'Focused context-sensitive navigation follow-up; not independent audit.'},null,2));
});
console.log(JSON.stringify({checks:checks.length,evidence:out}));
