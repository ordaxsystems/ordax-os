import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import policy from '../system/adapters/desktop/observation-grant.cjs';

const { OBSERVATION_ROUTES, createDesktopObservationGrantMiddleware }=policy;
const GRANT='a'.repeat(64);

async function createHost(){
  const calls=[];
  const middleware=createDesktopObservationGrantMiddleware({token:GRANT});
  const server=createServer((req,res)=>middleware(req,res,()=>{
    calls.push({method:req.method,url:req.url});
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({from:'canonical-OS-provider'}));
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  return{
    calls,
    fetch:(path,options={})=>fetch(base+path,options),
    close:async()=>{
      server.closeAllConnections();
      await new Promise(resolve=>server.close(resolve));
    },
  };
}

test('every canonical Desktop observation path is private; only Electron-granted GET reaches provider',async()=>{
  const host=await createHost();
  try{
    assert.equal(OBSERVATION_ROUTES.length,7);
    assert.equal(new Set(OBSERVATION_ROUTES).size,7);
    assert.ok(OBSERVATION_ROUTES.includes('/__ordax/native/product-runtime-status'));
    // The MCP lifecycle status is observation-only: the same grant and
    // read-only boundary must apply to all existing providers and this one.
    for(const path of OBSERVATION_ROUTES){
      assert.equal((await host.fetch(path)).status,401,path);
      assert.equal((await host.fetch(path,{headers:{'X-OrdaX-Observation-Token':'b'.repeat(64)}})).status,401,path);
      assert.equal((await host.fetch(path,{headers:{'X-OrdaX-Observation-Token':'wrong'}})).status,401,path);
      const header={'X-OrdaX-Observation-Token':GRANT};
      assert.equal((await host.fetch(path+'?secret=leak',{headers:header})).status,400,path);
      assert.equal((await host.fetch(path,{method:'POST',headers:header,body:'{}'})).status,405,path);
      const response=await host.fetch(path,{headers:header});
      assert.equal(response.status,200,path);
      assert.deepEqual(await response.json(),{from:'canonical-OS-provider'});
    }
    assert.equal(host.calls.length,OBSERVATION_ROUTES.length);
    assert.deepEqual(host.calls.map(v=>v.url),OBSERVATION_ROUTES);
  }finally{await host.close();}
});
test('observation middleware delegates other routes to their independent guards',async()=>{
  const host=await createHost();
  try{
    for(const path of ['/__ordax/native/files','/__ordax/native/local-session',
      '/__ordax/native/device-profile','/__ordax/native/network-management',
      '/auth/session']){
      const response=await host.fetch(path,{headers:{'X-OrdaX-Observation-Token':GRANT}});
      assert.equal(response.status,200);
      assert.equal((await response.json()).from,'canonical-OS-provider');
    }
  }finally{await host.close();}
});
test('packaged Electron reads the canonical observation policy from runtime-template, not app.asar parent',()=>{
  const source=readFileSync(new URL('../tools/windows-desktop/main.cjs',import.meta.url),'utf8');
  const pack=JSON.parse(readFileSync(new URL('../tools/windows-desktop/package.json',import.meta.url),'utf8'));
  assert.ok(pack.build.extraResources.some(item=>
    item.from==='../../system' && item.to==='runtime-template/system'));
  assert.match(source,/resolveTemplate\(__dirname,process\.resourcesPath,app\.isPackaged\)/);
  assert.match(source,/require\(join\(template,'system','adapters'/);
  assert.doesNotMatch(source,/require\(['"]\.\.\/\.\.\/system\/adapters\/desktop\/observation-grant\.cjs/);
});

test('observation grants reject malformed or missing token at host creation',()=>{
  for(const token of [null,'weak','z'.repeat(64),'a'.repeat(63)]){
    assert.throws(()=>createDesktopObservationGrantMiddleware({token}),TypeError);
  }
});
