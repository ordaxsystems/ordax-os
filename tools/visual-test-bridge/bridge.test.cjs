'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {PNG}=require('pngjs');
const {VisualTestBridge,localUrl,safeText,comparePng,OPERATIONS}=require('./bridge.cjs');
test('bridge exposes one bounded command surface without an HTTP listener',()=>{
  assert.equal(OPERATIONS.size,14);
  assert.equal(OPERATIONS.has('terminal_exec'),false);
});
test('preview only accepts local HTTP without injected credentials',()=>{
  assert.equal(localUrl('http://127.0.0.1:4202/').port,'4202');
  for(const url of ['http://example.com','https://127.0.0.1/','http://user:pw@localhost/','file:///etc/passwd','http://192.168.0.1/'])
    assert.throws(()=>localUrl(url));
});
test('logs redact credentials and are bounded',()=>{
  const bridge=new VisualTestBridge();
  bridge.record('error','Bearer secret123 '+('a'.repeat(64))+' https://foo.test/abc?token=private');
  assert.doesNotMatch(JSON.stringify(bridge.getLogs()),/secret123|token=private|aaaaaaaaa/);
  for(let i=0;i<510;i++)bridge.record('event',String(i));
  assert.equal(bridge.getLogs().events.length,500);
});
test('unattested Electron launch is refused before process creation',async()=>{
  const bridge=new VisualTestBridge({playwright:{}});
  await assert.rejects(bridge.launch({mode:'electron-installed',executablePath:'C:\\Fake\\OrdaX OS Desktop Dev.exe'}));
  assert.equal(bridge.app,null);
});
test('reject invalid operation and missing active page',async()=>{
  const bridge=new VisualTestBridge();
  await assert.rejects(bridge.execute({op:'computer_terminal_exec'}),/Unknown/);
  await assert.rejects(bridge.execute({op:'inspect'}),/no launched test session/);
});
test('pixel comparison measures changed pixels and refuses mismatched dimensions',()=>{
  const image=(width,r,g)=>{const p=new PNG({width,height:2});for(let i=0;i<p.data.length;i+=4){
    p.data[i]=r;p.data[i+1]=g;p.data[i+2]=0;p.data[i+3]=255;
  }return PNG.sync.write(p);};
  const first=image(2,255,0),equal=image(2,252,0),different=image(2,0,255);
  assert.equal(comparePng(first,equal,{channelTolerance:4,maxMismatchRatio:0}).match,true);
  assert.equal(comparePng(first,different,{channelTolerance:4,maxMismatchRatio:0}).mismatchedPixels,4);
  assert.equal(comparePng(first,image(3,255,0)).reason,'dimensions');
});
test('failed launch never deletes pre-existing user profile',async()=>{
  const sentinel=mkdtempSync(join(tmpdir(),'ordax-unrelated-profile-'));
  try{
    const bridge=new VisualTestBridge({playwright:{}});
    await assert.rejects(bridge.launch({mode:'web',url:'https://example.com'}));
    assert.equal(require('node:fs').existsSync(sentinel),true);
  }finally{rmSync(sentinel,{force:true,recursive:true});}
});

test('installed Windows First Run uses its existing four-stage contract, never USB/network',()=>{
 const {assertCanonicalDesktopJourney}=require('./installed-journey.cjs');
 assert.equal(assertCanonicalDesktopJourney(['Início','Conta','Segurança','Revisão']),true);
 assert.throws(()=>assertCanonicalDesktopJourney(['Início','Rede','Conta','Segurança','Dispositivo','Revisão']),/PR #2343/);
 assert.throws(()=>assertCanonicalDesktopJourney(['Início','Conta','Revisão']),/non-canonical/);
});
