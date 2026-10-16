#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve, relative, isAbsolute, sep, join, extname} from 'node:path';
import {runBrowser, sleep} from '../browser-proof/chromium.mjs';

const args=process.argv.slice(2);
if(args.length%2)throw Error('Arguments require values');
if (args.some((value,index)=>index%2===0&&!['--bundle-dir','--evidence-dir','--public-policy','--mount-path'].includes(value))) throw Error('Unsupported argument');
const value=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const bundle=resolve(value('--bundle-dir','out/web-client'));
const evidence=resolve(value('--evidence-dir','out/web-viewport-proof'));
const mountPath=value('--mount-path','/');
if(!/^\/(?:[a-z0-9-]+\/)*$/.test(mountPath))throw Error('Invalid same-origin mount path');
const policyPath=value('--public-policy',null);
const publicHeaders=policyPath?JSON.parse(await readFile(resolve(policyPath),'utf8')).headers.find(rule=>rule.source==='/(.*)')?.headers:null;
if(policyPath&&!publicHeaders?.some(header=>header.key.toLowerCase()==='content-security-policy'))throw Error('Public policy must define the global CSP');
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.json':'application/json'};
const server=createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
    const path=resolve(bundle,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
    const rel=relative(bundle,path);
    if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Outside bundle');
    // Resolve the file before emitting HTTP 200. A missing asset must never
    // commit success headers and then crash the entire Chromium smoke server.
    const bytes = await readFile(path);
    response.writeHead(200,{...Object.fromEntries((publicHeaders??[]).map(header=>[header.key,header.value])),'content-type':mime[extname(path)]??'application/octet-stream'});
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
const runtimeUrl=origin+mountPath;
await mkdir(evidence,{recursive:true});
try {
  for (const path of ['/web2','/web2/','/preview/']) assert.equal((await fetch(origin+path)).status,404,'Only the canonical root is mounted');
  const reports=await runBrowser(async client=>{
    if(publicHeaders)await client.send('Page.addScriptToEvaluateOnNewDocument',{source:"window.surfacePolicyViolations=[];document.addEventListener('securitypolicyviolation',event=>window.surfacePolicyViolations.push({directive:event.effectiveDirective,blocked:event.blockedURI,source:event.sourceFile,line:event.lineNumber}));"});
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
      const point=await evaluate("(()=>{const node=[...document.querySelectorAll("+JSON.stringify(selector)+")].find(n=>n.getClientRects().length);if(!node)throw Error("+JSON.stringify('Missing control: '+selector)+");node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const box=node.getBoundingClientRect();return{x:box.left+box.width/2,y:box.top+box.height/2};})()");
      await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
      await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
      await sleep(100);
    }
    async function chooseColorTheme(theme) {
      // Use the real shared Settings application and its accessible buttons.
      // Never write preference storage or DOM theme attributes from the proof.
      const selector='[aria-label="Janela Configurações"] [data-color-theme='+JSON.stringify(theme)+']';
      await until("([...document.querySelectorAll("+JSON.stringify(selector)+")].some(n=>n.getClientRects().length>0))");
      await click(selector);
      await until("document.documentElement.dataset.theme==="+JSON.stringify(theme));
      await until("document.querySelector("+JSON.stringify(selector)+")?.getAttribute('aria-pressed')==='true'");
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
    await client.send('Page.navigate',{url:runtimeUrl});await ready();
    async function compactAction(title,label,menuTitle){
      const selector='[aria-label='+JSON.stringify(label)+']';
      const visible=await evaluate('[...document.querySelectorAll('+JSON.stringify(selector)+')].some(node=>node.getClientRects().length>0)');
      const clickedSelector=visible?selector:'[aria-label='+JSON.stringify('Mais ações de '+title)+']';
      const hit=await evaluate("(()=>{const n=[...document.querySelectorAll("+JSON.stringify(clickedSelector)+")].find(x=>x.getClientRects().length);if(!n)return {missing:true};const r=n.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const target=document.elementFromPoint(x,y);return {label:n.getAttribute('aria-label'),box:r.toJSON(),reachable:n===target||n.contains(target),hitTag:target?.tagName,hitAria:target?.getAttribute('aria-label'),hitClass:target?.getAttribute('class'),mode:document.querySelector('.window-workspace')?.dataset.compact,viewport:[innerWidth,innerHeight]}})()");
      if(!hit.reachable) throw Error('Compact action is obstructed: '+JSON.stringify(hit));
      if(visible) await click(selector);
      else {
        await click(clickedSelector);
        await clickByText('[role="menuitem"]',menuTitle);
      }
      if(menuTitle==='Recolher painel'||menuTitle==='Expandir painel'){
        const expected=menuTitle==='Recolher painel'?'collapsed':'expanded';
        try {
          await until("document.querySelector('.window-workspace').dataset.compact==="+JSON.stringify(expected));
        } catch(error) {
          const details=await evaluate("(()=>({compact:document.querySelector('.window-workspace')?.dataset.compact,trigger:[...document.querySelectorAll('[aria-label]')].filter(n=>n.getAttribute('aria-label')?.startsWith('Mais ações de ')).map(n=>({label:n.getAttribute('aria-label'),open:n.getAttribute('data-state'),box:n.getBoundingClientRect().toJSON()})),visibleControls:[...document.querySelectorAll('.workspace-window[data-mode=\"compact\"] button')].filter(n=>n.getClientRects().length).map(n=>({label:n.getAttribute('aria-label'),box:n.getBoundingClientRect().toJSON()})),focus:document.activeElement?.outerHTML?.slice(0,240),viewport:[innerWidth,innerHeight]}))()");
          throw Error('Compact action did not reach '+expected+': '+JSON.stringify({hit,details}),{cause:error});
        }
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
      if(moreVisible)await click(more);
      else await click('[aria-label="Abrir aplicativos e navegação"]');
      await clickByText('.desktop-menu-apps button',title);
      await until("!document.querySelector('.desktop-start-menu')");
    }
    const results=[];
    for(const [width,height] of [[1440,900],[1024,768],[820,650],[760,650],[390,844],[320,568],[844,390]]){
      await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await evaluate("localStorage.removeItem('ordax.preferences.v1')");
      await client.send('Page.navigate',{url:runtimeUrl});await ready();
      await until("!!document.querySelector('.os-shell')");
      assert.equal(await evaluate("!document.querySelector('.web-workspace')"),true,'Previous page must not be mounted');
      assert.equal(await evaluate("/\\bWEB\\b/.test(document.querySelector('.brand-sub').textContent)"),true);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'No horizontal document overflow');
      assert.equal(await evaluate("(()=>{const main=document.querySelector('.central-presentation .os-main');return main.clientHeight>0&&main.scrollWidth<=main.clientWidth+1&&['auto','scroll','hidden'].includes(getComputedStyle(main).overflowY);})()"),true,'Central fits horizontally and retains its bounded content area');
      assert.equal(await evaluate("!document.querySelector('.home-overflow')"),true,'Home overflow button is removed');
      assert.equal(await evaluate("!!document.querySelector('#meridian-prompt') && !!document.querySelector('[aria-label=\"Sua central OrdaX OS\"] img')"),true,'Meridian hero and contextual prompt remain available');
      if(width===1440){
        await openSidebarDestination('Loja');
        await until("!!document.querySelector('.meridian-store-presentation')?.shadowRoot?.querySelector('[data-meridian]')");
        assert.equal(await evaluate("(()=>{const root=document.querySelector('.meridian-store-presentation').shadowRoot;return root.adoptedStyleSheets.length===1&&!root.querySelector('style')&&getComputedStyle(root.querySelector('[data-meridian]')).getPropertyValue('--md-canvas').trim()==='#f4f2ed';})()"),true,'Store examples use the canonical bundled stylesheet without inline style elements');
        await click('[aria-label="Fechar Loja"]');
        await openSidebarDestination('Espaços');
        await clickByText('.meridian-spaces-context-actions button','Ver exemplos completos');
        await until("!!document.querySelector('.meridian-spaces-presentation')?.shadowRoot?.querySelector('[data-spaces-page]')");
        assert.equal(await evaluate("(()=>{const root=document.querySelector('.meridian-spaces-presentation').shadowRoot;return root.adoptedStyleSheets.length===1&&!root.querySelector('style')&&getComputedStyle(root.querySelector('[data-meridian]')).getPropertyValue('--md-canvas').trim()==='#f4f2ed';})()"),true,'Space examples retain the shared tokens in their scoped stylesheet');
        await click('[aria-label="Fechar Espaços"]');
      }
      const before=await evaluate("getComputedStyle(document.body).backgroundColor");
      assert.equal(await evaluate("document.documentElement.dataset.theme"),'light','Clean profile starts with official light palette');
      await openSidebarDestination('Ajustes');
      await chooseColorTheme('dark');
      assert.notEqual(await evaluate('getComputedStyle(document.body).backgroundColor'),before);
      await client.send('Page.navigate',{url:runtimeUrl});await ready();
      await until("document.documentElement.dataset.theme==='dark'");
      await openSidebarDestination('Ajustes');
      await until("document.querySelector('[aria-label=\"Janela Configurações\"] [data-color-theme=\"dark\"]')?.getAttribute('aria-pressed')==='true'");
      await chooseColorTheme('native');
      assert.equal(await evaluate("document.documentElement.dataset.ordaxTheme"),'dark','USB palette remains a dark accessible color scheme');
      assert.equal(await evaluate("document.documentElement.dataset.ordaxPalette"),'native','USB palette is the canonical native palette, not a fourth app theme');
      await client.send('Page.navigate',{url:runtimeUrl});await ready();
      await until("document.documentElement.dataset.theme==='native'");
      await openSidebarDestination('Ajustes');
      await chooseColorTheme('light');
      await click('[aria-label="Fechar Configurações"]');
      assert.equal(await evaluate("document.querySelectorAll('.workspace-navigation').length"),1,'One navigation in both views');
      assert.equal(await evaluate("document.querySelectorAll('.workspace-sidebar').length"),1,'One shared sidebar');
      if(width>950){
        const initiallyExpanded=await evaluate("document.querySelector('.sidebar-collapse').getAttribute('aria-expanded')");
        const initialRail=await evaluate("document.querySelector('.workspace-sidebar').getBoundingClientRect().width");
        await click('.sidebar-collapse');
        await until("document.querySelector('.sidebar-collapse').getAttribute('aria-expanded')!=="+JSON.stringify(initiallyExpanded));
        await until("document.querySelector('.workspace-sidebar').getBoundingClientRect().width!=="+initialRail);
        await click('.sidebar-collapse');
        await until("document.querySelector('.sidebar-collapse').getAttribute('aria-expanded')==="+JSON.stringify(initiallyExpanded));
      }
      assert.equal(await evaluate("document.querySelectorAll('.meridian-taskbar-end [aria-label=\"Notificações\"]').length"),1,'Notification control remains reachable in the global dock');
      await openSidebarDestination('Notificações');
      await until("!!document.querySelector('.web-notifications [data-notification-center]')");
      assert.equal(await evaluate("document.querySelector('.web-notifications [data-notification-center]').dataset.availability"),'unavailable','Web cannot claim a connected account feed');
      assert.equal(await evaluate("[...document.querySelectorAll('.web-notifications button')].every(button => button.disabled)"),true,'Unavailable actions fail closed');
      assert.equal(await evaluate("document.querySelectorAll('.web-notifications [data-notification-id]').length"),0,'No fabricated events');
      assert.equal(await evaluate("[...document.querySelectorAll('.web-notifications button')].every(button => button.getClientRects().length === 0)"),true,'Unavailable feed must not display zero counters or inactive actions');

      const notificationScreenshot = await client.send('Page.captureScreenshot',{format:'png'});
      await writeFile(join(evidence,'notifications-'+width+'x'+height+'.png'),Buffer.from(notificationScreenshot.data,'base64'));

      assert.equal(await evaluate("(()=>{const node=document.querySelector('.web-notifications');return node.scrollWidth<=node.clientWidth+1;})()"),true,'Notification content fits narrow panes');
      await click('[aria-label="Compactar Notificações"]');
      assert.equal(await evaluate("document.querySelectorAll('.web-notifications [data-notification-center]').length"),1,'Compact mode keeps one notification view');
      await click('[aria-label="Fechar Notificações"]');

      assert.equal(await evaluate("!!document.querySelector('.home-footer,.home-mode-select')"),false,'Home footer and its mode selector are removed');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.workspace-sidebar')).overflowY"),'hidden','Sidebar does not scroll');
      const railGeometry=await evaluate("(()=>{const rail=document.querySelector('.workspace-sidebar');const box=rail.getBoundingClientRect();return {bottom:box.bottom,viewport:innerHeight,visible:!!rail.getClientRects().length,launcherVisible:!!document.querySelector('.meridian-launcher')?.getClientRects().length};})()");
      if(width<=600) assert.equal(railGeometry.visible===false&&railGeometry.launcherVisible,true,'Narrow screens use the global launcher instead of the rail');
      else assert.ok(Math.abs(railGeometry.bottom-railGeometry.viewport)<2,'Sidebar reaches viewport bottom: '+JSON.stringify(railGeometry));
      assert.equal(await evaluate("!!document.querySelector('.workspace-navigation [data-workspace-switch]') && !document.querySelector('.desktop-start-button')"),true,'View switch belongs to the dock; Start button is absent');
      await evaluate("(()=>{const n=document.querySelector('#meridian-prompt');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'Apenas demonstração');n.dispatchEvent(new Event('input',{bubbles:true}));})()");
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
      await evaluate("window.proofNavigation=document.querySelector('.workspace-navigation');window.proofToggle=document.querySelector('[data-workspace-switch]').getBoundingClientRect().left-document.querySelector('.workspace-navigation').getBoundingClientRect().left");
      await click('[data-workspace-switch]');
      assert.equal(await evaluate("window.proofNavigation===document.querySelector('.workspace-navigation')"),true,'Switch keeps the same navigation node');
      assert.equal(await evaluate("Math.abs(document.querySelector('[data-workspace-switch]').getBoundingClientRect().left-document.querySelector('.workspace-navigation').getBoundingClientRect().left-window.proofToggle)<2"),true,'Toggle stays at the dock edge in both views');
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
      if(publicHeaders){
        const violations=await evaluate('window.surfacePolicyViolations');
        await writeFile(join(evidence,'policy-'+width+'x'+height+'.json'),JSON.stringify(violations,null,2)+'\n');
        if(violations.length)await writeFile(join(evidence,'blocked-styles-'+width+'x'+height+'.json'),JSON.stringify(await evaluate("[...document.querySelectorAll('style')].map(node=>({attributes:[...node.attributes].map(attr=>[attr.name,attr.value]),css:node.textContent}))"),null,2)+'\n');
        assert.deepEqual(violations,[],'Web must satisfy the public policy without blocked resources');
      }
      results.push({width,height,primaryCentral:true,themePersistence:true,mobileNavigation:width<=760,desktopLifecycle:true,compactLifecycle:true,stableAppNode:true,promptUnconnected:true,noHorizontalOverflow:true,...(publicHeaders?{publicPolicy:true}:{})});
      console.log('SURFACE_VIEWPORT=PASS '+width+'x'+height);
    }
    return results;
  });
  await writeFile(join(evidence,'report.json'),JSON.stringify(reports,null,2)+'\n');
  console.log('SURFACE_BROWSER_SMOKE=PASS '+JSON.stringify(reports));
}finally{await new Promise(done=>server.close(done));}
