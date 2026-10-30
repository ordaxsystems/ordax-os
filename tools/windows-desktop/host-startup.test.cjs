'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {isReady,freePort}=require('./host.cjs');

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
