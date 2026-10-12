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
    response.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream'});
    response.end(await readFile(path));
  } catch {response.writeHead(404);response.end();}
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
    async function clickByText(selector,text){
      const marker=await evaluate("(()=>{const nodes=[...document.querySelectorAll("+JSON.stringify(selector)+")];const node=nodes.find(n=>n.getClientRects().length&&n.textContent.trim()==="+JSON.stringify(text)+");if(!node)throw Error('Missing text control');node.dataset.proofClick='current';return '[data-proof-click=current]';})()");
      await click(marker);
      await evaluate("document.querySelector('[data-proof-click=current]')?.removeAttribute('data-proof-click')");
    }
    await client.send('Page.navigate',{url:origin+'/'});await ready();
    const results=[];
    for(const [width,height] of [[1440,900],[1024,768],[820,650],[760,650],[390,844],[320,568],[844,390]]){
      await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await evaluate("localStorage.removeItem('ordax-view');localStorage.removeItem('ordax-theme')");
      await client.send('Page.navigate',{url:origin+'/'});await ready();
      await until("!!document.querySelector('.os-shell')");
      assert.equal(await evaluate("!document.querySelector('.web-workspace')"),true,'Previous page must not be mounted');
      assert.equal(await evaluate("document.querySelector('.brand-sub').textContent.includes('DEMONSTRAÇÃO')"),true);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'No horizontal document overflow');
      assert.equal(await evaluate("(()=>{const main=document.querySelector('.central-presentation .os-main');return main.scrollHeight<=main.clientHeight+1&&getComputedStyle(main).overflowY==='hidden';})()"),true,'Central fits the work area without page scrolling');
      assert.equal(await evaluate("document.querySelector('.home-overflow').getBoundingClientRect().bottom<=document.querySelector('.workspace-navigation').getBoundingClientRect().top+1"),true,'Overflow actions stay inside the available viewport');
      assert.equal(await evaluate("document.querySelectorAll('.quick-item').length"),4);
      const before=await evaluate("getComputedStyle(document.body).backgroundColor");
      await click('[aria-label="Ativar tema escuro"]');
      await until("document.documentElement.dataset.theme==='dark'");
      assert.notEqual(await evaluate('getComputedStyle(document.body).backgroundColor'),before);
      await client.send('Page.navigate',{url:origin+'/'});await ready();
      await until("document.documentElement.dataset.theme==='dark'");
      await click('[aria-label="Ativar tema claro"]');
      await until("document.documentElement.dataset.theme==='light'");
      assert.equal(await evaluate("document.querySelectorAll('.workspace-navigation').length"),1,'One navigation in both views');
      assert.equal(await evaluate("document.querySelectorAll('.workspace-sidebar').length"),1,'One shared sidebar');
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
      await click('[aria-label="Recolher painel Aura"]');
      assert.equal(await evaluate("document.querySelector('.window-workspace').dataset.compact"),'collapsed');
      await click('[aria-label="Expandir painel Aura"]');
      await click('[aria-label="Minimizar Aura"]');
      assert.equal(await evaluate('window.proofAura.hidden'),true);
      await click('[aria-label="Restaurar janela Aura"]');
      assert.equal(await evaluate("window.proofAura.querySelector('input').value"),'Apenas demonstração','Minimize keeps the draft');
      await click('[aria-label="Expandir janela Aura"]');
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
