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
    await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    await sleep(100);
  }

  async function noDialog() {
    const deadline=Date.now()+3000;
    while(await evaluate("!!document.querySelector('[role=dialog]')")){if(Date.now()>deadline)throw Error('Dialog did not finish closing');await sleep(25);}
  }
  async function paneLayout(expected) {
    const layout = await evaluate(`(() => {
      const rect = node => { const b=node.getBoundingClientRect(); return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,width:b.width,height:b.height}; };
      const desktop=document.querySelector('.web-desktop'), primary=document.querySelector('.web-primary-pane');
      const visible=node=>node.getClientRects().length>0 && getComputedStyle(node).visibility==='visible';
      return {mode:desktop.dataset.compactLayout, desktop:rect(desktop), primary:rect(primary),
        root:rect(document.querySelector('.web-workspace')), viewport:innerHeight,
        noDocumentScroll:document.documentElement.scrollHeight<=innerHeight,
        windows:[...document.querySelectorAll('.web-window')].filter(visible).map(node=>({mode:[...node.classList].find(value=>/^web-window-(normal|maximized|compact|immersive)$/.test(value)),rect:rect(node)})),
        controls:document.querySelector('.web-carousel-controls') ? rect(document.querySelector('.web-carousel-controls')) : null};
    })()`);
    if(expected) assert.equal(layout.mode,expected);
    assert.ok(Math.abs(layout.root.height-layout.viewport)<1 && layout.noDocumentScroll, JSON.stringify(layout));
    const reserved=layout.mode==='expanded' ? layout.desktop.height/2 : layout.mode==='collapsed' ? layout.controls.height : 0;
    assert.ok(Math.abs(layout.primary.height-(layout.desktop.height-reserved))<1, JSON.stringify(layout));
    for(const win of layout.windows) {
      if(win.mode==='web-window-immersive')continue;
      const bounds=win.mode==='web-window-compact' ? {top:layout.primary.bottom,bottom:layout.desktop.bottom} : layout.primary;
      assert.ok(win.rect.top>=bounds.top-1 && win.rect.bottom<=bounds.bottom+1 && win.rect.left>=layout.desktop.left-1 && win.rect.right<=layout.desktop.right+1, JSON.stringify({layout,win}));
    }
    if(layout.controls) assert.ok(Math.abs(layout.controls.top-layout.primary.bottom)<1,JSON.stringify(layout));
    return layout;
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
    if(width>760 && height>600) {
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
    await click('[aria-label="Fechar Arquivos"]');
    await paneLayout('none');await retained();
  }

  const reports=[];
  for(const [width,height] of [[1440,900],[1024,768],[700,650],[390,844],[320,568],[844,390]]){
    await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    for(const view of ['home','assistant','projects','spaces','apps','files','internet','store']){
      await client.send('Page.navigate',{url:origin+'/?view='+view});await ready();
      const state=await evaluate("({canonical:document.querySelectorAll('.web-workspace').length===1&&location.pathname==='/',noOverflow:document.documentElement.scrollWidth<=innerWidth,assets:[...document.images].filter(img=>img.getClientRects().length>0).every(img=>img.complete&&img.naturalWidth>0),font:document.fonts.check('14px Inter'),unavailable:document.querySelector('.web-sidebar-status')?.textContent.includes('não conectados')})");
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
    await splitProof(width,height);
    await client.send('Page.navigate',{url:origin+'/?view=home'});await ready();
    if(width>760){
      await click('[aria-label="Abrir Studio pelo dock"]');await click('[aria-label="Maximizar Studio"]');
      assert.equal(await evaluate('!!document.querySelector(\'[aria-label="Janela Studio"].web-window-maximized\')'),true);await paneLayout('expanded');
      await click('[aria-label="Minimizar Studio"]');await click('[aria-label="Abrir Studio pelo dock"]');
      assert.equal(await evaluate('!!document.querySelector(\'[aria-label="Janela Studio"].web-window-maximized\')'),true);
      await click('[aria-label="Fechar Studio"]');
      assert.equal(await evaluate('!document.querySelector(\'[aria-label="Janela Studio"]\')'),true);
      await click('[aria-label="Abrir Studio pelo dock"]');
      assert.equal(await evaluate('document.querySelectorAll(\'[aria-label="Janela Studio"]\').length'),1);
    }
    const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(evidence,'web-'+width+'x'+height+'.png'),Buffer.from(shot.data,'base64'));
    reports.push({width,height,views:8,storeModeIsolation:true,splitPanes:true,mountedStateRetention:true,assets:true,noOverflow:true,launcher:true,windowLifecycle:width>760});
  }
  return reports;
 });
 await writeFile(join(evidence,'report.json'),JSON.stringify(reports,null,2)+'\n');
 console.log('SURFACE_BROWSER_SMOKE=PASS '+JSON.stringify(reports));
}finally{await new Promise(done=>server.close(done));}
