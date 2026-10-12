#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve, relative, isAbsolute, sep, join, extname} from 'node:path';
import {runBrowser, sleep} from '../browser-proof/chromium.mjs';

const args=process.argv.slice(2);
if (args.some((value,index)=>index%2===0&&!['--bundle-dir','--evidence-dir'].includes(value))) throw Error('Unsupported argument');
const value=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const bundle=resolve(value('--bundle-dir','out/web-client'));
const evidence=resolve(value('--evidence-dir','out/web-viewport-proof'));
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.json':'application/json'};
const server=createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
    const path=resolve(bundle,'.'+(pathname==='/'?'/index.html':pathname));
    const rel=relative(bundle,path);
    if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Outside bundle');
    // Resolve the file before emitting HTTP 200. A missing asset must never
    // commit success headers and then crash the entire Chromium smoke server.
    const bytes = await readFile(path);
    response.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream'});
    response.end(bytes);
  } catch {
    if (!response.headersSent) {
      response.writeHead(404);
      response.end();
    } else {
      response.destroy();
    }
  }
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
await mkdir(evidence,{recursive:true});
try {
  for (const path of ['/web2','/web2/','/preview/']) assert.equal((await fetch(origin+path)).status,404,'Only the canonical root is mounted');
  const reports=await runBrowser(async client=>{
    async function evaluate(expression){
      const reply=await client.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      if(reply.exceptionDetails)throw Error(reply.exceptionDetails.exception?.description??'Evaluation failed');
      return reply.result?.value;
    }
    async function until(expression){
      const deadline=Date.now()+15000;
      while(!await evaluate(expression)){
        if(Date.now()>deadline)throw Error('Timed out: '+expression);
        await sleep(50);
      }
    }
    async function ready(){
      await until("!!document.querySelector('.os-shell,.classic-desktop') && document.querySelector('#ordax-boot-screen').hidden");
      await evaluate('document.fonts.ready.then(()=>true)');
      await evaluate("Promise.all([...document.images].filter(img=>img.getClientRects().length).map(img=>img.decode())).then(()=>true)");
    }
    async function click(selector){
      const point=await evaluate("(()=>{const node=[...document.querySelectorAll("+JSON.stringify(selector)+")].find(n=>n.getClientRects().length);if(!node)throw Error('Missing control');node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const box=node.getBoundingClientRect();return{x:box.left+box.width/2,y:box.top+box.height/2};})()");
      await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
      await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
      await sleep(100);
    }
    async function selectColorThemeWithKeyboard(key) {
      // Change the visible native <select> with trusted Chromium keyboard input.
      // The Surface owns the preference; the proof does not mutate its store.
      const selector = '#web-color-theme';
      assert.equal(await evaluate("(()=>{const n=document.querySelector('#web-color-theme');return n?.tagName==='SELECT'&&n.getClientRects().length>0})()"),true,'Canonical color-theme select must be visible');
      await click(selector);
      const code = key === 'ArrowDown' ? 40 : key === 'ArrowUp' ? 38 : 36;
      await client.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code});
      await client.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});
      await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    }
    async function clickByText(selector,text){
      // Radix popup items are mounted asynchronously after the pointer event.
      // Observe their actual visible state instead of relying on a fixed delay.
      const expression="([...document.querySelectorAll("+JSON.stringify(selector)+")].some(n=>n.getClientRects().length&&n.textContent.trim()==="+JSON.stringify(text)+"))";
      try {
        await until(expression);
      } catch (error) {
        const diagnostics=await evaluate("(()=>({items:[...document.querySelectorAll("+JSON.stringify(selector)+")].map(n=>({text:n.textContent.trim(),visible:!!n.getClientRects().length})),triggers:[...document.querySelectorAll('[aria-label]')].filter(n=>n.getAttribute('aria-label')?.startsWith('Mais ações de ')).map(n=>{const r=n.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;return{label:n.getAttribute('aria-label'),state:n.getAttribute('data-state'),rect:{x,y,width:r.width,height:r.height},hit:document.elementsFromPoint(x,y).slice(0,5).map(e=>({tag:e.tagName,cls:e.className?.baseVal??e.className,aria:e.getAttribute('aria-label'),role:e.getAttribute('role')}))}}),compact:document.querySelector('.window-workspace')?.dataset.compact,viewport:[innerWidth,innerHeight]}))()");
        throw Error('Missing visible menu action '+JSON.stringify(text)+': '+JSON.stringify(diagnostics),{cause:error});
      }
      const marker=await evaluate("(()=>{const nodes=[...document.querySelectorAll("+JSON.stringify(selector)+")];const node=nodes.find(n=>n.getClientRects().length&&n.textContent.trim()==="+JSON.stringify(text)+");if(!node)throw Error('Menu item changed while selecting');node.dataset.proofClick='current';return '[data-proof-click=current]';})()");
      await click(marker);
      await evaluate("document.querySelector('[data-proof-click=current]')?.removeAttribute('data-proof-click')");
    }
    await client.send('Page.navigate',{url:origin+'/'});await ready();
    async function compactAction(title,label,menuTitle){
      const selector='[aria-label='+JSON.stringify(label)+']';
      const visible=await evaluate('[...document.querySelectorAll('+JSON.stringify(selector)+')].some(node=>node.getClientRects().length>0)');
      if(visible) await click(selector);
      else {
        await click('[aria-label='+JSON.stringify('Mais ações de '+title)+']');
        await clickByText('[role="menuitem"]',menuTitle);
      }
    }
    async function openSidebarDestination(title) {
      const direct='.workspace-sidebar [aria-label='+JSON.stringify(title)+']';
      const directVisible=await evaluate('[...document.querySelectorAll('+JSON.stringify(direct)+')].some(node=>node.getClientRects().length>0)');
      if (directVisible) return click(direct);
      // The navigation service deliberately exposes fewer pinned destinations
      // when the sidebar height is short; remaining apps stay in "Mais destinos".
      const more='.workspace-sidebar [aria-label="Mais destinos"]';
      const moreVisible=await evaluate('[...document.querySelectorAll('+JSON.stringify(more)+')].some(node=>node.getClientRects().length>0)');
      assert.equal(moreVisible,true,'Short-height sidebar must expose a reachable overflow launcher');
      await click(more);
      await clickByText('.desktop-menu-apps button',title);
    }
    const results=[];
    for(const [width,height] of [[1440,900],[1024,768],[820,650],[760,650],[390,844],[320,568],[844,390]]){
      await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await evaluate("localStorage.removeItem('ordax.preferences.v1')");
      await client.send('Page.navigate',{url:origin+'/'});await ready();
      await until("!!document.querySelector('.os-shell')");
      assert.equal(await evaluate("!document.querySelector('.web-workspace')"),true,'Previous page must not be mounted');
      assert.equal(await evaluate("document.querySelector('.brand-sub').textContent.trim()==='WEB'"),true);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'No horizontal document overflow');
      assert.equal(await evaluate("(()=>{const main=document.querySelector('.central-presentation .os-main');return main.scrollHeight<=main.clientHeight+1&&getComputedStyle(main).overflowY==='hidden';})()"),true,'Central fits the work area without page scrolling');
      assert.equal(await evaluate("!document.querySelector('.home-overflow')"),true,'Home overflow button is removed');
      assert.equal(await evaluate("document.querySelectorAll('.quick-item').length"),4);
      const before=await evaluate("getComputedStyle(document.body).backgroundColor");
      await click('[aria-label="Ajustes do espaço"]');
      assert.equal(await evaluate("document.documentElement.dataset.theme"),'light','Clean profile starts with official light palette');
      await selectColorThemeWithKeyboard('ArrowDown');
      await until("document.documentElement.dataset.theme==='dark'");
      assert.equal(await evaluate("document.querySelector('#web-color-theme').value"),'dark','User-selected theme must be reflected in visible control');
      assert.notEqual(await evaluate('getComputedStyle(document.body).backgroundColor'),before);
      await client.send('Page.navigate',{url:origin+'/'});await ready();
      await until("document.documentElement.dataset.theme==='dark'");
      await click('[aria-label="Ajustes do espaço"]');
      assert.equal(await evaluate("document.querySelector('#web-color-theme').value"),'dark','Persisted dark theme matches visible preference');
      await selectColorThemeWithKeyboard('ArrowUp');
      await until("document.documentElement.dataset.theme==='light'");
      assert.equal(await evaluate("document.querySelector('#web-color-theme').value"),'light','Light theme returns through the same public control');
      await click('[aria-label="Fechar Configurações"]');
      assert.equal(await evaluate("document.querySelectorAll('.workspace-navigation').length"),1,'One navigation in both views');
      assert.equal(await evaluate("document.querySelectorAll('.workspace-sidebar').length"),1,'One shared sidebar');
      const initiallyExpanded=await evaluate("document.querySelector('.sidebar-collapse').getAttribute('aria-expanded')");
      await click('.sidebar-collapse');
      await until("document.querySelector('.sidebar-collapse').getAttribute('aria-expanded')!=="+JSON.stringify(initiallyExpanded));
      await click('.sidebar-collapse');
      await until("document.querySelector('.sidebar-collapse').getAttribute('aria-expanded')==="+JSON.stringify(initiallyExpanded));
      assert.equal(await evaluate("document.querySelectorAll('.account-actions [aria-label=\"Notificações\"]').length"),1,'Notification control sits next to account settings');
      assert.equal(await evaluate("!!document.querySelector('.home-footer,.home-mode-select')"),false,'Home footer and its mode selector are removed');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.workspace-sidebar')).overflowY"),'hidden','Sidebar does not scroll');
      assert.equal(await evaluate("Math.abs(document.querySelector('.workspace-sidebar').getBoundingClientRect().bottom-innerHeight)<2"),true,'Sidebar reaches viewport bottom');
      assert.equal(await evaluate("!!document.querySelector('.workspace-navigation [data-workspace-switch]') && !document.querySelector('.desktop-start-button')"),true,'View switch belongs to the dock; Start button is absent');
      await evaluate("(()=>{const n=document.querySelector('.aura-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'Apenas demonstração');n.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await click('[aria-label="Enviar ao Aura"]');
      await until("!!document.querySelector('[aria-label=\"Janela Aura\"]')");
      assert.equal(await evaluate("document.querySelector('[aria-label=\"Janela Aura\"]').textContent.includes('não está conectada')"),true,'Prompt cannot imply real inference');
      await evaluate("window.proofAura=document.querySelector('[aria-label=\"Janela Aura\"]');window.proofAura.querySelector('input').focus()");
      await click('[aria-label="Compactar Aura"]');
      assert.equal(await evaluate("document.querySelector('.window-workspace').dataset.compact"),'expanded');
      assert.equal(await evaluate("window.proofAura===document.querySelector('[aria-label=\"Janela Aura\"]')"),true,'Compact keeps the same mounted app');
      await openSidebarDestination('Projetos');
      await click('[aria-label="Compactar Projetos"]');
      assert.equal(await evaluate("document.querySelectorAll('.workspace-window[data-mode=\"compact\"]').length"),2,'Both compact app instances remain mounted');
      if (width <= 760) {
        await until("(()=>{const strip=document.querySelector('.workspace-windows');const panes=[...strip.querySelectorAll('[data-mode=\"compact\"]')];const shown=panes.filter(p=>p.getClientRects().length>0);if(panes.length!==2||shown.length!==1)return false;const selected=shown[0];const bounds=selected.getBoundingClientRect();const all=strip.getBoundingClientRect();return selected.getAttribute('aria-label')==='Janela Projetos'&&selected.dataset.compactSelected==='true'&&Math.abs(bounds.width-all.width)<2&&strip.scrollWidth<=strip.clientWidth+1;})()");
        assert.equal(await evaluate("(()=>{const pane=document.querySelector('[aria-label=\"Janela Projetos\"]');const select=pane?.querySelector('.compact-window-switcher');return !!select&&select.getClientRects().length>0&&[...select.options].some(option=>option.value==='Aura');})()"),true,'Mobile panel must expose keyboard-reachable switcher for the other mounted app');
      } else {
        assert.equal(await evaluate("document.querySelectorAll('.workspace-window[data-mode=\"compact\"]:not([hidden])').length"),2,'Both compact apps remain visible on desktop');
        assert.equal(await evaluate("(()=>{const a=document.querySelector('[aria-label=\"Janela Aura\"]').getBoundingClientRect();const b=document.querySelector('[aria-label=\"Janela Projetos\"]').getBoundingClientRect();return Math.abs(a.top-b.top)<2&&a.right<=b.left+1;})()"),true,'Compact apps tile horizontally without overlap');
        assert.equal(await evaluate("(()=>{const strip=document.querySelector('.workspace-windows');const panes=[...strip.querySelectorAll('[data-mode=\"compact\"]:not([hidden])')].map(p=>p.getBoundingClientRect());return strip.scrollWidth<=strip.clientWidth+1&&Math.abs(panes[0].width-panes[1].width)<2;})()"),true,'Compact panels share available width equally without strip overflow');
      }
      assert.equal(await evaluate("window.proofAura===document.querySelector('[aria-label=\"Janela Aura\"]')"),true,'Adding a neighbor keeps the existing app node');
      await click('[aria-label="Fechar Projetos"]');
      if (width <= 760) await until("document.querySelector('[aria-label=\"Janela Aura\"]').getClientRects().length>0");
      await openSidebarDestination('Arquivos');
      await evaluate("window.proofUpperHeight=document.querySelector('[aria-label=\"Janela Arquivos\"]').getBoundingClientRect().height");
      assert.equal(await evaluate("(()=>{const upper=document.querySelector('[aria-label=\"Janela Arquivos\"]').getBoundingClientRect();const lower=document.querySelector('[aria-label=\"Janela Aura\"]').getBoundingClientRect();return upper.bottom<=lower.top+1;})()"),true,'New app fits above compact panels without overlap');
      await compactAction('Aura','Recolher painel Aura','Recolher painel');
      await until("document.querySelector('.window-workspace').dataset.compact==='collapsed'");
      await until("document.querySelector('[aria-label=\"Janela Arquivos\"]').getBoundingClientRect().height>window.proofUpperHeight");
      await compactAction('Aura','Expandir painel Aura','Expandir painel');
      await until("document.querySelector('.window-workspace').dataset.compact==='expanded'");
      await until("Math.abs(document.querySelector('[aria-label=\"Janela Arquivos\"]').getBoundingClientRect().height-window.proofUpperHeight)<2");
      await click('[aria-label="Fechar Arquivos"]');
      await compactAction('Aura','Minimizar Aura','Minimizar');
      await until("window.proofAura.hidden===true");
      await click('[aria-label="Restaurar janela Aura"]');
      assert.equal(await evaluate("window.proofAura.querySelector('input').value"),'Apenas demonstração','Minimize keeps the draft');
      await compactAction('Aura','Expandir janela Aura','Expandir janela');
      await click('[aria-label="Fechar Aura"]');
      await evaluate("window.proofNavigation=document.querySelector('.workspace-navigation');window.proofToggle=document.querySelector('[data-workspace-switch]').getBoundingClientRect().toJSON()");
      await click('[data-workspace-switch]');
      assert.equal(await evaluate("window.proofNavigation===document.querySelector('.workspace-navigation')"),true,'Switch keeps the same navigation node');
      assert.equal(await evaluate("document.querySelector('[data-workspace-switch]').getBoundingClientRect().left===window.proofToggle.left"),true,'Toggle stays at the dock edge in both views');
      await until("!!document.querySelector('.classic-desktop')");
      await clickByText('.desktop-shortcuts button','Projetos');
      await click('[aria-label="Restaurar janela Projetos"]');
      assert.equal(await evaluate("document.querySelectorAll('[aria-label=\"Janela Projetos\"]').length"),1);
      await click('[aria-label="Restaurar Projetos"]');
      await click('[aria-label="Maximizar Projetos"]');
      assert.equal(await evaluate("(()=>{const app=document.querySelector('[aria-label=\"Janela Projetos\"]').getBoundingClientRect();const rail=document.querySelector('.workspace-sidebar').getBoundingClientRect();const dock=document.querySelector('.workspace-navigation').getBoundingClientRect();return Math.abs(app.left-rail.right)<2&&Math.abs(app.top)<2&&Math.abs(app.right-innerWidth)<2&&Math.abs(app.bottom-dock.top)<2;})()"),true,'Maximized app fills the area between sidebar and dock');
      assert.equal(await evaluate("document.querySelector('[aria-label=\"Janela Projetos\"]').dataset.maximized"),'true');
      await click('[aria-label="Minimizar Projetos"]');
      assert.equal(await evaluate("document.querySelector('[aria-label=\"Janela Projetos\"]').hidden"),true);
      await click('[aria-label="Restaurar janela Projetos"]');
      assert.equal(await evaluate("document.querySelector('[aria-label=\"Janela Projetos\"]').dataset.maximized"),'true');
      await click('[aria-label="Minimizar Projetos"]');
      assert.equal(await evaluate("document.querySelectorAll('.desktop-window:not([hidden])').length"),0);
      await click('[aria-label="Restaurar janela Projetos"]');
      await click('[aria-label="Fechar Projetos"]');
      assert.equal(await evaluate("!document.querySelector('[aria-label=\"Restaurar janela Projetos\"]')"),true);
      await click('[data-workspace-switch]');
      await until("!!document.querySelector('.os-shell')");
      const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await writeFile(join(evidence,'central-'+width+'x'+height+'.png'),Buffer.from(shot.data,'base64'));
      results.push({width,height,primaryCentral:true,themePersistence:true,mobileNavigation:width<=760,desktopLifecycle:true,compactLifecycle:true,stableAppNode:true,promptUnconnected:true,noHorizontalOverflow:true});
      console.log('SURFACE_VIEWPORT=PASS '+width+'x'+height);
    }
    return results;
  });
  await writeFile(join(evidence,'report.json'),JSON.stringify(reports,null,2)+'\n');
  console.log('SURFACE_BROWSER_SMOKE=PASS '+JSON.stringify(reports));
}finally{await new Promise(done=>server.close(done));}
