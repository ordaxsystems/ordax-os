import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDesktopClientDiagnosticsMiddleware,
} from "../system/adapters/desktop/client-diagnostics-host.mjs";
import {
  createNativeClientDiagnostics, renderedSourceSha,
} from "../system/adapters/native/client-diagnostics.mjs";

const SOURCE="a".repeat(40);
const SESSION="b".repeat(64);
const REPORT="c".repeat(64);
const prefix=join(tmpdir(),"ordax-windows-diagnostic-");

async function start(root) {
  const native=createDesktopClientDiagnosticsMiddleware(root,{
    sessionToken:SESSION,diagnosticToken:REPORT,sourceSha:SOURCE,
  });
  const server=createServer((req,res)=>native.middleware(req,res,()=>{
    res.writeHead(404);res.end();
  }));
  await new Promise(done=>server.listen(0,"127.0.0.1",done));
  const origin="http://127.0.0.1:"+server.address().port;
  const request=(path,init={})=>fetch(origin+path,init);
  const windowRef={
    location:{href:origin+"/system/composition/native/index.html?source="+SOURCE},
    fetch:(path,init={})=>request(path,{
      ...init,
      headers:{
        ...init.headers,
        ...(path==="/__ordax/native/session"?{"X-OrdaX-Session-Token":SESSION}:{}),
        ...(init.method==="POST"?{Origin:origin}:{}),
      },
    }),
  };
  return {native,request,windowRef,origin,close:async()=>{
    server.closeAllConnections();await new Promise(done=>server.close(done));
  }};
}
test("real Windows diagnostic host shares canonical Native session and stores only sanitized reports",async()=>{
  const root=await mkdtemp(prefix);
  let host;
  try{
    host=await start(root);
    assert.equal((await host.request("/__ordax/native/session")).status,401);
    const bad=await host.request("/__ordax/native/session",{
      headers:{"X-OrdaX-Session-Token":"1".repeat(64)},
    });
    assert.equal(bad.status,401);
    const session=await (await host.windowRef.fetch("/__ordax/native/session")).json();
    assert.equal(session.diagnosticToken,REPORT);
    assert.equal(session.productMode,"desktop");
    assert.equal(session.token,undefined);
    assert.equal(session.networkToken,undefined);
    assert.equal(renderedSourceSha(host.windowRef),SOURCE);

    const client=await createNativeClientDiagnostics(host.windowRef);
    assert.equal(await client.report(SOURCE,"composition-bootstrap",new Error("PRIVATE_SECRET_DO_NOT_SAVE")),true);
    const data=await host.native.readLastReport();
    assert.equal(data.sourceSha,SOURCE);
    assert.equal(data.stage,"composition-bootstrap");
    assert.equal(data.errorName,"Error");
    assert.equal(typeof data.observedEpoch,"number");
    assert.doesNotMatch(JSON.stringify(data),/PRIVATE_SECRET_DO_NOT_SAVE/);
    assert.equal((await host.request("/__ordax/native/client-diagnostic",{
      method:"POST",headers:{"Content-Type":"application/json",Origin:host.origin},
      body:JSON.stringify({sourceSha:SOURCE,stage:"test",errorName:"Error",source:""}),
    })).status,403);
    assert.equal((await host.request("/__ordax/native/client-diagnostic",{
      method:"POST",headers:{"Content-Type":"application/json",Origin:host.origin,
        "X-OrdaX-Diagnostic-Token":REPORT},
      body:JSON.stringify({sourceSha:"f".repeat(40),stage:"test",errorName:"Error",source:""}),
    })).status,400);
    assert.equal((await host.request("/__ordax/native/client-diagnostic",{
      method:"POST",headers:{"Content-Type":"application/json",Origin:host.origin,
        "X-OrdaX-Diagnostic-Token":REPORT},
      body:JSON.stringify({sourceSha:SOURCE,stage:null,errorName:"Error",source:""}),
    })).status,400);
    assert.equal((await host.request("/__ordax/native/client-diagnostic",{
      method:"POST",headers:{"Content-Type":"application/json",Origin:"https://attacker.invalid",
        "X-OrdaX-Diagnostic-Token":REPORT},
      body:JSON.stringify({sourceSha:SOURCE,stage:"test",errorName:"Error",source:""}),
    })).status,403);
    const saved=(await readFile(join(root,"desktop-client-diagnostic.json"),"utf8"));
    assert.doesNotMatch(saved,/PRIVATE_SECRET_DO_NOT_SAVE|sessionToken|diagnosticToken/);
    await host.close();host=null;
    host=await start(root);
    assert.equal((await host.native.readLastReport()).sourceSha,SOURCE);
  }finally{if(host)await host.close();await rm(root,{recursive:true,force:true});}
});
test("desktop diagnostics refuses corrupted journal without resetting it",async()=>{
  const root=await mkdtemp(prefix);
  let host;
  try {
    await writeFile(join(root,"desktop-client-diagnostic.json"),"corrupt","utf8");
    host=await start(root);
    const response=await host.request("/__ordax/native/client-diagnostic",{
      method:"POST",headers:{"Content-Type":"application/json",Origin:host.origin,
        "X-OrdaX-Diagnostic-Token":REPORT},
      body:JSON.stringify({sourceSha:SOURCE,stage:"power-boot",errorName:"Error",source:""}),
    });
    assert.equal(response.status,503);
    assert.equal(await readFile(join(root,"desktop-client-diagnostic.json"),"utf8"),"corrupt");
  }finally{if(host)await host.close();await rm(root,{recursive:true,force:true});}
});
