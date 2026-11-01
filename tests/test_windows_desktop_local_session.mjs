import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDesktopLocalSessionMiddleware } from "../system/adapters/desktop/local-session-host.mjs";
import { createDesktopFileSpaceMiddleware } from "../system/adapters/desktop/file-space-host.mjs";
import { createEmulatorNativeHost } from "../tools/windows-emulator/native-host.mjs";
import { createNativeLocalSession } from "../system/adapters/native/local-session.mjs";

const SESSION_TOKEN="a".repeat(64);
const FILE_TOKEN="b".repeat(64);
const route="/__ordax/native/local-session";

async function createHost(root,{account=false}={}){
  const local=createDesktopLocalSessionMiddleware(root,{token:SESSION_TOKEN});
  const files=createDesktopFileSpaceMiddleware(join(root,"Files"),{token:FILE_TOKEN,sessionLocked:local.readLocked});
  const emulator=createEmulatorNativeHost({
    stateDirectory:join(root,"native-state"),
    sessionLocked:local.readLocked,
    ...(account?{
      accountGatewayOrigin:"https://example.test/account",
      fetchImpl:async()=>Response.json({
        $schema:"prototype-ordax.public-identity-session/1",
        authenticated:false,status:"anonymous",provider:"supabase",
      }),
    }:{})
  });
  const server=createServer((req,res)=>local.middleware(req,res,()=>{
    files(req,res,()=>emulator(req,res,()=>{res.writeHead(404);res.end();}));
  }));
  await new Promise(done=>server.listen(0,"127.0.0.1",done));
  const origin="http://127.0.0.1:"+server.address().port;
  const fetchTrusted=(path,init={})=>fetch(origin+path,{
    ...init,
    headers:{
      "X-OrdaX-Local-Session-Token":SESSION_TOKEN,
      Origin:origin,
      ...init.headers,
    },
  });
  const fetchFiles=(path,init={})=>fetch(origin+path,{
    ...init,headers:{"X-OrdaX-File-Token":FILE_TOKEN,Origin:origin,...init.headers},
  });
  return {local,origin,fetchTrusted,fetchFiles,close:async()=>{
    server.closeAllConnections();await new Promise(done=>server.close(done));
  }};
}

test("Windows native local session is real, persistent, authenticated and does not store PIN",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ordax-session-host-"));
 let host=null;
 try{
  host=await createHost(dir,{account:true});
  assert.equal((await fetch(host.origin+route)).status,401);
  assert.equal((await host.fetchTrusted(route,{headers:{"X-OrdaX-Local-Session-Token":"1".repeat(64)}})).status,401);
  const windowRef={fetch:(path,options={})=>host.fetchTrusted(path,options)};
  const port=await createNativeLocalSession(windowRef);
  assert.equal(port.getSnapshot().state,"unlocked");
  assert.equal(port.getSnapshot().credentialConfigured,false);
  const secret="correct-test-pin-2026";
  assert.equal((await port.configureCredential(secret)).credentialConfigured,true);
  const record=await readFile(join(dir,"desktop-local-session.json"),"utf8");
  assert.doesNotMatch(record,/correct-test-pin-2026/);
  assert.match(record,/"verifier":"[0-9a-f]{64}"/);
  assert.equal((await port.lock()).state,"locked");
  assert.equal((await host.fetchTrusted("/auth/session")).status,423);
  assert.equal((await host.fetchFiles("/__ordax/native/files?path=%2F")).status,423);
  await host.close();host=null;
  host=await createHost(dir,{account:true});
  assert.equal((await (await host.fetchTrusted(route)).json()).state,"locked");
  assert.equal((await host.fetchTrusted("/auth/session")).status,423);
  let result=await host.fetchTrusted(route,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"unlock",secret:"invalid-pin"}),
  });
  assert.equal(result.status,401);
  assert.equal((await host.fetchTrusted(route,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"unlock",secret}),
  })).status,429);
  await new Promise(done=>setTimeout(done,1150));
  const portAfter=createNativeLocalSession({fetch:(path,options={})=>host.fetchTrusted(path,options)});
  const native=await portAfter;
  assert.equal((await native.unlock(secret)).state,"unlocked");
  assert.equal((await host.fetchTrusted("/auth/session")).status,200);
  assert.equal((await host.fetchFiles("/__ordax/native/files?path=%2F")).status,200);
  assert.equal((await native.removeCredential(secret)).credentialConfigured,false);
  assert.equal((await host.fetchTrusted(route)).status,200);
  assert.equal((await host.fetchTrusted(route,{
    method:"POST",headers:{"Content-Type":"application/json",Origin:"https://untrusted.test"},
    body:JSON.stringify({action:"configure-credential",secret}),
  })).status,403);
  assert.equal((await host.fetchTrusted(route,{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"lock"}),
  })).status,409);
 } finally {
  if(host)await host.close();
  await rm(dir,{recursive:true,force:true});
 }
});

