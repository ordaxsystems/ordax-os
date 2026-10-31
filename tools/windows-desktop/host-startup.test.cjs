'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {isReady,freePort,startHost}=require('./host.cjs');
const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=require('node:fs');
const {join}=require('node:path');
const {tmpdir}=require('node:os');

test('cold Native HTTP probe waits for delayed but valid response rather than canceling after 1.2 seconds',async t=>{
  const server=http.createServer((request,response)=>{
    assert.equal(request.url,'/system/composition/native/index.html');
    setTimeout(()=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<main>OrdaX</main>');},1650);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const started=Date.now();
  const result=await isReady(server.address().port);
  assert.equal(result,true);
  assert.ok(Date.now()-started>=1500);
});
test('Native HTTP probe refuses an unbound local port without fabricating readiness',async()=>{
  const port=await freePort();
  assert.equal(await isReady(port),false);
});

test('installed Native boot refuses unrelated HTTP 200 and forged readiness proofs',async t=>{
  const foreign=http.createServer((request,response)=>{
    if(request.url==='/__ordax/desktop-host-ready'){
      response.writeHead(200,{'X-Ordax-Desktop-Ready-Proof':'f'.repeat(64)});
      return response.end();
    }
    response.writeHead(200,{'Content-Type':'text/html'});
    response.end('<main>Unrelated local web server</main>');
  });
  await new Promise(resolve=>foreign.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>foreign.close(resolve)));
  const port=foreign.address().port;
  assert.equal(await isReady(port),true,'Vite legacy probe is unchanged');
  assert.equal(await isReady(port,'a'.repeat(64)),false,'installed host must reject a spoofed 200');
  assert.equal(await isReady(port,'invalid'),false,'malformed grant cannot authenticate');
});

test('installed Native readiness fails closed when peer returns plain HTML without a proof',async t=>{
  const server=http.createServer((request,response)=>{
    response.writeHead(200,{'Content-Type':'text/html'});
    response.end('<title>Not OrdaX</title>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  assert.equal(await isReady(server.address().port,'b'.repeat(64)),false);
});

test('signaled Native child fails startup immediately instead of waiting for readiness deadline',async t=>{
  // The child intentionally never binds the reserved port. On POSIX,
  // exitCode remains null while signalCode records SIGTERM.
  const root=mkdtempSync(join(tmpdir(),'ordax-native-early-exit-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const target=join(root,'tools','windows-emulator');
  mkdirSync(target,{recursive:true});
  writeFileSync(join(target,'desktop-native-server.mjs'),
    'process.kill(process.pid, "SIGTERM");\n','utf8');
  const tokens=['a','b','c','d','e','f','1','2','3','4'].map(x=>x.repeat(64));
  const started=Date.now();
  await assert.rejects(startHost({
    root,template:root,stateDirectory:root,userData:root,log:()=>{},
    builtAssetsRoot:root,
    fileToken:tokens[0],localSessionToken:tokens[1],
    nativeSessionToken:tokens[2],diagnosticToken:tokens[3],
    deviceProfileToken:tokens[4],stateToken:tokens[5],
    networkToken:tokens[6],observationToken:tokens[7],
    displayToken:tokens[8],localAiToken:tokens[9],
  }),/Canonical Native server exited before HTTP readiness: (SIGTERM|1|143)/);
  assert.ok(Date.now()-started<10000,'dead Native child must not burn 45-second startup deadline');
});
