'use strict';
// Adapter integration fixture: proves the bridge, NOT the real OrdaX Surface.
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {mkdtempSync,existsSync,rmSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const {VisualTestBridge,comparePng}=require('./bridge.cjs');
test('real headless Chromium supports semantic interaction, inspection, trace and evidence',async t=>{
  const server=http.createServer((req,res)=>{
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end('<!doctype html><html><body><div id="ordax-boot-screen" data-state="ready"></div><div id="ordax-root"><button aria-label="Ajustes">Ajustes</button><input aria-label="Pesquisa"/><p id="result"></p></div><script>document.querySelector("button").onclick=()=>document.querySelector("#result").textContent="aberto";</script></body></html>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const root=mkdtempSync(join(tmpdir(),'ordax-bridge-adapter-evidence-'));
  const artifacts=resolve('out/visual-test-bridge/browser-adapter');
  const bridge=new VisualTestBridge({artifactsDir:artifacts});
  t.after(async()=>{await bridge.close();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+server.address().port+'/system/composition/native/index.html';
  assert.equal((await bridge.launch({mode:'web',url})).mode,'web');
  assert.equal((await bridge.listWindows()).length,1);
  assert.equal((await bridge.inspect({target:{role:'button',name:'Ajustes'}})).visible,true);
  const before=await bridge.currentPage().screenshot({animations:'disabled'});
  await bridge.screenshot({name:'web-initial'});
  await bridge.click({target:{role:'button',name:'Ajustes'}});
  const after=await bridge.currentPage().screenshot({animations:'disabled'});
  const comparison=await bridge.compareVisual({name:'state-diff',referenceCapture:'web-initial',
    channelTolerance:0,maxMismatchRatio:0});
  assert.equal(comparison.match,false);
  assert.ok(comparison.mismatchedPixels>0);
  assert.equal(existsSync(comparison.diffFile),true);
  assert.equal((await bridge.compareVisual({name:'unknown',referenceCapture:'not-captured'})).reason,'capture-missing');
  assert.equal(comparePng(before,after,{channelTolerance:0,maxMismatchRatio:0}).match,false);
  assert.equal((await bridge.inspect({target:{css:'#result'}})).text,'aberto');
  await bridge.type({target:{role:'textbox',name:'Pesquisa'},text:'OrdaX'});
  assert.match((await bridge.getAccessibilityTree()).ariaSnapshot,/Pesquisa/);
  assert.equal((await bridge.runE2E()).passed,true);
  assert.equal((await bridge.compareVisual({name:'missing-baseline'})).reason,'baseline-missing');
  assert.equal((await bridge.scanLayout()).interactiveElements,2);
  await bridge.currentPage().evaluate(()=>{
    const a=document.createElement('button'),b=document.createElement('button');
    for(const [node,label] of [[a,'Probe A'],[b,'Probe B']]){
      node.textContent=label;node.style.cssText='position:fixed;top:100px;left:100px;width:110px;height:60px;z-index:1000';
      document.body.append(node);
    }
  });
  const overlap=await bridge.scanLayout();
  assert.ok(overlap.overlappingHitTargets.some(pair=>pair.a==='Probe A'&&pair.b==='Probe B'));
  await bridge.currentPage().evaluate(()=>{setTimeout(()=>{throw Error('ORDAX_VISUAL_EXPECTED_RENDERER_EXCEPTION');},0);});
  await bridge.currentPage().waitForTimeout(100);
  assert.ok(bridge.getLogs().events.some(x=>x.kind==='pageerror'&&x.detail.includes('ORDAX_VISUAL_EXPECTED_RENDERER_EXCEPTION')));
  const evidence=await bridge.collectArtifacts();
  assert.equal(existsSync(evidence.diagnostics),true);
  assert.equal(evidence.artifacts.some(a=>a.endsWith('trace.zip')),true);
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
});
