import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mountNativeDesktopSurfaceStateReport} from "../system/adapters/native/desktop-surface-state-report.mjs";
import {createDesktopSurfaceRuntimeBridge, DESKTOP_SURFACE_BRIDGE_PATH as ROUTE,
  DESKTOP_SURFACE_COMMAND_PATH as COMMAND, DESKTOP_SURFACE_RECEIPT_PATH as RECEIPT}
  from "../system/adapters/desktop/surface-runtime-bridge.mjs";

const reportToken = "a".repeat(64);
const runtimeToken = "b".repeat(64);
const observation = {
  schema: "ordax.desktop-surface-state/1",
  activeAppId: "system",
  surfaceReady: true,
};

async function withServer(run,options={}) {
  let tick = 10000;
  const bridge = createDesktopSurfaceRuntimeBridge({reportToken, runtimeToken,
    now:()=>tick,...options});
  const server = createServer((req,res)=>bridge.middleware(req,res,()=>{
    res.writeHead(404);res.end();
  }));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    return await run({
      url:"http://127.0.0.1:"+server.address().port+ROUTE,
      advance:ms=>{tick+=ms;},
    });
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
}

test("Surface and Runtime have independent per-launch grants with no token bypass",async()=>{
  await withServer(async({url})=>{
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{"x-ordax-surface-report-token":reportToken}})).status,401);
    assert.equal((await fetch(url+"?x=1",{headers:{"x-ordax-product-bridge-token":runtimeToken}})).status,403);
    assert.equal((await fetch(url,{method:"POST",headers:{
      "content-type":"application/json","x-ordax-product-bridge-token":runtimeToken,
    },body:JSON.stringify(observation)})).status,401);
    assert.equal((await fetch(url,{method:"DELETE"})).status,405);
    assert.equal((await fetch(url,{headers:{"x-ordax-product-bridge-token":runtimeToken}})).status,503);
  });
});
test("OS Native bridge delivers fresh real Surface presentation, never a fake MCP grant",async()=>{
  await withServer(async({url,advance})=>{
    const response=await fetch(url,{method:"POST",headers:{
      "content-type":"application/json",
      "x-ordax-surface-report-token":reportToken,
    },body:JSON.stringify(observation)});
    assert.equal(response.status,200);
    const read=await fetch(url,{headers:{"x-ordax-product-bridge-token":runtimeToken}});
    assert.equal(read.status,200);
    assert.deepEqual(await read.json(),{
      ...observation,host:"ordax-desktop",ageMs:0,
    });
    advance(15001);
    assert.equal((await fetch(url,{headers:{"x-ordax-product-bridge-token":runtimeToken}})).status,503);
  });
});
test("Host refuses untrusted payloads, excessive data and arbitrary Windows actions",async()=>{
  await withServer(async({url})=>{
    const opts=(body)=>({method:"POST",headers:{
      "content-type":"application/json",
      "x-ordax-surface-report-token":reportToken,
    },body:JSON.stringify(body)});
    for(const invalid of [
      {...observation,activeAppId:"../../Windows"},
      {...observation,activeAppId:"WIN32"},
      {...observation,activeAppId:"system",nativeCommand:"computer.click"},
      {...observation,surfaceReady:false},
      {...observation,host:"windows-agent"},
    ])assert.equal((await fetch(url,opts(invalid))).status,400);
    assert.equal((await fetch(url,{method:"POST",headers:{
      "content-type":"application/json",
      "x-ordax-surface-report-token":reportToken,
    },body:"x".repeat(600)})).status,413);
    assert.equal((await fetch(url,{headers:{"x-ordax-product-bridge-token":runtimeToken}})).status,503);
  });
});
test("Invalid and identical Native grants fail closed",()=>{
  for(const args of [
    {reportToken,runtimeToken:reportToken},
    {reportToken:"unsafe",runtimeToken},
    {reportToken,runtimeToken:"unsafe"},
  ])assert.throws(()=>createDesktopSurfaceRuntimeBridge(args));
});


