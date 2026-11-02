'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {PNG}=require('pngjs');
const {VisualTestBridge,localUrl,safeText,comparePng,OPERATIONS,isolatedElectronEnv}=require('./bridge.cjs');
test('bridge exposes one bounded command surface without an HTTP listener',()=>{
  assert.equal(OPERATIONS.size,15);
  assert.equal(OPERATIONS.has('terminal_exec'),false);
  assert.equal(OPERATIONS.has('select_window'),true);
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
  assert.doesNotMatch(safeText('wss://private.example.net/socket'),/private.example.net/);
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

test('isolated Electron spawn never inherits MCP, GitHub, Groq or CI secrets',()=>{
  const src={PATH:'C:\\Windows\\System32',SystemRoot:'C:\\Windows',TEMP:'C:\\Temp',
    GH_TOKEN:'secret-github',GROQ_API_KEY:'secret-groq',
    ORDAX_PLATFORM_TOKEN:'secret-platform',OPENAI_API_KEY:'secret-openai',
    ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--require malicious.js',
    ORDAX_DESKTOP_LOCAL_DEV:'1'};
  const profileDir=require('node:path').resolve('out','visual-test-profile');
  const env=isolatedElectronEnv(src,{profileDir});
  assert.equal(env.PATH,src.PATH);
  assert.equal(env.SystemRoot,src.SystemRoot);
  assert.equal(env.ORDAX_DESKTOP_TEST_PROFILE,'1');
  assert.equal(env.ORDAX_DESKTOP_TEST_PROFILE_DIR,profileDir);
  assert.equal(Object.prototype.hasOwnProperty.call(env,'GH_TOKEN'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(env,'GROQ_API_KEY'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(env,'ORDAX_PLATFORM_TOKEN'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(env,'OPENAI_API_KEY'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(env,'NODE_OPTIONS'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(env,'ELECTRON_RUN_AS_NODE'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(env,'ORDAX_DESKTOP_LOCAL_DEV'),false);
  assert.equal(isolatedElectronEnv(src,{profileDir,development:true}).ORDAX_DESKTOP_LOCAL_DEV,'1');
});
