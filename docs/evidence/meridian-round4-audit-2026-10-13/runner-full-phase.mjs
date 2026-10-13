import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runBrowser,sleep} from '../browser-proof/chromium.mjs';
const out=resolve(process.env.MERIDIAN_EVIDENCE_DIR??'out/meridian-round4-audit/independent');
await mkdir(out,{recursive:true});
const results=[],geometry=[],sidebar=[];
const host=spawn(process.env.ORDAX_PYTHON??'python',['tools/meridian-preview/serve.py','--port','0'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let hostLog='';host.stderr.on('data',x=>hostLog+=x);
const origin=await new Promise((ok,no)=>{let text='';const timer=setTimeout(()=>no(Error('host timeout')),30000);host.stdout.on('data',x=>{text+=x;const m=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);ok(m[0]);}});host.on('error',no);});
try {await runBrowser(async client=>{
 await client.send('Network.enable');
 await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});
 const ev=async expression=>{const r=await client.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??'evaluation');return r.result?.value;};
 const until=async expression=>{const end=Date.now()+15000;while(!await ev(expression)){if(Date.now()>end)throw Error('timeout '+expression);await sleep(50);}};
 const frames=()=>ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
 const nav=async q=>{await client.send('Page.navigate',{url:'about:blank'});await until('location.href==="about:blank"&&document.readyState==="complete"');await client.send('Page.navigate',{url:origin+'/'+q});await until('document.readyState==="complete"&&!!document.querySelector("[data-meridian] #meridian-main")');await ev('document.fonts.ready.then(()=>true)');};
 const action=async value=>{await ev('(()=>{const n=[...document.querySelectorAll("[data-action]")].find(n=>n.dataset.action==='+JSON.stringify(value)+'&&n.getClientRects().length&&(!document.querySelector("dialog[open]")||n.closest("dialog")));if(!n||n.disabled)throw Error("Unavailable action "+'+JSON.stringify(value)+');n.focus();n.click();})()');await frames();};
 const fill=async(s,v)=>ev('(()=>{const n=document.querySelector('+JSON.stringify(s)+');if(!n)throw Error("Missing field");n.focus();n.value='+JSON.stringify(v)+';n.dispatchEvent(new Event("input",{bubbles:true}));})()');
 const key=async(key,code,windowsVirtualKeyCode,modifiers=0)=>{await client.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,modifiers});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode,modifiers});await frames();};
 const check=async(name,expr,details)=>{const pass=typeof expr==='string'?await ev(expr):expr;results.push({name,status:pass?'PASS':'FAIL',...(!pass&&details?{details}:{} )});};
 const test=async(name,fn)=>{try{await fn();}catch(e){results.push({name,status:'FAIL',error:e.message,diagnostic:await ev('({url:location.href,ready:document.readyState,text:document.body.innerText.slice(0,1200)})').catch(()=>null)});}await writeFile(resolve(out,'checks.json'),JSON.stringify({results,geometry,sidebar},null,2));};
 const size=(width,height)=>client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 const route=async id=>{const visible=await ev('[...document.querySelectorAll(".md-sidebar [data-action]")].some(n=>n.dataset.action==='+JSON.stringify('route:'+id)+'&&n.getClientRects().length)');if(!visible)await key('k','KeyK',75,2);await action('route:'+id);};
 const focusWindow=id=>ev('document.activeElement.closest("[data-window]")?.dataset.window==='+JSON.stringify(id));
 const space=async id=>{await action('panel:spaces');await action('select-space:'+id);await action('story-next');await ev('document.querySelector(".md-journey-consent input").click()');await action('story-next');await action('story-finish');};
 const rect=selector=>ev('document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect().toJSON()');
 const shot=async name=>{await ev('Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))');await ev('Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getComputedTiming().iterations)).map(a=>a.finished.catch(()=>{})))');const r=await client.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(out,name+'.png'),Buffer.from(r.data,'base64'));};
 const context=async()=>{if(!await ev('[...document.querySelectorAll("[data-action]")].some(n=>n.dataset.action==="panel:intelligence-context"&&n.getClientRects().length)'))await action('panel:menu');await action('panel:intelligence-context');};
 await client.send('Page.addScriptToEvaluateOnNewDocument',{source:'('+(()=>{
  window.__feedbackAudit={observers:[],listeners:[]};const audit=window.__feedbackAudit;
  const Native=window.ResizeObserver;
  window.ResizeObserver=class extends Native {constructor(callback){const record={targets:new Set(),callbacks:0};super((...args)=>{record.callbacks++;callback(...args)});this.record=record;audit.observers.push(record)}observe(target,options){this.record.targets.add(target);super.observe(target,options)}unobserve(target){this.record.targets.delete(target);super.unobserve(target)}disconnect(){this.record.targets.clear();super.disconnect()}};
  const add=EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener=function(type,callback,options){if(this instanceof Element&&this.id==='meridian'){const record={type,active:true};audit.listeners.push(record);if(options?.signal)add.call(options.signal,'abort',()=>record.active=false,{once:true})}return add.call(this,type,callback,options)};
 }).toString()+')()'});
 const pointer=async selector=>{const r=await rect(selector);await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+r.width/2,y:r.y+r.height/2});await frames();};
 const tooltipInfo=()=>ev('(()=>{const n=document.querySelector(".md-pointer-hint");return{hidden:n.hidden,text:n.textContent,rect:n.getBoundingClientRect().toJSON(),count:document.querySelectorAll(".md-pointer-hint").length}})()');
 const observerInfo=()=>ev('({instances:window.__feedbackAudit.observers.length,targets:window.__feedbackAudit.observers.reduce((n,o)=>n+o.targets.size,0),detached:window.__feedbackAudit.observers.reduce((n,o)=>n+[...o.targets].filter(t=>!t.isConnected).length,0),listeners:window.__feedbackAudit.listeners.filter(l=>l.active).length})');
 for(const material of ['paper','ink'])await test('dock resize '+material,async()=>{
  await size(1440,900);await nav('?surface=desktop&material='+material);
  for(const id of ['notes','files','studio'])await action('app:'+id);for(const id of ['devices','apps','profiles','settings'])await route(id);
  await ev('document.querySelector(".md-main").focus()');await size(320,568);await frames();await sleep(100);
  const bounds=await ev('(()=>{const d=document.querySelector(".md-dock").getBoundingClientRect(),a=document.querySelector(".md-dock-app.is-active").getBoundingClientRect();return{dock:d.toJSON(),active:a.toJSON()}})()');
  await check('Viewport resize reveals active app '+material,bounds.active.left>=bounds.dock.left-1&&bounds.active.right<=bounds.dock.right+1,bounds);
  await ev('document.querySelector(".md-dock-app").focus({preventScroll:true})');await key('Home','Home',36);await size(390,844);await frames();await sleep(100);
  await check('Resize preserves keyboard browsing without activation '+material,'document.activeElement===document.querySelector(".md-dock-app")&&document.querySelector(".md-dock").scrollLeft<3&&document.querySelector(".md-dock-app.is-active").dataset.action==="app:section:settings"');
 });
 const styles=[];
 const sampleStyle=selector=>ev('(()=>{const n=document.querySelector('+JSON.stringify(selector)+');if(!n)return null;const s=getComputedStyle(n),backgrounds=[];for(let p=n;p;p=p.parentElement)backgrounds.push(getComputedStyle(p).backgroundColor);return{fontSize:s.fontSize,color:s.color,backgrounds,visible:!!n.getClientRects().length}})()');
 for(const material of ['paper','ink'])for(const presentation of ['desktop','central'])await test('guidance '+presentation+' '+material,async()=>{
  await size(1440,900);await nav('?surface='+presentation+'&material='+material);
  const items=await ev('[...document.querySelectorAll(".md-sidebar [data-tooltip]")].filter(n=>n.getClientRects().length).map(n=>({name:n.getAttribute("aria-label"),tooltip:n.dataset.tooltip,action:n.dataset.action,current:n.getAttribute("aria-current"),title:n.getAttribute("title")}))');sidebar.push({presentation,material,items});
  await check('All rail targets share named guidance '+presentation+'/'+material,items.every(n=>n.name&&n.tooltip===n.name&&!n.title),items);
  for(const selector of ['.md-sidebar .md-space-switch','.md-sidebar .md-account','.md-sidebar [data-action="route:intelligence"]','.md-sidebar [data-action="route:devices"]']){
   await pointer(selector);const hint=await tooltipInfo();const name=await ev('document.querySelector('+JSON.stringify(selector)+').getAttribute("aria-label")');
   await check('One tooltip with correct hover label '+presentation+'/'+material+'/'+name,!hint.hidden&&hint.count===1&&hint.text===name);
   await check('Custom tooltip has no competing native title '+presentation+'/'+material+'/'+name,await ev('!document.querySelector('+JSON.stringify(selector)+').getAttribute("title")'));
   await check('Tooltip is within viewport '+presentation+'/'+material+'/'+name,hint.rect.left>=0&&hint.rect.right<=1440&&hint.rect.top>=0&&hint.rect.bottom<=900,hint);
   await key('Escape','Escape',27);await check('Escape dismisses tooltip '+presentation+'/'+material+'/'+name,'document.querySelector(".md-pointer-hint").hidden');
   await pointer(selector);await ev('(()=>{const n=document.querySelector('+JSON.stringify(selector)+');n.firstElementChild.dispatchEvent(new PointerEvent("pointerover",{bubbles:true,pointerType:"mouse"}));})()');await check('Escape stays dismissed within the same target '+presentation+'/'+material+'/'+name,'document.querySelector(".md-pointer-hint").hidden');
   await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1400,y:450});await frames();
   await ev('document.querySelector('+JSON.stringify(selector)+').focus()');await frames();await check('Keyboard focus shows one tooltip '+presentation+'/'+material+'/'+name,'!document.querySelector(".md-pointer-hint").hidden&&document.querySelectorAll(".md-pointer-hint").length===1');
   await key('Escape','Escape',27);await check('Escape preserves focus and dismisses guidance '+presentation+'/'+material+'/'+name,'document.querySelector(".md-pointer-hint").hidden&&document.activeElement.getAttribute("aria-label")==='+JSON.stringify(name));
   await ev('document.querySelector(".md-main").focus()');await frames();await check('Focus exit removes tooltip '+presentation+'/'+material+'/'+name,'document.querySelector(".md-pointer-hint").hidden');
  }
  await pointer('.md-sidebar .md-account');styles.push({presentation,material,tooltip:await ev('(()=>{const s=getComputedStyle(document.querySelector(".md-pointer-hint"));return{color:s.color,background:s.backgroundColor,fontSize:s.fontSize}})()'),sample:await sampleStyle('.md-pointer-hint'),canvas:await ev('getComputedStyle(document.querySelector("[data-meridian]")).getPropertyValue("--md-canvas")')});
  await shot('guidance-'+presentation+'-'+material);
  await action('panel:account');await check('Dialog excludes stale guidance '+presentation+'/'+material,'document.querySelector(".md-pointer-hint").hidden');await action('journey-close');
  const before=await observerInfo();for(let i=0;i<24;i++){await action('panel:system');await action('panel:close');}const after=await observerInfo();
  await check('Repaint retains one observer target '+presentation+'/'+material,after.instances===1&&after.targets===1&&after.detached===0,after);
  await check('Repaint does not grow listeners '+presentation+'/'+material,after.listeners===before.listeners,{before,after});
  await action('panel:system');await action('lab-lock');await frames();const locked=await observerInfo();await check('Lock releases detached dock observation '+presentation+'/'+material,locked.targets===0&&locked.detached===0,locked);await action('lab-unlock');
  await action('panel:system');await action('journey:recovery');await frames();const stage=await observerInfo();await check('Independent stage releases dock observation '+presentation+'/'+material,stage.targets===0&&stage.detached===0,stage);await action('journey-close');
  await ev('window.dispatchEvent(new PageTransitionEvent("pagehide"))');await frames();const closed=await observerInfo();await check('Destroy disconnects observer and aborts listeners '+presentation+'/'+material,closed.targets===0&&closed.listeners===0&&!await ev('!!document.querySelector("#meridian-main")'),closed);
 });
 for(const [w,h] of [[1440,900],[1024,768],[768,600],[844,390],[390,844],[320,568]])for(const material of ['paper','ink'])await test('dock chrome '+w+' '+material,async()=>{
  if(process.env.MERIDIAN_R4_AUDIT_FOCUSED&&w!==844)return;
  await client.send('Emulation.setTouchEmulationEnabled',{enabled:w<=844,maxTouchPoints:1});await size(w,h);await nav('?surface=desktop&material='+material);
  for(const id of ['notes','files','studio'])await action('app:'+id);for(const id of ['devices','apps','profiles','settings'])await route(id);
  const boxes=await ev('[...document.querySelectorAll(".md-dock-app")].map(n=>({id:n.dataset.action,...n.getBoundingClientRect().toJSON()}))');await check('Dock targets are 44x44 '+w+'/'+material,boxes.every(b=>b.width>=44&&b.height>=44),boxes);
  await check('Dock has one horizontal scroll region and separated targets '+w+'/'+material,'(()=>{const d=document.querySelector(".md-dock"),f=d.parentElement,s=getComputedStyle(d);return s.overflowX==="auto"&&getComputedStyle(f).overflowX!=="auto"&&parseFloat(s.gap)>=6&&s.touchAction.includes("pan-x")})()');
  const dock=await rect('.md-dock');await ev('document.querySelector(".md-dock").scrollLeft=0');await frames();const scroll=await ev('({max:document.querySelector(".md-dock").scrollWidth-document.querySelector(".md-dock").clientWidth,cue:document.querySelector(".md-dock-frame").dataset.overflow})');
  if(scroll.max>10){await check('Overflow indication agrees with scroll '+w+'/'+material,scroll.cue==='end',scroll);const start=dock.right-16,end=dock.left+16,y=dock.y+dock.height/2;await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]});for(let i=1;i<=10;i++){await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start+(end-start)*i/10,y}]});await sleep(16);}await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(150);await check('Native touch scrolls only dock '+w+'/'+material,'document.querySelector(".md-dock").scrollLeft>5&&document.scrollingElement.scrollLeft===0&&document.scrollingElement.scrollTop===0');}
  await ev('document.querySelector(".md-dock-app").focus({preventScroll:true})');await key('End','End',35);await check('End exposes last app without activation '+w+'/'+material,'document.activeElement===document.querySelector(".md-dock-app:last-of-type")&&document.querySelector(".md-dock-app.is-active").dataset.action==="app:section:settings"');await key('Home','Home',36);await check('Home exposes first app '+w+'/'+material,'document.activeElement===document.querySelector(".md-dock-app")&&document.querySelector(".md-dock").scrollLeft<3');await key('ArrowRight','ArrowRight',39);await check('Arrow leaves foreground unchanged '+w+'/'+material,'document.activeElement===document.querySelectorAll(".md-dock-app")[1]&&document.querySelector(".md-dock-app.is-active").dataset.action==="app:section:settings"');
  await action('app:notes');await fill('#md-note-draft','Round 4 independent draft');await action('window-compact:notes');await action('app:files');const g=await ev('(()=>{const r=s=>document.querySelector(s).getBoundingClientRect().toJSON();return{area:r(".md-desktop-primary"),window:r("[data-window=files]"),compact:r(".md-compact-region"),taskbar:r(".md-taskbar"),radius:getComputedStyle(document.querySelector("[data-window=files]")).borderRadius,fullscreen:!!document.fullscreenElement,page:document.documentElement.scrollWidth,width:innerWidth,material:document.querySelector("[data-meridian]").dataset.material}})()');geometry.push({w,h,material,...g});
  await check('Maximize has exact useful edges '+w+'/'+material,['left','top','right','bottom'].every(k=>Math.abs(g.area[k]-g.window[k])<1)&&g.radius==='0px'&&!g.fullscreen,g);
  await check('Compact and taskbar are reserved '+w+'/'+material,g.window.bottom<=g.compact.top+1&&g.compact.bottom<=g.taskbar.top+1,g);
  await check('Document fits without horizontal scroll '+w+'/'+material,g.page<=w+1,g);
  await check('Chrome and dock agree '+w+'/'+material,'document.querySelectorAll("[data-window].is-active").length===1&&document.querySelector("[data-window].is-active").dataset.window==="files"&&document.querySelector(".md-dock-app.is-active").dataset.action==="app:files"');
  if(w===844){await check('Landscape compact is near 156 px '+material,g.compact.height>=154&&g.compact.height<=158,g);const content='.is-compact .md-window-content';await ev('document.querySelector('+JSON.stringify(content)+').scrollTop=10000;document.querySelector(".is-compact button[type=submit]").focus()');await frames();await check('Compact save remains reachable by scroll '+material,'(()=>{const c=document.querySelector(".is-compact .md-window-content").getBoundingClientRect(),b=document.querySelector(".is-compact button[type=submit]").getBoundingClientRect();return b.top>=c.top-1&&b.bottom<=c.bottom+1})()');await action('compact-toggle');const expanded=await rect('.md-desktop-primary');await check('Collapse returns useful height '+material,expanded.height>g.area.height+100,{before:g.area,after:expanded});await action('compact-toggle');}
  await action('panel:system');const type=await ev('getComputedStyle(document.querySelector(".md-taskbar .md-demo-label")).fontSize');await check('Study label is declared 12 px '+w+'/'+material,parseFloat(type)>=12,{computed:type});await action('panel:close');
  styles.push({w,h,material,study:await sampleStyle('.md-taskbar .md-demo-label'),title:await sampleStyle('[data-window=files] .md-window-title'),time:await sampleStyle('.md-tray-time small')});
  if(w>=768){await pointer('.md-sidebar .md-account');const tip=await tooltipInfo();await check('Low or wide rail Account tooltip fits '+w+'/'+material,!tip.hidden&&tip.rect.top>=0&&tip.rect.bottom<=h&&tip.rect.right<=w,tip);}
  const ax=await client.send('Accessibility.getFullAXTree');await check('AX controls are named '+w+'/'+material,!ax.nodes.some(n=>!n.ignored&&['button','textbox','checkbox','combobox','slider'].includes(n.role?.value)&&!n.name?.value?.trim()));
  if([1440,844,320].includes(w))await shot('chrome-'+material+'-'+w);
  await action('presentation:toggle');await check('Central has no hidden Desktop active app '+w+'/'+material,'!document.querySelector("[data-window].is-active")&&!document.querySelector(".md-dock-app.is-active")&&!!document.querySelector(".md-topbar")');await shot('central-'+material+'-'+w);
  await action('panel:system');const panel=await rect('dialog');await check('Narrow Central tray fits and remains illustrative '+w+'/'+material,panel.left>=-1&&panel.right<=w+1&&panel.top>=-1&&panel.bottom<=h+1&&await ev('document.querySelector("dialog").innerText.includes("exemplo")'),panel);await action('panel:close');
 });
  for(const material of ['paper','ink'])await test('projects motion '+material,async()=>{
  await size(1440,900);await nav('?surface=desktop&material='+material);
  const scopeBefore=await ev('document.querySelector("[data-meridian]").dataset.space');
  await check('Projects names its Central destination '+material,'(()=>{const n=document.querySelector(".md-desktop-projects");return n.textContent.includes("Seus projetos")&&n.textContent.includes("na Central")&&n.getAttribute("aria-label").includes("na Central")&&n.querySelectorAll("svg").length===2})()');
  await action('tab:work');const projectResult=await ev('({space:document.querySelector("[data-meridian]").dataset.space,presentation:document.querySelector("[data-meridian]").dataset.presentation,work:[...document.querySelectorAll("[data-action]")].find(n=>n.dataset.action==="tab:work").getAttribute("aria-pressed")})');await check('Projects opens existing Work page with Space preserved '+material,projectResult.space===scopeBefore&&projectResult.presentation==='central'&&projectResult.work==='true',projectResult);await action('presentation:toggle');
  await action('app:notes');await check('New window receives entry motion '+material,'document.querySelector("[data-window=notes]").dataset.motion==="enter"');
  await action('panel:system');await action('panel:close');await check('Ordinary repaint does not reanimate the window '+material,'!document.querySelector("[data-window=notes]").dataset.motion&&getComputedStyle(document.querySelector("[data-window=notes]")).animationName==="none"');
  await action('window-expand:notes');await check('Mode change receives resize feedback '+material,'document.querySelector("[data-window=notes]").dataset.motion==="resize"');
  await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await action('app:files');await check('Reduced motion suppresses entry and transitions '+material,'getComputedStyle(document.querySelector("[data-window=files]")).animationName==="none"&&parseFloat(getComputedStyle(document.querySelector(".md-dock")).transitionDuration)===0');await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 });
await writeFile(resolve(out,'styles.json'),JSON.stringify(styles,null,2));
 const exceptions=client.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params),requests=client.events.filter(e=>e.method==='Network.requestWillBeSent').map(e=>e.params.request.url);
 await check('No uncaught errors',exceptions.length===0,exceptions);await check('Loopback requests only',requests.every(u=>u==='about:blank'||u.startsWith(origin+'/')),requests.filter(u=>!u.startsWith(origin+'/')));
 await writeFile(resolve(out,'checks.json'),JSON.stringify({results,geometry,sidebar,styles,exceptions,requests},null,2));
 });}finally{host.kill();await writeFile(resolve(out,'host.log'),hostLog);}
 console.log(JSON.stringify({pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL'),geometry:geometry.length}));if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