test("authenticated Native Surface parked poll wakes immediately when a Product command arrives",async()=>{
  await withServer(async({url})=>{
    const base=url.slice(0,-ROUTE.length);
    const report=(activeAppId)=>fetch(url,{method:"POST",headers:{
      "content-type":"application/json","x-ordax-surface-report-token":reportToken,
    },body:JSON.stringify({...observation,activeAppId})});
    assert.equal((await report("system")).status,200);
    let returned=false;
    const waiting=fetch(base+COMMAND,{headers:{
      "x-ordax-surface-report-token":reportToken,
      "x-ordax-native-command-wait":"1",
    }}).then(result=>{returned=true;return result});
    await new Promise(resolve=>setTimeout(resolve,60));
    assert.equal(returned,false,"empty authenticated poll must remain parked");
    const requestedAt=Date.now();
    const command=fetch(base+COMMAND,{method:"POST",headers:{
      "content-type":"application/json","x-ordax-product-bridge-token":runtimeToken,
    },body:JSON.stringify({schema:"ordax.desktop-surface-command/1",appId:"settings"})});
    const response=await waiting;
    assert.equal(response.status,200);
    assert.ok(Date.now()-requestedAt<1200,
      "command must wake renderer without waiting for idle timeout");
    const delivered=await response.json();
    assert.equal(delivered.appId,"settings");
    assert.match(delivered.requestId,/^[a-f0-9]{32}$/);
    assert.equal((await report("settings")).status,200);
    const receipt=await fetch(base+RECEIPT,{method:"POST",headers:{
      "content-type":"application/json","x-ordax-surface-report-token":reportToken,
    },body:JSON.stringify({schema:"ordax.desktop-surface-command/1",
      requestId:delivered.requestId,state:"applied",activeAppId:"settings"})});
    assert.equal(receipt.status,200);
    assert.equal((await command).status,200,
      "a successful command still requires the canonical visible-app receipt");
  });
});

test("parked Native polls cannot bypass reporter grant or multiply listeners",async()=>{
  await withServer(async({url})=>{
    const command=url.slice(0,-ROUTE.length)+COMMAND;
    const wait={"x-ordax-native-command-wait":"1"};
    assert.equal((await fetch(command,{headers:wait})).status,401);
    assert.equal((await fetch(command,{headers:{
      ...wait,"x-ordax-product-bridge-token":runtimeToken,
    }})).status,401,"Product token cannot impersonate Surface");
    assert.equal((await fetch(command,{headers:{
      "x-ordax-surface-report-token":reportToken,
    }})).status,204,"legacy non-waiting client remains compatible");
    const controller=new AbortController();
    const waiting=fetch(command,{headers:{
      ...wait,"x-ordax-surface-report-token":reportToken,
    },signal:controller.signal});
    await new Promise(resolve=>setTimeout(resolve,60));
    assert.equal((await fetch(command,{headers:{
      ...wait,"x-ordax-surface-report-token":reportToken,
    }})).status,204,"only one renderer poll can park");
    controller.abort();
    await assert.rejects(waiting,{name:"AbortError"});
    // The host releases the old waiter after the client disconnects.
    await new Promise(resolve=>setTimeout(resolve,30));
    const started=Date.now();
    const next=await fetch(command,{headers:{
      ...wait,"x-ordax-surface-report-token":reportToken,
    }});
    assert.equal(next.status,204);
    assert.ok(Date.now()-started>=1300,
      "a new authenticated waiter should park rather than inherit stale state");
  });
});

