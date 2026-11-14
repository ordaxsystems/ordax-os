import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {
  createDesktopSurfaceRuntimeBridge,
  DESKTOP_PROJECT_LINKS_PATH,
} from "../system/adapters/desktop/surface-runtime-bridge.mjs";

const reportToken="a".repeat(64);
const runtimeToken="b".repeat(64);
const projectId="33333333-3333-4333-8333-333333333333";
const spaceId="44444444-4444-4444-8444-444444444444";

async function withBridge(run){
  let tick=1000;
  const bridge=createDesktopSurfaceRuntimeBridge({
    reportToken,runtimeToken,now:()=>tick,
  });
  const server=createServer((req,res)=>bridge.middleware(req,res,()=>{
    res.writeHead(404);res.end();
  }));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  try{return await run({base,advance:ms=>{tick+=ms}})}
  finally{await new Promise(resolve=>server.close(resolve))}
}
const post=(base,body,token=reportToken)=>fetch(base+DESKTOP_PROJECT_LINKS_PATH,{
  method:"POST",
  headers:{
    "content-type":"application/json",
    "x-ordax-surface-report-token":token,
  },
  body:JSON.stringify(body),
});
const read=(base,token=runtimeToken)=>fetch(base+DESKTOP_PROJECT_LINKS_PATH,{
  headers:{"x-ordax-product-bridge-token":token},
});
const durable=(overrides={})=>({
  schema:"ordax.desktop-project-links/1",
  persistence:"device",
  links:[{
    localProjectId:"project-7",
    cloudProjectId:projectId,
    spaceId,
  }],
  ...overrides,
});

test("Project links bridge exposes only authenticated durable explicit links",async()=>{
  await withBridge(async({base})=>{
    assert.equal((await read(base)).status,503);
    assert.equal((await read(base,reportToken)).status,401,
      "Surface grant cannot read Runtime projection");
    assert.equal((await post(base,durable(),runtimeToken)).status,401,
      "Product grant cannot publish local authority");
    assert.equal((await post(base,durable())).status,200);
    const response=await read(base);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{
      schema:"ordax.desktop-project-links/1",
      host:"ordax-desktop",
      persistence:"device",
      links:[{
        localProjectId:"project-7",
        cloudProjectId:projectId,
        spaceId,
      }],
    });
  });
});

test("session-backed Project links withdraw durable authority immediately",async()=>{
  await withBridge(async({base})=>{
    assert.equal((await post(base,durable())).status,200);
    assert.equal((await read(base)).status,200);
    const withdrawn={
      schema:"ordax.desktop-project-links/1",
      persistence:"session",
      links:[],
    };
    const result=await post(base,withdrawn);
    assert.equal(result.status,200);
    assert.equal((await result.json()).state,"withdrawn");
    assert.equal((await read(base)).status,503,
      "Runtime cannot retain a formerly durable link after storage degrades");
    assert.equal((await post(base,{...withdrawn,links:durable().links})).status,400,
      "Session links can only withdraw, never authorize");
  });
});

test("Project links bridge rejects inferred or ambiguous authority",async()=>{
  await withBridge(async({base})=>{
    const link=durable().links[0];
    for(const body of [
      {...durable(),repository_full_name:"ordaxsystems/ordax-os"},
      {...durable(),links:[{...link,path:"C:/model/supplied"}]},
      {...durable(),links:[{...link,localProjectId:"ordax-os"}]},
      {...durable(),links:[
        link,{...link,localProjectId:"project-8"},
      ]},
      {...durable(),links:[
        link,{...link,cloudProjectId:"55555555-5555-4555-8555-555555555555"},
      ]},
      {...durable(),links:Array.from({length:33},(_,i)=>({
        localProjectId:"project-"+(i+1),
        cloudProjectId:(i+1).toString(16).padStart(8,"0")+"-1111-4111-8111-111111111111",
        spaceId,
      }))},
    ]) {
      const result=await post(base,body);
      assert.equal(result.status,400,JSON.stringify(body));
    }
    assert.equal((await read(base)).status,503);
  });
});

test("Project link projection expires without a fresh Surface report",async()=>{
  await withBridge(async({base,advance})=>{
    assert.equal((await post(base,durable())).status,200);
    assert.equal((await read(base)).status,200);
    advance(15001);
    assert.equal((await read(base)).status,503);
  });
});

test("Project links endpoint is exact, loopback-only and read/write methods are bounded",async()=>{
  await withBridge(async({base})=>{
    assert.equal((await fetch(base+DESKTOP_PROJECT_LINKS_PATH+"?x=1",{
      headers:{"x-ordax-product-bridge-token":runtimeToken},
    })).status,403);
    assert.equal((await fetch(base+DESKTOP_PROJECT_LINKS_PATH,{
      method:"DELETE",
      headers:{"x-ordax-product-bridge-token":runtimeToken},
    })).status,405);
    const oversized="x".repeat(17*1024);
    assert.equal((await fetch(base+DESKTOP_PROJECT_LINKS_PATH,{
      method:"POST",
      headers:{
        "content-type":"application/json",
        "x-ordax-surface-report-token":reportToken,
      },
      body:oversized,
    })).status,413);
  });
});
