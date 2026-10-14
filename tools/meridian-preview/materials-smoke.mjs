// Focused material proof against the running loopback preview. No build, backend
// or physical-media action. Uses the existing disposable Chromium proof owner.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runBrowser, sleep } from '../browser-proof/chromium.mjs';
import { materialOptions } from '../../system/surface/experiments/meridian/catalog.mjs';

const base='http://127.0.0.1:4203/';
const out=resolve(process.env.MERIDIAN_EVIDENCE_DIR??'out/meridian-materials');
await mkdir(out,{recursive:true});
const checks=[],contrast=[],captures=[];
await runBrowser(async client=>{
 await client.send('Network.enable');
 await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});
 const ev=async expression=>{const result=await client.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??'Evaluation failed');return result.result?.value;};
 const until=async expression=>{const deadline=Date.now()+12000;while(!await ev(expression)){if(Date.now()>deadline)throw Error('Timed out: '+expression);await sleep(40);}};
 const size=async(width,height)=>{await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await sleep(40);};
 const nav=async query=>{await client.send('Page.navigate',{url:'about:blank'});await until('location.href==="about:blank"');await client.send('Page.navigate',{url:base+query});await until('!!document.querySelector("[data-meridian] #meridian-main")');await ev('document.fonts.ready');await sleep(70);};
 const action=async value=>{await ev(`(()=>{const n=[...document.querySelectorAll('[data-action]')].find(n=>n.dataset.action===${JSON.stringify(value)}&&n.getClientRects().length);if(!n)throw Error('Unavailable action');n.click();})()`);await sleep(35);};
 const check=async(label,expression)=>{assert.ok(await ev(expression),label);checks.push(label);};
 const shot=async name=>{await sleep(220);const result=await client.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(out,name+'.png'),Buffer.from(result.data,'base64'));captures.push(name+'.png');};
 const fit=label=>check(label,'document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector(".md-taskbar").getBoundingClientRect().right<=innerWidth+1');
 let centralStructure;
 for(const material of materialOptions){
  await size(1440,900);await nav('?material='+material.id);
  await check('Initial material '+material.name,`document.querySelector('[data-meridian]').dataset.material===${JSON.stringify(material.id)}`);
  const structure=await ev('document.querySelector(".md-central").innerHTML');
  centralStructure??=structure;assert.equal(structure,centralStructure,'Same Central markup in '+material.name);checks.push('Same Central markup '+material.name);
  const pairs=await ev(`(()=>{const root=document.querySelector('[data-meridian]'),s=getComputedStyle(root),token=k=>s.getPropertyValue('--md-'+k).trim();return [['ink','canvas'],['ink','surface'],['muted','canvas'],['muted','surface'],['accent','accent-soft'],['accent-text','accent'],['rail-text','rail'],['rail-muted','rail'],['rail-text','rail-selected'],['rail-muted','rail-selected'],['sage','sage-soft'],['blue','blue-soft'],['amber','amber-soft'],['rose','rose-soft'],['danger','danger-soft']].map(([fg,bg])=>({fg,bg,a:token(fg),b:token(bg)}));})()`);
  const luminance=hex=>{const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
  for(const pair of pairs){const a=luminance(pair.a),b=luminance(pair.b),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);contrast.push({material:material.id,...pair,ratio});assert.ok(ratio>=4.5,`${material.name}: ${pair.fg}/${pair.bg} ${ratio.toFixed(2)} < 4.5`);}checks.push('15 text contrast pairs '+material.name);
  await fit('Central geometry '+material.name);await shot('central-'+material.id+'-1440');
  await action('panel:system');await action('panel:materials');
  await check('Quick collection has all materials '+material.name,`document.querySelectorAll('dialog .md-material-option').length===${materialOptions.length}&&document.querySelectorAll('dialog [aria-pressed=true]').length===1`);
  const samples=await ev('(()=>{const root=document.querySelector("[data-meridian]");return [...document.querySelectorAll("[data-material-preview]")].map(n=>({id:n.dataset.materialPreview,canvas:getComputedStyle(n).getPropertyValue("--md-canvas").trim(),scheme:getComputedStyle(n).colorScheme}));})()');
  assert.equal(samples.find(x=>x.id===material.id).canvas,await ev('getComputedStyle(document.querySelector("[data-meridian]")).getPropertyValue("--md-canvas").trim()'),'Actual palette sample');checks.push('Actual palette sample '+material.name);
  for(const sample of samples)assert.equal(sample.scheme,materialOptions.find(x=>x.id===sample.id).mode==='Claro'?'light':'dark','Sample scheme '+sample.id);
  await ev(`document.querySelector('#md-material-panel-${material.id}').focus()`);
  await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await sleep(35);
  await check('Native keyboard selection keeps focus '+material.name,`document.activeElement.id==='md-material-panel-${material.id}'&&document.activeElement.getAttribute('aria-pressed')==='true'`);
  await action('panel:close');await action('app:notes');
  await ev('(()=>{const n=document.querySelector("#md-note-draft");n.focus();n.value="Rascunho preservado na troca de material";n.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await action('window-compact:notes');await action('app:files');
  await action('panel:system');await action('panel:materials');const next=materialOptions[(materialOptions.indexOf(material)+1)%materialOptions.length];await action('material:'+next.id);await action('panel:close');
  await check('Draft and compact windows survive '+material.name,'document.querySelector("#md-note-draft").value==="Rascunho preservado na troca de material"&&document.querySelector("[data-window=notes]").classList.contains("is-compact")&&document.querySelector("[data-window=files]").classList.contains("is-expanded")');
  await check('Presentation and foreground survive '+material.name,'document.querySelector("[data-meridian]").dataset.presentation==="desktop"&&document.querySelector("[data-window=files]").classList.contains("is-active")');
  await nav('?surface=desktop&material='+material.id);await shot('desktop-'+material.id+'-1440');
 }
 for(const material of ['pearl','petrol'])for(const [width,height] of [[390,844],[320,568]]){
  await size(width,height);await nav('?material='+material);await fit('Mobile Central '+material+' '+width);if(width===390)await shot('central-'+material+'-390');
  await action('panel:system');await action('panel:materials');await fit('Mobile collection '+material+' '+width);
  await check('Material cards fit '+material+' '+width,'[...document.querySelectorAll("dialog .md-material-option")].every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})');
  await action('material:'+material);await check('Mobile selection '+material+' '+width,`document.querySelector('[data-meridian]').dataset.material==='${material}'`);
  if(width===390)await shot('collection-'+material+'-390');await action('panel:close');
 }
 await size(1440,900);await nav('?material=not-a-material');await check('Invalid initial material fails to baseline','document.querySelector("[data-meridian]").dataset.material==="paper"');
 await ev('(()=>{const n=document.createElement("button");n.dataset.action="material:invalid";document.querySelector("[data-meridian]").append(n);n.click();n.remove();})()');await check('Invalid selection does not mutate palette','document.querySelector("[data-meridian]").dataset.material==="paper"');
 await nav('?area=settings&material=pearl');await check('Settings uses the same collection','document.querySelectorAll(".md-material-option").length===4&&document.querySelector("#md-material-settings-pearl").getAttribute("aria-pressed")==="true"');await shot('settings-pearl-1440');
 await nav('?surface=desktop&material=pearl');await action('panel:system');await action('route:settings');await action('panel:system');await action('panel:materials');
 await check('Settings and modal have distinct control IDs','(()=>{const ids=[...document.querySelectorAll(".md-material-option")].map(n=>n.id);return ids.length===8&&new Set(ids).size===8})()');
 await ev('document.querySelector("#md-material-panel-petrol").focus()');await action('material:petrol');
 await check('Both selectors reflect the same choice and modal keeps focus','document.activeElement.id==="md-material-panel-petrol"&&document.querySelector("#md-material-panel-petrol").getAttribute("aria-pressed")==="true"&&document.querySelector("#md-material-settings-petrol").getAttribute("aria-pressed")==="true"');await action('panel:close');
 const exceptions=client.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params);
 assert.equal(exceptions.length,0,'No uncaught browser errors');checks.push('No uncaught browser errors');
 const failed=client.events.filter(e=>e.method==='Network.loadingFailed').map(e=>e.params);
 assert.equal(failed.length,0,'No failed resources');checks.push('No failed resources');
 await writeFile(resolve(out,'checks.json'),JSON.stringify({scope:'Isolated Meridian material collection; not full accessibility, canonical integration or physical USB certification.',checks,contrast,captures,exceptions,failed},null,2));
 console.log(JSON.stringify({passed:checks.length,contrastPairs:contrast.length,captures:captures.length,out}));
});