test("Native command is confirmed by a visible Surface receipt",async()=>{
  await withServer(async({url})=>{
    const base=url.slice(0,-ROUTE.length);
    const write=(appId)=>fetch(url,{method:"POST",headers:{
      "Content-Type":"application/json","x-ordax-surface-report-token":reportToken},
      body:JSON.stringify({...observation,activeAppId:appId})});
    assert.equal((await write(null)).status,200);
    const run=fetch(base+COMMAND,{method:"POST",headers:{
      "Content-Type":"application/json","x-ordax-product-bridge-token":runtimeToken},
      body:JSON.stringify({schema:"ordax.desktop-surface-command/1",appId:"system"})});
    let cmd;
    for(let i=0;i<24;i++){
      const p=await fetch(base+COMMAND,{headers:{
        "x-ordax-surface-report-token":reportToken}});
      if(p.status===200){cmd=await p.json();break}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(cmd?.appId,"system");
    assert.match(cmd.requestId,/^[0-9a-f]{32}$/);
    const receipt=(activeAppId)=>fetch(base+RECEIPT,{method:"POST",
      headers:{"Content-Type":"application/json",
        "x-ordax-surface-report-token":reportToken},
      body:JSON.stringify({schema:"ordax.desktop-surface-command/1",
        requestId:cmd.requestId,state:"applied",activeAppId})});
    assert.equal((await receipt("system")).status,409);
    assert.equal((await write("system")).status,200);
    assert.equal((await receipt("system")).status,200);
    const done=await run;
    assert.equal(done.status,200);
    const result=await done.json();
    assert.equal(result.state,"applied");
    assert.equal(result.activeAppId,"system");
    assert.equal(result.requestId,cmd.requestId);
    assert.equal((await receipt("system")).status,409);
  });
});

test("Native write path rejects unauthorized origin, app and stale receipt",async()=>{
  await withServer(async({url})=>{
    const base=url.slice(0,-ROUTE.length);
    const body=(appId)=>JSON.stringify({
      schema:"ordax.desktop-surface-command/1",appId,
    });
    const request=(token,appId)=>fetch(base+COMMAND,{method:"POST",headers:{
      "Content-Type":"application/json",
      [token==="runtime"?"x-ordax-product-bridge-token":"x-ordax-surface-report-token"]:
        token==="runtime"?runtimeToken:reportToken,
    },body:body(appId)});
    assert.equal((await request("surface","system")).status,401);
    assert.equal((await request("runtime","files")).status,400);
    assert.equal((await request("runtime","other")).status,400);
    assert.equal((await request("runtime","SYSTEM")).status,400);
    assert.equal((await request("runtime","settings")).status,503,
      "an unreported Surface cannot be remotely navigated");
    assert.equal((await fetch(base+COMMAND)).status,401);
    assert.equal((await fetch(base+RECEIPT,{
      method:"POST",headers:{"Content-Type":"application/json",
        "x-ordax-product-bridge-token":runtimeToken},
      body:JSON.stringify({schema:"ordax.desktop-surface-command/1",
        requestId:"f".repeat(32),state:"applied",activeAppId:"system"}),
    })).status,401);
    assert.equal((await fetch(base+COMMAND+"?extra=1",{
      headers:{"x-ordax-surface-report-token":reportToken},
    })).status,403);
  });
});

test("Native unavailable acknowledgment never claims a successful activation",async()=>{
  await withServer(async({url})=>{
    const base=url.slice(0,-ROUTE.length);
    await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",
      "x-ordax-surface-report-token":reportToken},body:JSON.stringify(observation)});
    const run=fetch(base+COMMAND,{method:"POST",headers:{
      "Content-Type":"application/json","x-ordax-product-bridge-token":runtimeToken},
      body:JSON.stringify({schema:"ordax.desktop-surface-command/1",appId:"store"})});
    let cmd;
    for(let i=0;i<24;i++){
      const response=await fetch(base+COMMAND,{headers:{
        "x-ordax-surface-report-token":reportToken}});
      if(response.status===200){cmd=await response.json();break}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.ok(cmd);
    assert.equal((await fetch(base+RECEIPT,{method:"POST",headers:{
      "Content-Type":"application/json","x-ordax-surface-report-token":reportToken},
      body:JSON.stringify({schema:"ordax.desktop-surface-command/1",
        requestId:cmd.requestId,state:"unavailable",activeAppId:"system"}),
    })).status,200);
    assert.equal((await run).status,409);
  });
});

test("Only an authenticated renderer poll announces Native command readiness",async()=>{
  let observed=0;
  await withServer(async({url})=>{
    const target=url.slice(0,-ROUTE.length)+COMMAND;
    assert.equal((await fetch(target)).status,401);
    assert.equal(observed,0);
    for(let i=0;i<2;i++)
      assert.equal((await fetch(target,{headers:{
        "x-ordax-surface-report-token":reportToken,
      }})).status,204);
    assert.equal(observed,1);
  },{onFirstCommandPoll:()=>{observed++}});
});

