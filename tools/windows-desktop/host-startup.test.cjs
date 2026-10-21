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
