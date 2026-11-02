'use strict';
// Adapter integration fixture: proves the bridge, NOT the real OrdaX Surface.
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {mkdtempSync,existsSync,rmSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const {VisualTestBridge}=require('./bridge.cjs');
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
  await bridge.click({target:{role:'button',name:'Ajustes'}});
  assert.equal((await bridge.inspect({target:{css:'#result'}})).text,'aberto');
  await bridge.type({target:{role:'textbox',name:'Pesquisa'},text:'OrdaX'});
  assert.match((await bridge.getAccessibilityTree()).ariaSnapshot,/Pesquisa/);
  assert.equal((await bridge.runE2E()).passed,true);
  assert.equal((await bridge.compareVisual({name:'missing-baseline'})).reason,'baseline-missing');
  assert.equal((await bridge.scanLayout()).interactiveElements,2);
  const evidence=await bridge.collectArtifacts();
  assert.equal(existsSync(evidence.diagnostics),true);
  assert.equal(evidence.artifacts.some(a=>a.endsWith('trace.zip')),true);
  await bridge.close();
});