test("Command receipt requires a newer Surface report even within the same millisecond",async()=>{
  await withServer(async({url})=>{
    const base=url.slice(0,-ROUTE.length);
    const publish=async()=>fetch(url,{method:"POST",
      headers:{"content-type":"application/json",
        "x-ordax-surface-report-token":reportToken},
      body:JSON.stringify(observation)});
    assert.equal((await publish()).status,200);
    const pending=fetch(base+COMMAND,{method:"POST",
      headers:{"content-type":"application/json",
        "x-ordax-product-bridge-token":runtimeToken},
      body:JSON.stringify({schema:"ordax.desktop-surface-command/1",appId:"system"})});
    let command=null;
    for(let i=0;i<35;i++){
      const result=await fetch(base+COMMAND,{headers:{
        "x-ordax-surface-report-token":reportToken,
      }});
      if(result.status===200){command=await result.json();break}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.ok(command,"Native runtime must queue a command");
    assert.equal((await fetch(url,{method:"POST",headers:{
      "content-type":"application/json",
      "x-ordax-product-bridge-token":runtimeToken,
    },body:JSON.stringify(observation)})).status,401,
      "Product token may not forge a Surface presentation report");
    assert.equal((await fetch(url,{method:"POST",headers:{
      "content-type":"application/json",
      "x-ordax-surface-report-token":reportToken,
    },body:JSON.stringify({...observation,surfaceReady:false})})).status,400,
      "Rejected renderer reports may not advance the receipt revision");
    const receipt=()=>fetch(base+RECEIPT,{method:"POST",
      headers:{"content-type":"application/json",
        "x-ordax-surface-report-token":reportToken},
      body:JSON.stringify({schema:"ordax.desktop-surface-command/1",
        requestId:command.requestId,state:"applied",activeAppId:"system"})});
    assert.equal((await receipt()).status,409,
      "Pre-command Surface report cannot authenticate a new activation");
    assert.equal((await publish()).status,200,
      "Surface publishes a newer observation with the same clock millisecond");
    assert.equal((await receipt()).status,200,
      "Only the newer observation may authorize the receipt");
    assert.equal((await pending).status,200);
  });
});

test("Product command crosses real loopback Host and Surface reporter with delayed rendering",async()=>{
  await withServer(async({url})=>{
    const base=url.slice(0,-ROUTE.length);
    let activeAppId="system",renderListener,poll,activationCount=0;
    // Electron supplies the renderer-only grant. The Product Runtime receives
    // a DIFFERENT token; it cannot impersonate the Surface reporter.
    const win={
      fetch(path,options={}){
        return fetch(base+path,{...options,headers:{
          ...options.headers,"x-ordax-surface-report-token":reportToken,
        }});
      },
      setInterval(callback,ms){if(ms===450)poll=callback;return ms;},
      clearInterval(){},
    };
        const lifecycle={getActiveAppId:()=>activeAppId,subscribeRender(callback){
      renderListener=callback;return ()=>{};
    }};
    const activation={publish({appId}){
      activationCount++;
      assert.equal(appId,"settings");
      // A Native system app may mount after appActivation returns.
      setTimeout(()=>{activeAppId=appId;renderListener();},60);
    }};
    const reporter=mountNativeDesktopSurfaceStateReport(
      win,lifecycle,activation);
    try{
      await new Promise(resolve=>setTimeout(resolve,25));
      const request=fetch(base+COMMAND,{method:"POST",
        headers:{"content-type":"application/json",
          "x-ordax-product-bridge-token":runtimeToken},
        body:JSON.stringify({schema:"ordax.desktop-surface-command/1",
          appId:"settings"})});
      for(let i=0;i<25;i++){
        poll();
        await new Promise(resolve=>setTimeout(resolve,30));
      }
      const result=await request;
      assert.equal(result.status,200);
      const receipt=await result.json();
      assert.equal(receipt.state,"applied");
      assert.equal(receipt.appId,"settings");
      assert.equal(receipt.activeAppId,"settings");
      assert.equal(activationCount,1,
        "The Runtime cannot reopen a window during rendering or retries");
      const observed=await fetch(url,{headers:{
        "x-ordax-product-bridge-token":runtimeToken,
      }});
      assert.equal(observed.status,200);
      assert.equal((await observed.json()).activeAppId,"settings");
      assert.equal((await fetch(url,{headers:{
        "x-ordax-surface-report-token":reportToken,
      }})).status,401,
        "Surface credential cannot read the Product Runtime observation");
    }finally{reporter.dispose()}
  });
});

test("Native unavailable app times out without inventing a receipt or replaying activation",async()=>{
  await withServer(async({url})=>{
    const base=url.slice(0,-ROUTE.length);
    let polls=0,activationCount=0,poll;
    const win={
      fetch(path,opts={}){return fetch(base+path,{...opts,
        headers:{...opts.headers,"x-ordax-surface-report-token":reportToken}})},
      setInterval(fn,ms){if(ms===450)poll=fn;return ms;},
      clearInterval(){},
    };
    const reporter=mountNativeDesktopSurfaceStateReport(win,
      {getActiveAppId:()=>"system",subscribeRender:()=>()=>{}},
      {publish(){activationCount++}});
    let timer=null;
    try{
      await new Promise(resolve=>setTimeout(resolve,25));
      const resultPromise=fetch(base+COMMAND,{method:"POST",
        headers:{"content-type":"application/json",
          "x-ordax-product-bridge-token":runtimeToken},
        body:JSON.stringify({schema:"ordax.desktop-surface-command/1",
          appId:"store"})});
      timer=setInterval(()=>{polls++;poll()},40);
      const result=await resultPromise;
      assert.equal(result.status,504,
        "Unconfirmed Native app activation expires under the Host deadline");
      const body=await result.json();
      assert.equal(body.error,"Surface did not confirm Native activation");
      assert.equal(activationCount,1,
        "Repeated command polling cannot reopen an unavailable app");
      assert.ok(polls>3);
      const after=await fetch(base+COMMAND,{
        headers:{"x-ordax-surface-report-token":reportToken},
      });
      assert.equal(after.status,204,
        "Native Host must clear expired command without pretending success");
    }finally{
      if(timer!==null)clearInterval(timer);
      reporter.dispose();
    }
  });
});