test("Windows configured PIN is retained but every new Native host starts locked",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ordax-session-relock-"));
  let host=null;
  const secret="persistent-test-pin-2026";
  try{
    host=await createHost(dir,{account:true});
    const first=await createNativeLocalSession({
      fetch:(path,options={})=>host.fetchTrusted(path,options),
    });
    assert.equal((await first.configureCredential(secret)).state,"unlocked");
    const before=JSON.parse(await readFile(join(dir,"desktop-local-session.json"),"utf8"));
    assert.equal(before.state,"unlocked");
    assert.equal(typeof before.verifier,"string");
    await host.close();host=null;

    host=await createHost(dir,{account:true});
    const boot=await host.fetchTrusted(route);
    assert.equal(boot.status,200);
    assert.deepEqual(await boot.json(),{
      schema:"ordax.local-session/1",state:"locked",credentialConfigured:true,canLock:true,
      protectionScope:"surface-session-not-storage-encryption",
    });
    assert.equal((await host.fetchTrusted("/auth/session")).status,423);
    assert.equal((await host.fetchFiles("/__ordax/native/files?path=%2F")).status,423);
    const after=JSON.parse(await readFile(join(dir,"desktop-local-session.json"),"utf8"));
    assert.equal(after.state,"locked");
    assert.equal(after.salt,before.salt);
    assert.equal(after.verifier,before.verifier,"relock must never reset the existing PIN");

    const native=await createNativeLocalSession({
      fetch:(path,options={})=>host.fetchTrusted(path,options),
    });
    assert.equal((await native.unlock(secret)).state,"unlocked");
    assert.equal((await host.fetchTrusted("/auth/session")).status,200);
    await host.close();host=null;

    host=await createHost(dir,{account:true});
    assert.equal((await (await host.fetchTrusted(route)).json()).state,"locked",
      "a second fresh process must relock an otherwise unlocked protected session");
  }finally{if(host)await host.close();await rm(dir,{recursive:true,force:true});}
});

test("Windows local session rejects corrupt state without silently unlocking",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ordax-session-corrupt-"));
 let host=null;
 try{
  await writeFile(join(dir,"desktop-local-session.json"),"{corrupt","utf8");
  host=await createHost(dir);
  assert.equal((await host.fetchTrusted(route)).status,503);
  assert.equal((await host.fetchTrusted(route,{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"configure-credential",secret:"correct-test-pin"}),
  })).status,503);
  assert.equal((await host.fetchFiles("/__ordax/native/files?path=%2F")).status,503);
  assert.equal((await host.fetchTrusted("/auth/session")).status,503);
  const preserved=await readFile(join(dir,"desktop-local-session.json"),"utf8");
  assert.equal(preserved,"{corrupt");
 } finally {if(host)await host.close();await rm(dir,{recursive:true,force:true});}
});
