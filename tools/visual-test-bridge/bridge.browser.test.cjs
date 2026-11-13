'use strict';
// Adapter integration fixture: proves the bridge, NOT the real OrdaX Surface.
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {mkdtempSync,mkdirSync,existsSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {VisualTestBridge,comparePng}=require('./bridge.cjs');
test('real headless Chromium supports semantic interaction, inspection, trace and evidence',async t=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/redirect'){
      res.writeHead(302,{location:'https://example.org/unauthorized'});
      res.end();
      return;
    }
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end('<!doctype html><html><body><div id="ordax-boot-screen" data-state="ready"></div><div id="ordax-root"><button aria-label="Ajustes">Ajustes</button><input aria-label="Pesquisa"/><p id="result"></p></div><script>document.querySelector("button").onclick=()=>document.querySelector("#result").textContent="aberto";</script></body></html>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const evidenceRoot=resolve('out/visual-test-bridge');
  mkdirSync(evidenceRoot,{recursive:true});
  // Each execution has append-only output; do not delete or overwrite a
  // previous screenshot, baseline, trace or debug receipt.
  const artifacts=mkdtempSync(join(evidenceRoot,'browser-adapter-'));
  const bridge=new VisualTestBridge({artifactsDir:artifacts});
  t.after(async()=>{await bridge.close();await new Promise(r=>server.close(r));});
  const url='http://127.0.0.1:'+server.address().port+'/system/composition/native/index.html';
  assert.equal((await bridge.launch({mode:'web',url})).mode,'web');
  assert.equal((await bridge.listWindows()).length,1);
  await bridge.currentPage().evaluate(()=>{
    fetch('https://example.org/blocked').catch(()=>{});
    const socket=new WebSocket('wss://example.org/blocked');
    socket.onerror=()=>{};
  });
  await bridge.currentPage().waitForTimeout(250);
  const denied=bridge.getLogs().events;
  assert.ok(denied.some(x=>x.kind==='network-blocked'&&x.detail.includes('off-origin')));
  assert.ok(denied.some(x=>x.kind==='websocket-blocked'&&x.detail.includes('off-origin')));
  assert.equal((await bridge.inspect({target:{role:'button',name:'Ajustes'}})).visible,true);
  const assertion=await bridge.execute({op:'assert',args:{
    target:{role:'button',name:'Ajustes'},visible:true,minWidth:1,minHeight:1
  }});
  assert.equal(assertion.passed,true);
  await assert.rejects(bridge.assertTarget({target:{css:'#missing'},timeoutMs:200}),
    /not mounted/);
  const scenario=await bridge.runE2E({scenario:'semantic-journey',steps:[
    {op:'assert',args:{target:{role:'button',name:'Ajustes'},visible:true}},
    {op:'inspect',args:{target:{css:'#ordax-root'}}}
  ]});
  assert.equal(scenario.passed,true);
  assert.equal(scenario.assertions.length,2);
  await assert.rejects(bridge.runE2E({scenario:'semantic-journey',steps:[
    {op:'inspect',args:{target:{css:'#missing'}}}
  ]}),/not mounted/);
  assert.equal(existsSync(join(artifacts,'e2e-failed-01.png')),true);
  await assert.rejects(bridge.runE2E({scenario:'semantic-journey',steps:[
    {op:'inspect',args:{target:{css:'#missing'}}}
  ]}),/not mounted/);
  assert.ok(existsSync(join(artifacts,'e2e-failed-01-02.png')));
  assert.ok(bridge.getLogs().events.some(x=>x.kind==='e2e-step-failed'));
  const before=await bridge.currentPage().screenshot({animations:'disabled'});
  const firstCapture=await bridge.screenshot({name:'web-initial'});
  await assert.rejects(bridge.screenshot({name:'web-initial'}),/already captured/);
  assert.equal(existsSync(firstCapture.file),true);
  await bridge.click({target:{role:'button',name:'Ajustes'}});
  const after=await bridge.currentPage().screenshot({animations:'disabled'});
  const comparison=await bridge.compareVisual({name:'state-diff',referenceCapture:'web-initial',
    channelTolerance:0,maxMismatchRatio:0});
  assert.equal(comparison.match,false);
  assert.ok(comparison.mismatchedPixels>0);
  assert.equal(existsSync(comparison.diffFile),true);
  const originalDiff=require('node:fs').readFileSync(comparison.diffFile);
  const secondDiff=await bridge.compareVisual({name:'state-diff',referenceCapture:'web-initial',
    channelTolerance:0,maxMismatchRatio:0});
  assert.equal(secondDiff.match,false);
  assert.notEqual(secondDiff.diffFile,comparison.diffFile);
  assert.equal(existsSync(secondDiff.diffFile),true);
  assert.equal(require('node:fs').readFileSync(comparison.diffFile).equals(originalDiff),true);
  assert.equal(require('node:fs').readFileSync(secondDiff.diffFile).equals(originalDiff),true);
  assert.equal((await bridge.compareVisual({name:'unknown',referenceCapture:'not-captured'})).reason,'capture-missing');
  assert.equal(comparePng(before,after,{channelTolerance:0,maxMismatchRatio:0}).match,false);
  assert.equal((await bridge.inspect({target:{css:'#result'}})).text,'aberto');
  await bridge.type({target:{role:'textbox',name:'Pesquisa'},text:'OrdaX'});
  assert.match((await bridge.getAccessibilityTree()).ariaSnapshot,/Pesquisa/);
  const firstSmoke=await bridge.runE2E();
  const secondSmoke=await bridge.runE2E();
  assert.equal(firstSmoke.passed,true);
  assert.equal(secondSmoke.passed,true);
  assert.notEqual(firstSmoke.visual.file,secondSmoke.visual.file);
  assert.ok(existsSync(firstSmoke.visual.file));
  assert.ok(existsSync(secondSmoke.visual.file));
  assert.equal((await bridge.compareVisual({name:'missing-baseline'})).reason,'baseline-missing');
  assert.equal((await bridge.scanLayout()).interactiveElements,2);
  const firstWindowId=(await bridge.listWindows())[0].id;
  await bridge.currentPage().evaluate(()=>{
    const button=document.createElement('button');
    button.setAttribute('aria-label','Open detail window');
    button.onclick=()=>window.open('/detail','_blank');
    document.body.append(button);
  });
  const childPromise=bridge.context.waitForEvent('page');
  await bridge.click({target:{role:'button',name:'Open detail window'}});
  const child=await childPromise;
  await child.waitForLoadState('domcontentloaded');
  const childWindow=(await bridge.listWindows()).find(w=>w.id!==firstWindowId);
  assert.ok(childWindow);
  assert.equal((await bridge.selectWindow({id:childWindow.id})).path,'/detail');
  assert.equal((await bridge.listWindows()).find(w=>w.id===childWindow.id).selected,true);
  assert.equal((await bridge.inspect({target:{css:'#ordax-root'}})).found,true);
  await assert.rejects(bridge.selectWindow({id:-1}),/numeric ID/);
  await assert.rejects(bridge.selectWindow({id:9999}),/not present/);
  await bridge.selectWindow({id:firstWindowId});
  assert.equal((await bridge.listWindows()).find(w=>w.id===firstWindowId).selected,true);
  await bridge.currentPage().evaluate(()=>{
    const a=document.createElement('button'),b=document.createElement('button');
    for(const [node,label] of [[a,'Probe A'],[b,'Probe B']]){
      node.textContent=label;node.style.cssText='position:fixed;top:100px;left:100px;width:110px;height:60px;z-index:1000';
      document.body.append(node);
    }
  });
  const overlap=await bridge.scanLayout();
  assert.ok(overlap.overlappingHitTargets.some(pair=>pair.a==='Probe A'&&pair.b==='Probe B'));
  await bridge.currentPage().evaluate(()=>{
    const shell=document.querySelector('#ordax-root');
    shell.inert=true;
    const dlg=document.createElement('section');
    dlg.setAttribute('role','dialog');
    dlg.setAttribute('aria-modal','true');
    dlg.style.cssText='position:fixed;inset:50px;background:white;z-index:9000;';
    const action=document.createElement('button');
    action.textContent='Dialog action';
    dlg.append(action);
    document.body.append(dlg);
  });
  const modalScan=await bridge.scanLayout();
  assert.equal(modalScan.activeModal,true);
  assert.ok(modalScan.excludedBackgroundTargets>=2);
  assert.equal(modalScan.overlappingHitTargets.some(
    pair=>pair.a==='Probe A'||pair.b==='Probe B'),false);
  assert.equal(modalScan.visibleHitTargets,1);
  // Stress the realistic case where modal controls are beyond the old
  // first-300 selection. The active dialog must still be inspected.
  await bridge.currentPage().evaluate(()=>{
    const shell=document.querySelector('#ordax-root');
    for(let i=0;i<320;i++){
      const button=document.createElement('button');
      button.dataset.visualBackgroundStress='1';
      button.textContent='Background control '+i;
      shell.append(button);
    }
  });
  const crowdedModal=await bridge.scanLayout();
  assert.ok(crowdedModal.interactiveElements>300);
  assert.equal(crowdedModal.scannedInteractiveElements,1);
  assert.equal(crowdedModal.unscannedInteractiveElements,0);
  assert.equal(crowdedModal.visibleHitTargets,1);
  assert.ok(crowdedModal.excludedBackgroundTargets>300);
  await bridge.currentPage().evaluate(()=>{
    document.querySelector('[role="dialog"][aria-modal="true"]').remove();
    document.querySelector('#ordax-root').inert=false;
  });
  const denseDesktop=await bridge.scanLayout();
  assert.equal(denseDesktop.scannedInteractiveElements,300);
  assert.ok(denseDesktop.unscannedInteractiveElements>0);
  assert.ok(denseDesktop.interactiveElements>300);
  await bridge.currentPage().evaluate(()=>{
    document.querySelectorAll('[data-visual-background-stress]').forEach(el=>el.remove());
  });
  await bridge.currentPage().evaluate(()=>{setTimeout(()=>{throw Error('ORDAX_VISUAL_EXPECTED_RENDERER_EXCEPTION');},0);});
  await bridge.currentPage().waitForTimeout(100);
  assert.ok(bridge.getLogs().events.some(x=>x.kind==='pageerror'&&x.detail.includes('ORDAX_VISUAL_EXPECTED_RENDERER_EXCEPTION')));
  const evidence=await bridge.collectArtifacts();
  assert.equal(existsSync(evidence.diagnostics),true);
  assert.equal(evidence.artifacts.some(a=>a.endsWith('trace.zip')),true);
  const firstDiagnostics=require('node:fs').readFileSync(evidence.diagnostics);
  const another=await bridge.collectArtifacts();
  assert.equal(another.diagnostics,join(artifacts,'diagnostics-v02.json'));
  assert.equal(require('node:fs').readFileSync(evidence.diagnostics).equals(firstDiagnostics),true);
  assert.equal(existsSync(another.diagnostics),true);
  await bridge.close();
  // The same bridge process can compare Web and Electron test renderings across
  // two isolated sessions without destroying the first reference or trace.
  await bridge.launch({mode:'web',url});
  const second=await bridge.compareVisual({name:'cross-session',referenceCapture:'web-initial',
    channelTolerance:4,maxMismatchRatio:0.01});
  assert.equal(second.match,true);
  const nextArtifacts=await bridge.collectArtifacts();
  assert.ok(nextArtifacts.artifacts.some(a=>a.endsWith('trace-02.zip')));
  assert.ok(nextArtifacts.diagnostics.endsWith('diagnostics-02.json'));
  await bridge.close();
  await assert.rejects(
    bridge.launch({mode:'web',url:'http://127.0.0.1:'+server.address().port+'/redirect'}),
    /ERR_FAILED|ERR_BLOCKED|net::|Navigation failed|aborted|Preview escaped/i
  );
});