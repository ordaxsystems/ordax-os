#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve, relative, isAbsolute, sep, join, extname} from 'node:path';
import {runBrowser, sleep} from '../browser-proof/chromium.mjs';
const args=process.argv.slice(2);
if (args.some((value,index)=> index%2===0 && !['--bundle-dir','--evidence-dir'].includes(value))) throw Error('Unsupported argument');
const value=(key,fallback)=> args.includes(key) ? args[args.indexOf(key)+1] : fallback;
const bundle=resolve(value('--bundle-dir','out/web-client'));
const evidence=resolve(value('--evidence-dir','out/web-viewport-proof'));
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.json':'application/json'};
const server=createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
    const path=resolve(bundle,'.'+(pathname==='/'?'/index.html':pathname));
    const rel=relative(bundle,path);
    if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Outside bundle');
    const bytes=await readFile(path);
    response.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream'});response.end(bytes);
  } catch {response.writeHead(404);response.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
await mkdir(evidence,{recursive:true});
try {
 for (const path of ['/web2', '/web2/']) assert.equal((await fetch(origin + path)).status, 404, 'Retired test route must not serve the canonical client');
 const reports=await runBrowser(async client=>{
  async function evaluate(expression){
    const reply=await client.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(reply.exceptionDetails)throw Error(reply.exceptionDetails.exception?.description??'Evaluation failed');
    return reply.result?.value;
  }
  async function ready(){
    const deadline=Date.now()+15000;
    while(!await evaluate("!!document.querySelector('.web-workspace') && document.querySelector('#ordax-boot-screen').hidden")){
      if(Date.now()>deadline)throw Error('Canonical Web failed to mount');await sleep(50);
    }
    await evaluate('document.fonts.ready.then(()=>true)');
    await evaluate("Promise.all([...document.images].filter(img=>img.getClientRects().length>0).map(img=>img.decode().catch(()=>{throw Error('Asset failed: '+img.currentSrc)}))).then(()=>true)");
  }
  async function click(selector){
    const point=await evaluate("(()=>{const node=[...document.querySelectorAll("+JSON.stringify(selector)+")].find(node=>node.getClientRects().length>0);if(!node)throw Error('Missing control');node.scrollIntoView({block:'center',inline:'center',behavior:'instant'});const box=node.getBoundingClientRect();const x=box.left+box.width/2,y=box.top+box.height/2,hit=document.elementFromPoint(x,y);if(!box.width||!box.height||!node.contains(hit))return {obstructed:true,box:{x,y,width:box.width,height:box.height},hit:hit?.outerHTML.slice(0,400)};return {x,y};})()");
    if(point.obstructed){const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(evidence,'failure.png'),Buffer.from(shot.data,'base64'));throw Error('Obstructed '+selector+': '+JSON.stringify(point));}
    if(await evaluate('navigator.maxTouchPoints>0')) {
      await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
      await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } else {
    await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    }
    await sleep(100);
  }

  async function noDialog() {
    const deadline=Date.now()+3000;
    while(await evaluate("!!document.querySelector('[role=dialog]')")){if(Date.now()>deadline)throw Error('Dialog did not finish closing');await sleep(25);}
  }
  async function fullWindow(name) {
    const result=await evaluate('(()=>{const n=document.querySelector('+JSON.stringify('[aria-label="Janela '+name+'"]')+'),d=document.querySelector(".web-desktop"),r=n.getBoundingClientRect(),b=d.getBoundingClientRect();return {maximized:n.classList.contains("web-window-maximized"),equal:[r.left-b.left,r.top-b.top,r.width-b.width,r.height-b.height].every(v=>Math.abs(v)<1),foreground:n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};})()');
    assert.ok(result.maximized&&result.equal&&result.foreground,JSON.stringify({name,result}));
  }
  async function adaptiveSidebarProof(width,height) {
    const expected=['Início','OrdaX Intelligence','Aplicativos','Projetos','Arquivos','Spaces','Internet','Loja','Studio','Notas','Ajustes'];
    if(width<=820){
      await click('[aria-label="Menu do workspace"]');
      const base=await evaluate("(()=>{const a=document.querySelector('.web-mobile-menu .web-navigation-account');return {count:a.querySelectorAll('button').length,iconsOnly:[...a.querySelectorAll('button')].every(n=>!n.textContent.trim())};})()");
      assert.equal(base.count,2);assert.equal(base.iconsOnly,true);
      await click('.web-mobile-menu [title="Ajustes"]');await noDialog();await fullWindow('Ajustes');
      await client.send('Page.navigate',{url:origin+'/?view=home'});await ready();return;
    }
    const geometry=await evaluate("(()=>{const s=document.querySelector('.web-sidebar'),root=s.querySelector('.web-navigation-content'),a=s.querySelector('.web-navigation-account'),rows=[...root.querySelectorAll('.web-nav-link')],r=root.getBoundingClientRect();return {titles:rows.filter(n=>!n.classList.contains('web-navigation-more')).map(n=>n.title),inside:rows.every(n=>{const b=n.getBoundingClientRect();return b.top>=r.top-1&&b.bottom<=r.bottom+1}),noScroll:[s,s.querySelector('.web-navigation-scroll'),root].every(n=>n.scrollHeight<=n.clientHeight+1),accountCount:a.querySelectorAll('button').length,iconsOnly:[...a.querySelectorAll('button')].every(n=>!n.textContent.trim()),footer:a.getBoundingClientRect().bottom<=innerHeight};})()");
    assert.ok(geometry.inside&&geometry.noScroll&&geometry.iconsOnly&&geometry.footer,JSON.stringify({width,height,geometry}));assert.equal(geometry.accountCount,2);
    await click('.web-sidebar [aria-label="Mais opções de navegação"]');
    const hidden=await evaluate("[...document.querySelectorAll('.web-navigation-more-menu [role=menuitem]')].map(n=>n.textContent.trim())");
    const destinations=hidden.filter(n=>expected.includes(n));const all=[...geometry.titles,...destinations];
    assert.equal(all.length,new Set(all).size,'Destinations appear once across sidebar and Mais');
    assert.deepEqual([...all].sort(),[...expected].sort(),'Mais preserves every omitted destination');
    assert.ok(hidden.includes('Selecionar Space')&&hidden.includes('Organizar janelas'));
    assert.equal(await evaluate("document.querySelector('.web-navigation-more-menu').textContent.includes('Serviços não conectados')"),true);
    if(destinations.includes('Notas')){
      await click('.web-navigation-more-menu [role=menuitem][data-destination="notes"]');
    }else{
      await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(150);
      await click('.web-sidebar [title="Notas"]');
    }
    await noDialog();await fullWindow('Notas');
    const menuDeadline=Date.now()+3000;
    while(await evaluate("!!document.querySelector('.web-navigation-more-menu')")){if(Date.now()>menuDeadline)throw Error('Mais did not finish closing after app selection');await sleep(25);}
    await click('.web-sidebar [aria-label="Mais opções de navegação"]');
    await click('.web-navigation-more-menu [role=menuitem][data-action="select-space"]');await sleep(200);
    assert.equal(await evaluate("!!document.querySelector('.web-space-dialog[role=dialog]')"),true,'Space picker remains in Mais');
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await noDialog();
    const before=geometry.titles.length;
    await client.send('Emulation.setDeviceMetricsOverride',{width,height:300,deviceScaleFactor:1,mobile:false});await sleep(200);
    assert.ok(await evaluate("(()=>{const s=document.querySelector('.web-sidebar'),r=s.querySelector('.web-navigation-content'),a=s.querySelector('.web-navigation-account');return s.scrollHeight<=s.clientHeight+1&&r.scrollHeight<=r.clientHeight+1&&a.getBoundingClientRect().bottom<=innerHeight+1&&r.querySelectorAll('.web-nav-link').length<=2;})()"),'Short desktop sends all remaining destinations to Mais without clipping the base icons');
    await click('[aria-label="Recolher navegação"]');await sleep(150);await click('.web-sidebar [aria-label="Mais opções de navegação"]');
    assert.equal(await evaluate("[...document.querySelectorAll('.web-navigation-more-menu [role=menuitem] span')].every(n=>getComputedStyle(n).display!=='none')"),true,'Collapsed sidebar keeps text visible in Mais');
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(150);await click('[aria-label="Expandir navegação"]');
    await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(200);
    assert.equal(await evaluate("document.querySelectorAll('.web-sidebar .web-nav-link:not(.web-navigation-more)').length"),before,'Destinations return after viewport expands');
    await client.send('Page.navigate',{url:origin+'/?view=home'});await ready();
  }
  async function navigationUtilitiesProof(width,height) {
    if(width>820)assert.equal(await evaluate("(()=>{const s=document.querySelector('.web-sidebar').getBoundingClientRect(),f=document.querySelector('.web-systembar'),d=f.querySelector('.web-dock'),r=d.getBoundingClientRect(),b=f.getBoundingClientRect(),style=getComputedStyle(f);return Math.abs(s.bottom-innerHeight)<=1&&Math.abs(document.querySelector('.web-desktop').getBoundingClientRect().bottom-innerHeight)<=1&&Math.abs((r.left+r.right)/2-(b.left+b.right)/2)<=1&&style.backgroundColor==='rgba(0, 0, 0, 0)'&&parseFloat(style.borderTopWidth)===0&&style.pointerEvents==='none'&&getComputedStyle(d).pointerEvents==='auto'&&f.children.length===1;})()"),true,'Full-height sidebar and centered floating dock replace the full-width footer strip');

    if(width<=820)await click('[aria-label="Menu do workspace"]');
    else assert.equal(await evaluate("!!document.querySelector('.web-sidebar [aria-label=\"Menu de identidade\"]') && !!document.querySelector('.web-sidebar [aria-label=\"Abrir notificações\"]') && !document.querySelector('.web-system-status time')"),true,'Profile and notifications remain in the sidebar; the Web clock is absent');
    await click('[aria-label="Menu de identidade"]');
    assert.equal(await evaluate("[...document.querySelectorAll('[role=menuitem]')].some(n=>n.textContent.includes('Minha Conta')&&n.getAttribute('href')==='/conta/')"),true,'Account link remains in canonical identity menu');
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(150);
    await click('[aria-label="Abrir launcher"]');await sleep(250);
    assert.equal(await evaluate("!!document.querySelector('.web-launcher[role=dialog]')"),true,'Navigation search opens the shared launcher');
    await click('.web-launcher [title="Abrir Studio"]');await noDialog();await fullWindow('Studio');
    if(width>820){await click('[aria-label="Recolher navegação"]');await fullWindow('Studio');assert.equal(await evaluate("[...document.querySelectorAll('.web-sidebar [aria-label=\"Menu de identidade\"],.web-sidebar [aria-label=\"Abrir launcher\"],.web-sidebar [aria-label=\"Abrir notificações\"]')].every(n=>n.getBoundingClientRect().width>=29&&n.getClientRects().length>0)"),true);await click('[aria-label="Expandir navegação"]');}
    await client.send('Page.navigate',{url:origin+'/?view=home'});await ready();
  }
  async function openingProof(width,height) {
    for(const name of ['Studio','Arquivos','Internet','Galeria','Notas','Ajustes']) {
      await click('[aria-label="Abrir aplicativos"]');
      await click('.web-launcher [title="Abrir '+name+'"]');await noDialog();await fullWindow(name);
    }
    if(width<=820)await click('[aria-label="Menu do workspace"]');
    await click('[aria-label="Abrir notificações"]');await noDialog();await fullWindow('Notificações');
    assert.equal(await evaluate("document.querySelector('.web-topbar')===null && Math.abs(document.querySelector('.web-desktop').getBoundingClientRect().top-parseFloat(getComputedStyle(document.querySelector('.web-workspace')).getPropertyValue('--web-header-height')))<=1"),true,'Shell utilities leave the app header area free');
    const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(evidence,'full-app-'+width+'x'+height+'.png'),Buffer.from(shot.data,'base64'));
    if(width===1440){
      for(let i=0;i<40;i++)await click('[aria-label="Abrir '+(i%2?'Studio':'Arquivos')+' pelo dock"]');
      await fullWindow('Studio');
      assert.ok(await evaluate("Number(getComputedStyle(document.querySelector('[aria-label=\"Janela Studio\"]')).zIndex)>Number(getComputedStyle(document.querySelector('[aria-label=\"Janela Arquivos\"]')).zIndex)"), 'Stacking remains ordered beyond the former layer cap');
    }
    await client.send('Page.navigate',{url:origin+'/?view=home'});await ready();
  }
  async function paneLayout(expected) {
    const layout = await evaluate(`(() => {
      const rect = node => { const b=node.getBoundingClientRect(); return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,width:b.width,height:b.height}; };
      const desktop=document.querySelector('.web-desktop'), primary=document.querySelector('.web-primary-pane');
      const visible=node=>node.getClientRects().length>0 && getComputedStyle(node).visibility==='visible';
      return {mode:desktop.dataset.compactLayout, desktop:rect(desktop), primary:rect(primary),
        root:rect(document.querySelector('.web-workspace')), viewport:innerHeight,
        dockClearance:parseFloat(getComputedStyle(desktop).getPropertyValue('--compact-dock-clearance')),
        noDocumentScroll:document.documentElement.scrollHeight<=innerHeight,
        stageScroll:[document.querySelector('.web-window-stage').scrollLeft,document.querySelector('.web-window-stage').scrollTop],
        windows:[...document.querySelectorAll('.web-window')].filter(visible).map(node=>({mode:[...node.classList].find(value=>/^web-window-(normal|maximized|compact|immersive)$/.test(value)),rect:rect(node)})),
        controls:document.querySelector('.web-carousel-controls') && visible(document.querySelector('.web-carousel-controls')) ? rect(document.querySelector('.web-carousel-controls')) : null};
    })()`);
    if(expected) assert.equal(layout.mode,expected);
    assert.deepEqual(layout.stageScroll,[0,0],'Focus must not scroll the window coordinate stage');
    assert.ok(Math.abs(layout.root.height-layout.viewport)<1 && layout.noDocumentScroll, JSON.stringify(layout));
    const reserved=layout.mode==='expanded' ? layout.desktop.height/2 : layout.mode==='collapsed' && layout.controls ? layout.controls.height+layout.dockClearance : 0;
    assert.ok(Math.abs(layout.primary.height-(layout.desktop.height-reserved))<1, JSON.stringify(layout));
    for(const win of layout.windows) {
      if(win.mode==='web-window-immersive')continue;
      const bounds=win.mode==='web-window-compact' ? {top:layout.primary.bottom,bottom:layout.desktop.bottom} : win.mode==='web-window-maximized' ? layout.desktop : layout.primary;
      assert.ok(win.rect.top>=bounds.top-1 && win.rect.bottom<=bounds.bottom+1 && win.rect.left>=layout.desktop.left-1 && win.rect.right<=layout.desktop.right+1, JSON.stringify({layout,win}));
    }
    if(layout.controls) assert.ok(Math.abs(layout.controls.top-layout.primary.bottom)<1,JSON.stringify(layout));
    return layout;
  }

  async function dialogChrome(selector) {
    return evaluate('(()=>{const d=document.querySelector('+JSON.stringify(selector)+'),title=d.querySelector("h2"),close=d.querySelector(":scope>[data-slot=dialog-close]"),t=title.getBoundingClientRect(),c=close.getBoundingClientRect(),r=d.getBoundingClientRect();return {titleTop:t.top,closeTop:c.top,inside:r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1,closeVisible:close.contains(document.elementFromPoint(c.left+c.width/2,c.top+c.height/2)),closeTarget:c.width>=44&&c.height>=44};})()');
  }
  async function touchScroll(selector) {
    const point=await evaluate('(()=>{const n=document.querySelector('+JSON.stringify(selector)+'),r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.bottom-20,distance:Math.min(300,r.height-40)};})()');
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});
    for(let step=1;step<=10;step++){
      await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y:point.y-point.distance*step/10}]});await sleep(20);
    }
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    // A tap during native scroll inertia only stops the fling. Wait for the scroll owner to settle.
    let last=-1,stable=0;const deadline=Date.now()+2500;
    while(stable<3&&Date.now()<deadline){await sleep(80);const top=await evaluate('document.querySelector('+JSON.stringify(selector)+').scrollTop');stable=Math.abs(top-last)<.5?stable+1:0;last=top;}
    assert.ok(stable>=3,'Native touch scroll did not settle');
  }
  async function launcherProof(width,height) {
    await click('[aria-label="Abrir aplicativos"]');await sleep(150);
    const focus=await evaluate("({coarse:matchMedia('(pointer: coarse)').matches,title:document.activeElement===document.querySelector('.web-launcher h2'),search:document.activeElement===document.querySelector('[aria-label=\"Pesquisar aplicativos\"]')})");
    assert.equal(focus.coarse ? focus.title : focus.search,true,'Touch opens the app list without focusing the keyboard; desktop retains search focus');
    if(width<=820)assert.ok(Object.values(await dialogChrome('.web-launcher')).filter((v)=>typeof v==='boolean').every(Boolean));
    await click('.web-launcher-categories button:last-child');
    assert.equal(await evaluate("document.querySelector('.web-launcher-categories button:last-child').getAttribute('aria-pressed')"),'true');
    assert.equal(await evaluate("!!document.querySelector('.web-launcher [title=\"Abrir Loja\"]') && !document.querySelector('.web-launcher [title=\"Abrir Notas\"]')"),true,'Category filters use the shared app catalog');
    await click('[aria-label="Pesquisar aplicativos"]');await client.send('Input.insertText',{text:'zz-ordax-sem-aplicativo'});
    assert.equal(await evaluate("document.querySelector('.web-launcher [role=status]')?.textContent"),'Nenhuma interface encontrada.');
    await click('[aria-label="Limpar busca de aplicativos"]');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Pesquisar aplicativos\"]').value==='' && document.activeElement===document.querySelector('[aria-label=\"Pesquisar aplicativos\"]')"),true);
    await click('.web-launcher-categories button:first-child');
    if(width<=820){
      const before=await dialogChrome('.web-launcher');
      await touchScroll('.web-launcher-grid');
      const after=await dialogChrome('.web-launcher');
      assert.ok(Math.abs(before.titleTop-after.titleTop)<1&&Math.abs(before.closeTop-after.closeTop)<1&&after.closeVisible&&after.closeTarget,'Launcher title and close remain visible while the app list scrolls');
      const scrollState=await evaluate("(()=>{const n=document.querySelector('.web-launcher-grid');return {clientHeight:n.clientHeight,scrollHeight:n.scrollHeight,scrollTop:n.scrollTop};})()");
      if(!scrollState.scrollTop){const failedShot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(evidence,'launcher-scroll-diagnostic.png'),Buffer.from(failedShot.data,'base64'));}
      assert.ok(scrollState.scrollTop>0,'The app list scrolls independently: '+JSON.stringify({width,height,...scrollState}));
    }
    await click('[aria-label="Pesquisar aplicativos"]');await client.send('Input.insertText',{text:'Notas'});
    assert.equal(await evaluate("document.querySelectorAll('.web-launcher-grid .web-app-tile').length===1 && !!document.querySelector('.web-launcher [title=\"Abrir Notas\"]')"),true);
    if(width===390){
      await client.send('Emulation.setDeviceMetricsOverride',{width,height:430,deviceScaleFactor:1,mobile:true});await sleep(150);
      const short=await dialogChrome('.web-launcher');assert.ok(short.inside&&short.closeVisible&&short.closeTarget,'Launcher remains usable in a short mobile viewport');
      assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('[aria-label=\"Pesquisar aplicativos\"]')).fontSize)>=16 && document.querySelector('[aria-label=\"Pesquisar aplicativos\"]').value==='Notas'"));
    }
    const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(evidence,'launcher-search-'+width+'x'+height+'.png'),Buffer.from(shot.data,'base64'));
    await click('.web-launcher [title="Abrir Notas"]');await noDialog();
    assert.equal(await evaluate("document.querySelectorAll('[aria-label=\"Janela Notas\"]').length"),1);
    if(width===390){await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await sleep(150);}
    await click('[aria-label="Abrir aplicativos"]');await sleep(150);
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Pesquisar aplicativos\"]').value"),'','Launching clears the previous query');
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await noDialog();
    await client.send('Page.navigate',{url:origin+'/?view=home'});await ready();
  }

  async function mobileNavigationProof(width,height) {
    if(width>820)return;
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.web-mobile-bar>button')].map(n=>n.textContent.trim())"),['Início','Aura','Apps','Space','Menu']);
    assert.equal(await evaluate("document.querySelector('.web-mobile-bar [aria-current=page]')?.textContent"),'Início');
    await click('.web-mobile-bar [aria-label="Abrir Aura"]');
    assert.equal(await evaluate("document.querySelector('.web-mobile-bar [aria-current=page]')?.textContent"),'Aura');await paneLayout('collapsed');
    await click('.web-mobile-bar [aria-label="Mostrar Início"]');await paneLayout('expanded');
    await click('.web-mobile-bar [aria-label="Selecionar Space pela navegação"]');
    assert.equal(await evaluate("!!document.querySelector('.web-space-dialog[role=dialog]') && document.querySelector('.web-mobile-bar [aria-label=\"Selecionar Space pela navegação\"]').dataset.selected==='true'"),true);
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await noDialog();
    assert.equal(await evaluate("document.querySelector('.web-mobile-bar [aria-label=\"Abrir aplicativos\"]').dataset.selected"),'false');
    const touch=await evaluate("(()=>{const root=document.querySelector('.web-window-compact:not(.web-compact-hidden)'),buttons=[...root.querySelectorAll('.web-window-titlebar button')].filter(b=>b.getClientRects().length>0);return buttons.map(b=>{const r=b.getBoundingClientRect();return {width:r.width,height:r.height};});})()");
    assert.equal(touch.length,3,'Mobile titlebar keeps three direct actions; other actions remain in its menu');
    assert.ok(touch.every(b=>b.width>=44&&b.height>=44));
    assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('[aria-label=\"Buscar arquivos\"]')).fontSize)>=16"));
    const fileUi=await evaluate("(()=>{const w=document.querySelector('[aria-label=\"Janela Arquivos\"]');return {places:[...w.querySelectorAll('.web-app-navigation button')].every(n=>parseFloat(getComputedStyle(n).fontSize)>=12&&n.getBoundingClientRect().height>=44),status:parseFloat(getComputedStyle(w.querySelector('.web-status')).fontSize)>=11,viewButtons:[...w.querySelectorAll('.web-toolbar-actions [aria-pressed]')].every(n=>n.getClientRects().length>0&&n.getBoundingClientRect().width>=44)};})()");
    assert.ok(Object.values(fileUi).every(Boolean),JSON.stringify(fileUi));
    await click('[aria-label="Janela Arquivos"] [aria-label="Visualização em lista"]');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Janela Arquivos\"] [aria-label=\"Visualização em lista\"]').getAttribute('aria-pressed')"),'true');
    await click('[aria-label="Janela Arquivos"] [aria-label="Visualização em grade"]');
    await click('[aria-label="Menu do workspace"]');
    assert.equal(await evaluate("!!document.querySelector('.web-mobile-menu[role=dialog]') && document.querySelector('.web-mobile-menu').contains(document.activeElement)"),true);
    await sleep(150);
    const menuChrome=await dialogChrome('.web-mobile-menu');
    const menuFooter=await evaluate("(()=>{const dialog=document.querySelector('.web-mobile-menu'),button=dialog.querySelector('.web-mobile-windows'),d=dialog.getBoundingClientRect(),r=button.getBoundingClientRect(),s=getComputedStyle(button);return {width:r.width,height:r.height,top:r.top,bottom:r.bottom,dialogBottom:d.bottom,display:s.display,buttons:[...document.querySelectorAll('.web-mobile-bar>button')].map(n=>{const b=n.getBoundingClientRect();return {width:b.width,height:b.height};})};})()");
    assert.ok(menuFooter.width>=width-34 && menuFooter.height>=44 && menuFooter.display==='flex' && menuFooter.bottom<=menuFooter.dialogBottom,JSON.stringify(menuFooter));
    assert.ok(menuFooter.buttons.every(b=>b.width>=44&&b.height>=44),'Five navigation controls retain touch targets');
    const menuShot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(evidence,'mobile-menu-'+width+'x'+height+'.png'),Buffer.from(menuShot.data,'base64'));
    for(let i=0;i<18;i++){
      await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      assert.equal(await evaluate("document.querySelector('.web-mobile-menu').contains(document.activeElement)"),true,'Focus remains within the mobile menu');
    }
    await touchScroll('.web-mobile-menu .web-navigation-scroll');
    assert.equal(await evaluate("!!document.querySelector('.web-navigation-more-menu')"),false,'A native pan from Mais must not open a dropdown');
    const scrolledMenu=await dialogChrome('.web-mobile-menu');
    const scrolledMenuFooter=await evaluate("(()=>{const dialog=document.querySelector('.web-mobile-menu'),button=dialog.querySelector('.web-mobile-windows'),d=dialog.getBoundingClientRect(),r=button.getBoundingClientRect(),s=getComputedStyle(button);return {width:r.width,height:r.height,top:r.top,bottom:r.bottom,dialogBottom:d.bottom,display:s.display,buttons:[...document.querySelectorAll('.web-mobile-bar>button')].map(n=>{const b=n.getBoundingClientRect();return {width:b.width,height:b.height};})};})()");
    assert.ok(Math.abs(menuFooter.top-scrolledMenuFooter.top)<1&&Math.abs(menuFooter.bottom-scrolledMenuFooter.bottom)<1,'Menu window action stays fixed while navigation scrolls');
    assert.ok(Math.abs(menuChrome.titleTop-scrolledMenu.titleTop)<1&&Math.abs(menuChrome.closeTop-scrolledMenu.closeTop)<1&&scrolledMenu.closeVisible&&scrolledMenu.closeTarget,'Menu header and close remain reachable after scrolling');
    assert.ok(await evaluate("document.querySelector('.web-mobile-menu .web-navigation-scroll').scrollTop>0"));
    const scrolledShot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(evidence,'mobile-menu-scrolled-'+width+'x'+height+'.png'),Buffer.from(scrolledShot.data,'base64'));
    await click('.web-mobile-menu [aria-label="Mais opções de navegação"]');
    assert.equal(await evaluate("!!document.querySelector('.web-navigation-more-menu[role=menu]')"),true,'A complete touch tap opens Mais');
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(200);
    await click('.web-mobile-menu [title="Ajustes"]');await noDialog();
    assert.equal(await evaluate("!!document.querySelector('[aria-label=\"Janela Ajustes\"].web-window-active')"),true,'The last menu actions remain reachable in a short viewport');
    assert.equal(await evaluate("document.activeElement===document.querySelector('[aria-label=\"Menu do workspace\"]')"),true);
    await click('.web-mobile-bar [aria-label="Mostrar Início"]');
    await click('[aria-label="Menu do workspace"]');
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await noDialog();
    assert.equal(await evaluate("document.activeElement===document.querySelector('[aria-label=\"Menu do workspace\"]')"),true,'Escape restores menu-trigger focus');
    await click('[aria-label="Menu do workspace"]');
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:5,y:5}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await sleep(100);await noDialog();
    if(width===390){
      await click('[aria-label="Menu do workspace"]');
      await client.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
      await noDialog();
      assert.equal(await evaluate("document.querySelector('.web-sidebar').getClientRects().length>0"),true,'Desktop navigation replaces the mobile menu after resize');
      await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await sleep(150);
    }
    await click('[aria-label="Menu do workspace"]');
    await click('.web-mobile-menu [aria-label="Visão geral das janelas"]');await sleep(150);
    assert.equal(await evaluate("!!document.querySelector('.web-overview[role=dialog]') && !document.querySelector('.web-mobile-menu[role=dialog]')"),true,'Window overview remains available through Menu');
    assert.equal(await evaluate("document.querySelector('.web-mobile-bar [aria-label=\"Menu do workspace\"]').dataset.selected"),'true');
    assert.equal(await evaluate("document.querySelector('.web-overview').contains(document.activeElement)"),true,'Focus transfers from Menu into window overview');
    await click('[aria-label="Abrir Studio pela visão geral"]');await noDialog();
    assert.equal(await evaluate("document.querySelectorAll('[aria-label=\"Janela Studio\"]').length===1 && !!document.querySelector('[aria-label=\"Janela Studio\"].web-window-active')"),true);
    await client.send('Page.navigate',{url:origin+'/?view=home'});await ready();
  }
  // DOMRect can differ from a 44px computed target by a subpixel (observed 43.999984px).
  // A 0.02px tolerance covers that rounding without accepting smaller touch targets.
  async function seedCompactWindows() {
    for(const name of ['Arquivos','Studio','Internet']) {
      await click('[aria-label="Abrir aplicativos"]');
      await click('.web-launcher [title="Abrir '+name+'"]');await noDialog();
      await click('[aria-label="Compactar '+name+'"]');
    }
    await paneLayout('expanded');
  }
  async function homeFits() {
    const result=await evaluate("(()=>{const root=document.querySelector('.web-home'),page=document.querySelector('.web-page-home'),pages=document.querySelector('.web-pages'),b=root.getBoundingClientRect(),visible=n=>n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden',nodes=[...root.querySelectorAll(':scope>header,:scope>section,:scope>nav,.oi-composer,.web-home-panel-heading,.web-home-project-preview button,.web-home-dashboard button,.web-home-summary button,.web-home-activity-list li,.web-home-devices-list li,.web-welcome button,.web-home-quick-actions button,.oi-home-expand')].filter(visible);return {root:[b.width,b.height],scrolls:[root,page,pages].map(n=>({class:n.className,scroll:[n.scrollWidth,n.scrollHeight],client:[n.clientWidth,n.clientHeight]})),noScroll:[root,page,pages].every(n=>n.scrollHeight<=n.clientHeight+1&&n.scrollWidth<=n.clientWidth+1)&&document.documentElement.scrollHeight<=innerHeight,inside:nodes.every(n=>{const r=n.getBoundingClientRect();return r.top>=b.top-1&&r.bottom<=b.bottom+1&&r.left>=b.left-1&&r.right<=b.right+1}),cards:nodes.map(n=>({class:n.className,height:n.getBoundingClientRect().height})),draft:root.querySelector('textarea').getBoundingClientRect().height>=42};})()");
    assert.ok(result.noScroll&&result.inside&&result.draft,'Home fits its available pane: '+JSON.stringify(result));
  }
  async function homeResponsiveProof(width,height) {
    assert.equal(await evaluate("document.querySelectorAll('.web-window').length"),0,'No app is pre-opened on Home');
    await paneLayout('none');await homeFits();
    const model=await evaluate("(()=>{const r=document.querySelector('.web-home');return {mode:r.dataset.homeMode,visibleLabel:[...r.querySelectorAll('button')].some(n=>n.textContent==='Dados de demonstração'&&n.getClientRects().length>0),projects:r.querySelectorAll('.web-home-project-preview button').length,activity:r.querySelectorAll('.web-home-activity-list li').length,devices:r.querySelectorAll('.web-home-devices-list li').length,favorites:r.querySelectorAll('.web-home-app-grid .web-app-tile').length};})()");
    assert.deepEqual(model,{mode:'demo',visibleLabel:true,projects:4,activity:5,devices:3,favorites:6});
    await click('.web-home-demo-toggle');
    assert.equal(await evaluate("(()=>{const r=document.querySelector('.web-home');return r.dataset.homeMode==='unavailable'&&!r.querySelector('.web-home-project-card,.web-home-activity-list,.web-home-devices-list')&&!r.textContent.includes('MacBook Pro')&&r.textContent.includes('Nenhum dispositivo verificado disponível');})()"),true,'Fixture data disappears together without claiming a connected service');
    await homeFits();await click('.web-home-demo-toggle');await homeFits();
    const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(evidence,'home-'+width+'x'+height+'.png'),Buffer.from(shot.data,'base64'));
    const projectEntry=await evaluate("document.querySelector('.web-home-summary').getClientRects().length>0")?'.web-home-summary button:first-child':'.web-home-recent .web-home-panel-heading button';
    await click(projectEntry);
    assert.equal(await evaluate("document.querySelector('.web-home-dialog').querySelectorAll('.web-home-project-card').length"),4,'All projects remain accessible beyond the preview');
    assert.ok((await dialogChrome('.web-home-dialog')).inside);
    for(let i=0;i<7;i++){
      await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      assert.equal(await evaluate("document.querySelector('.web-home-dialog').contains(document.activeElement)"),true,'Home details retain modal focus');
    }
    await click('.web-home-dialog .web-home-project-card:last-child');
    assert.equal(await evaluate("document.querySelector('.web-home-project-dialog h2').textContent"),'Catálogo');
    await click('.web-home-project-dialog .web-home-dialog-body button:last-child');
    assert.equal(await evaluate("document.querySelector('.web-home-dialog').contains(document.activeElement)"),true,'Returning from a project restores list-entry focus');
    await click('.web-home-dialog>[data-slot=dialog-close]');await noDialog();
    assert.equal(await evaluate('document.activeElement===document.querySelector('+JSON.stringify(projectEntry)+')'),true,'Details restore entry focus');
    if(await evaluate("document.querySelector('.web-home-summary').getClientRects().length>0")){
      await click('.web-home-summary button:last-child');await sleep(150);
      assert.equal(await evaluate("document.querySelector('.web-home-dialog-body').querySelectorAll('section').length"),4,'Mais exposes all dashboard sections');
      if(width<=820) {
        const before=await dialogChrome('.web-home-dialog');await touchScroll('.web-home-dialog-body');const after=await dialogChrome('.web-home-dialog');
        assert.ok(after.closeVisible&&after.closeTarget&&Math.abs(before.titleTop-after.titleTop)<1,'Details scroll without moving title or close control: '+JSON.stringify({before,after}));
        assert.equal(await evaluate("document.querySelector('.web-home-dialog-body').scrollTop>0"),true);
      }
      await click('.web-home-dialog>[data-slot=dialog-close]');await noDialog();
    }
    const composer='.web-home [aria-label="Comando para OrdaX Intelligence"]';
    await click(composer);await client.send('Input.insertText',{text:'rascunho responsivo'});
    await evaluate("window.__homeDraft=document.querySelector('.web-home textarea');true");
    await seedCompactWindows();await homeFits();
    assert.equal(await evaluate("window.__homeDraft===document.querySelector('.web-home textarea')&&window.__homeDraft.value==='rascunho responsivo'"),true,'Home keeps its shared draft and mounted composer in the split pane');
    await click('[aria-label="Recolher janelas compactas"]');await paneLayout('collapsed');await homeFits();
    await click('[aria-label="Expandir janelas compactas"]');await paneLayout('expanded');await homeFits();
    assert.equal(await evaluate("window.__homeDraft===document.querySelector('.web-home textarea')&&window.__homeDraft.value==='rascunho responsivo'"),true);
    if(width===390 || width===1440 || width===844) {
      await click(composer);
      await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
      await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
      await client.send('Input.insertText',{text:'Organize meus documentos por tipo'});
      await click('.web-home [aria-label="Enviar comando de demonstração"]');
      assert.equal(await evaluate("document.querySelector('.web-home .oi-home').classList.contains('oi-processing')"),true);
      await homeFits();
      const deadline=Date.now()+5000;
      while(!await evaluate("document.querySelector('.web-home .oi-home').classList.contains('oi-result')")){if(Date.now()>deadline)throw Error('Home demo did not complete');await sleep(100);}
      await homeFits();
      assert.equal(await evaluate("document.querySelector('.web-home .oi-compact-note').textContent.includes('demonstração')"),true,'Home result remains explicitly simulated');
    }
    await client.send('Page.navigate',{url:origin+'/?view=home'});await ready();
  }

  async function closeWindow(name) {
    const selector='[aria-label="Fechar '+name+'"]';
    if(await evaluate("!![...document.querySelectorAll("+JSON.stringify(selector)+")].find(n=>n.getClientRects().length>0)"))await click(selector);
    else {
      await click('[aria-label="Menu da janela '+name+'"]');
      await click('.web-window-menu [role=menuitem]:last-child');
    }
  }

  async function splitProof(width,height) {
    await paneLayout('expanded');
    await click('[aria-label="Abrir aplicativos"]');
    await click('.web-launcher [title="Abrir Notas"]');await noDialog();
    await paneLayout('expanded');
    await click('[aria-label="Buscar em Notas"]');
    await client.send('Input.insertText',{text:'continuidade compacta'});
    await click('[aria-label="Janela Notas"] [role=tab]:last-child');
    await evaluate("window.__paneProofInput=document.querySelector('[aria-label=\"Buscar em Notas\"]'); true");
    const retained=async()=>assert.equal(await evaluate("window.__paneProofInput===document.querySelector('[aria-label=\"Buscar em Notas\"]') && window.__paneProofInput.value==='continuidade compacta' && document.querySelector('[aria-label=\"Janela Notas\"] [role=tab]:last-child').getAttribute('aria-selected')==='true'"),true,'Mode changes must preserve the same mounted app and its React state');
    await click('[aria-label="Compactar Notas"]');
    for(let attempt=0;attempt<4 && await evaluate("document.querySelector('[aria-label=\"Janela Notas\"]').classList.contains('web-compact-hidden')");attempt++)await click('[aria-label="Próximas janelas compactas"]');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Janela Notas\"]').classList.contains('web-compact-hidden')"),false);
    await paneLayout('expanded');await retained();
    const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(evidence,'split-'+width+'x'+height+'.png'),Buffer.from(shot.data,'base64'));
    await click('[aria-label="Recolher janelas compactas"]');
    await paneLayout('collapsed');await retained();
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Expandir janelas compactas\"]').getAttribute('aria-expanded')"),'false');
    await click('[aria-label="Expandir janelas compactas"]');
    await paneLayout('expanded');await retained();
    await click('[aria-label="Destacar Notas"]');
    await paneLayout('expanded');await retained();
    await fullWindow('Notas');
    await click('[aria-label="Menu da janela Notas"]');
    await click('.web-window-menu [role=menuitem]:nth-child(3)');


    await click('[aria-label="Menu da janela Notas"]');
    await click('.web-window-menu [role=menuitem]:nth-child(5)');
    const full=await evaluate("(()=>{const w=document.querySelector('[aria-label=\"Janela Notas\"]'),b=w.getBoundingClientRect();return w.classList.contains('web-window-immersive') && b.top===0 && b.left===0 && b.height===innerHeight && b.width===innerWidth;})()");
    assert.equal(full,true,'Immersive mode remains available for full-viewport use');
    await retained();
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await sleep(150);await paneLayout('expanded');await retained();
    if(width===390) {
      await client.send('Emulation.setDeviceMetricsOverride',{width,height:430,deviceScaleFactor:1,mobile:true});
      await sleep(150);await paneLayout('expanded');await retained();
      await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
      await sleep(150);await paneLayout('expanded');await retained();
    }
    if(width>820 && height>600) {
      const before=await evaluate("(()=>{const b=document.querySelector('[aria-label=\"Janela Notas\"]').getBoundingClientRect();return {top:b.top,left:b.left};})()");
      const point=await evaluate("(()=>{const b=document.querySelector('[aria-label=\"Janela Notas\"] .web-window-titlebar strong').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()");
      await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
      await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+20,y:point.y-20,button:'left',buttons:1});
      await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+20,y:point.y-20,button:'left',clickCount:1});
      await sleep(100);
      const after=await evaluate("(()=>{const b=document.querySelector('[aria-label=\"Janela Notas\"]').getBoundingClientRect();return {top:b.top,left:b.left};})()");
      assert.ok(Math.abs(after.top-before.top+20)<1 && Math.abs(after.left-before.left-20)<1,'Dragging uses the primary pane geometry');
      await paneLayout('expanded');
    }
    for(let attempt=0;attempt<3;attempt++) await click('.web-window-compact:not(.web-compact-hidden) [aria-label^="Minimizar "]');
    await paneLayout('none');await retained();
    assert.equal(await evaluate("!!document.querySelector('.web-carousel-controls')"),false,'Minimizing the last compact window releases the entire primary pane');
    await click('[aria-label="Abrir aplicativos"]');
    await click('.web-launcher [title="Abrir Arquivos"]');await noDialog();
    await click('[aria-label="Compactar Arquivos"]');
    await paneLayout('expanded');await retained();
    await closeWindow('Arquivos');
    await paneLayout('none');await retained();
  }

  const reports=[];
  for(const [width,height] of [[1440,900],[1024,768],[820,650],[821,650],[700,650],[390,844],[320,568],[844,390]]){
    await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    await client.send('Emulation.setTouchEmulationEnabled',{enabled:width<=820,maxTouchPoints:1});
    for(const view of ['home','assistant','projects','spaces','apps','files','internet','store']){
      await client.send('Page.navigate',{url:origin+'/?view='+view});await ready();
      if(view==='files'||view==='internet')await fullWindow(view==='files'?'Arquivos':'Internet');
      else if(view!=='home')assert.equal(await evaluate("(()=>{const d=document.querySelector('.web-desktop').getBoundingClientRect(),p=document.querySelector('.web-primary-pane').getBoundingClientRect();return [p.top-d.top,p.left-d.left,p.width-d.width,p.height-d.height].every(v=>Math.abs(v)<1);})()"),true,'Workspace pages use the complete area outside shell chrome');
      const state=await evaluate("({canonical:document.querySelectorAll('.web-workspace').length===1&&location.pathname==='/',noOverflow:document.documentElement.scrollWidth<=innerWidth,assets:[...document.images].filter(img=>img.getClientRects().length>0).every(img=>img.complete&&img.naturalWidth>0),font:document.fonts.check('14px Inter')})");
      assert.ok(Object.values(state).every(Boolean),JSON.stringify({width,height,view,state}));
      if (view === 'store') {
        assert.equal(await evaluate("document.querySelector('.st-root')?.dataset.storeMode"), 'official');
        assert.equal(await evaluate("document.querySelectorAll('.st-card').length"), 1, 'Only the OS model candidate is known without the Web transport');
        assert.equal(await evaluate("!!document.querySelector('.st-card button[disabled]')"), true);
        await click('[aria-label="Ver demonstração da Loja"]');
        assert.equal(await evaluate("document.querySelector('.st-root')?.dataset.storeMode"), 'demo');
        await click('.st-nav button:nth-child(7)');
        assert.equal(await evaluate("document.querySelector('.st-body').textContent.includes('Conectado')"), true, 'Demo connected items remain available to evaluate');
        await click('.st-nav button:nth-child(2)');
        await click('[aria-label="Ver detalhes de Player de Mídia"]');
        await click('.st-detail-actions button:first-child');
        assert.equal(await evaluate("!!document.querySelector('.st-running')"), true, 'Demo request has its own progress');
        await click('[aria-label="Voltar à Loja oficial"]');
        await sleep(1100);
        const isolated = await evaluate("({official:document.querySelector('.st-root')?.dataset.storeMode==='official',noProgress:!document.querySelector('.st-running'),noDemoItems:!document.querySelector('.st-body').textContent.includes('Player de Mídia'),noClaimedInstall:!document.querySelector('.st-status.st-s-installed')})");
        assert.ok(Object.values(isolated).every(Boolean), JSON.stringify(isolated));
        assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
        const storeShot = await client.send('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
        await writeFile(join(evidence,'store-'+width+'x'+height+'.png'),Buffer.from(storeShot.data,'base64'));
      }

    }
    await client.send('Page.navigate',{url:origin+'/?view=home'});await ready();
    await click('[aria-label="Abrir aplicativos"]');
    assert.equal(await evaluate("!!document.querySelector('[role=dialog]')"),true);
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await sleep(100);
    await noDialog();
    await adaptiveSidebarProof(width,height);
    await navigationUtilitiesProof(width,height);
    await openingProof(width,height);
    await homeResponsiveProof(width,height);
    await launcherProof(width,height);
    await seedCompactWindows();
    await mobileNavigationProof(width,height);
    await client.send('Page.navigate',{url:origin+'/?view=home'});await ready();
    await seedCompactWindows();
    await splitProof(width,height);
    await client.send('Page.navigate',{url:origin+'/?view=home'});await ready();
    if(width>820){
      await click('[aria-label="Abrir aplicativos"]');await click('.web-launcher [title="Abrir Studio"]');await noDialog();await fullWindow('Studio');
      assert.equal(await evaluate('!!document.querySelector(\'[aria-label="Janela Studio"].web-window-maximized\')'),true);await paneLayout('none');
      await click('[aria-label="Minimizar Studio"]');await click('[aria-label="Abrir Studio pelo dock"]');
      assert.equal(await evaluate('!!document.querySelector(\'[aria-label="Janela Studio"].web-window-maximized\')'),true);
      await closeWindow('Studio');
      assert.equal(await evaluate('!document.querySelector(\'[aria-label="Janela Studio"]\')'),true);
      await click('[aria-label="Abrir aplicativos"]');await click('.web-launcher [title="Abrir Studio"]');await noDialog();
      assert.equal(await evaluate('document.querySelectorAll(\'[aria-label="Janela Studio"]\').length'),1);
    }
    const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(evidence,'web-'+width+'x'+height+'.png'),Buffer.from(shot.data,'base64'));
    reports.push({width,height,views:8,responsiveHome:true,storeModeIsolation:true,splitPanes:true,mountedStateRetention:true,fullAppOpening:true,mobileNavigation:width<=820,assets:true,noOverflow:true,launcher:true,dialogScrollAndFocus:true,windowLifecycle:width>820});
    console.log('SURFACE_VIEWPORT=PASS '+width+'x'+height);
  }
  return reports;
 });
 await writeFile(join(evidence,'report.json'),JSON.stringify(reports,null,2)+'\n');
 console.log('SURFACE_BROWSER_SMOKE=PASS '+JSON.stringify(reports));
}finally{await new Promise(done=>server.close(done));}
