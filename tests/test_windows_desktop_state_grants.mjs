import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp,readFile,writeFile,rm,readdir,lstat,symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEmulatorNativeHost } from "../tools/windows-emulator/native-host.mjs";
import { createNativePreferenceStore } from "../system/adapters/native/preferences.mjs";
import { createNativeFirstRunStateStore } from "../system/adapters/native/first-run-state.mjs";
import { createInitialFirstRunState } from "../system/contracts/first-run-state-store.mjs";

const GRANT="d".repeat(64);
const STATE_ROUTES=[
  "/__ordax/native/first-run",
  "/__ordax/native/preferences",
  "/__ordax/native/first-run-cursor",
];

async function startHost(dir,{stateToken=GRANT,sessionLocked=()=>false,allowEmulatorReset=false}={}){
  const middleware=createEmulatorNativeHost({
    stateDirectory:dir,stateToken,sessionLocked,allowEmulatorReset,
  });
  const server=createServer((req,res)=>middleware(req,res,()=>{
    res.writeHead(404);res.end();
  }));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+server.address().port;
  const direct=(path,options={})=>fetch(origin+path,{
    ...options,headers:{Origin:origin,...options.headers},
  });
  const trusted=(path,options={})=>direct(path,{
    ...options,headers:{"X-OrdaX-Desktop-State-Token":GRANT,...options.headers},
  });
  return {trusted,direct,origin,close:async()=>{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }};
}

test("Windows Desktop first-run and preferences require Electron-only state grant, persist after restart",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ordax-native-state-auth-"));
  let h;let locked=false;
  try{
    h=await startHost(dir,{sessionLocked:()=>locked});
    for(const path of STATE_ROUTES){
      assert.equal((await h.direct(path)).status,401,path);
      assert.equal((await h.direct(path,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).status,401,path);
      assert.equal((await h.direct(path,{headers:{"X-OrdaX-Desktop-State-Token":"e".repeat(64)}})).status,401,path);
      assert.equal((await h.trusted(path+"?inject=1")).status,400,path);
      assert.equal((await h.trusted(path)).status,200,path);
    }
    assert.equal((await h.direct("/__ordax/emulator/reset-first-run",{
      method:"POST",
    })).status,404);
    const client={fetch:(path,options={})=>h.trusted(path,options)};
    const prefs=await createNativePreferenceStore(client);
    const firstRun=await createNativeFirstRunStateStore(client);
    assert.equal(firstRun.load().completed,false);
    // An old predictable temp pathname must never be reused or overwritten.
    const legacyTemp=join(dir,"native-state.json.tmp");
    await writeFile(legacyTemp,"keep-existing-untrusted-temp","utf8");
    assert.equal(await prefs.save({"regional.locale":"pt-BR","regional.time-zone":"America/Bahia"}),true);
    assert.equal(await readFile(legacyTemp,"utf8"),"keep-existing-untrusted-temp");
    assert.deepEqual((await readdir(dir)).filter(name=>name.startsWith(".native-state.json.")),[]);
    const savedInfo=await lstat(join(dir,"native-state.json"));
    assert.equal(savedInfo.isFile(),true);
    if(process.platform!=="win32")assert.equal(savedInfo.mode & 0o777,0o600);
    assert.equal((await createNativePreferenceStore(client)).load()["regional.locale"],"pt-BR");
    const before=await readFile(join(dir,"native-state.json"),"utf8");
    locked=true;
    for(const path of STATE_ROUTES){
      // Authorized bootstrap reads must continue to mount the unlock UI.
      assert.equal((await h.trusted(path)).status,200,path);
      assert.equal((await h.direct(path)).status,401,path);
      assert.equal((await h.trusted(path,{method:"POST",
        headers:{"Content-Type":"application/json"},body:"{}",
      })).status,423,path);
    }
    assert.equal(await readFile(join(dir,"native-state.json"),"utf8"),before);
    await h.close();h=null;
    h=await startHost(dir,{sessionLocked:()=>locked});
    assert.equal((await h.trusted("/__ordax/native/preferences")).status,200);
    assert.equal((await h.direct("/__ordax/native/preferences")).status,401);
    locked=false;
    assert.equal((await (await h.trusted("/__ordax/native/preferences")).json())["regional.locale"],"pt-BR");
    assert.equal((await h.trusted("/__ordax/native/preferences",{method:"POST",
      headers:{"Content-Type":"application/json",Origin:"https://attacker.invalid"},
      body:"{}",
    })).status,403);
    assert.equal((await h.direct("/__ordax/native/preferences")).status,401);
    await writeFile(join(dir,"native-state.json"),"{bad","utf8");
    assert.equal((await h.trusted("/__ordax/native/preferences")).status,503);
    assert.equal(await readFile(join(dir,"native-state.json"),"utf8"),"{bad");
  }finally{if(h)await h.close();await rm(dir,{recursive:true,force:true});}
});

test("Desktop state denies linked receipts without modifying the link target",async t=>{
  // Windows developer mode is not guaranteed to permit unprivileged symlinks.
  if(process.platform==="win32"){t.skip("symlink creation requires Windows developer privileges");return;}
  const dir=await mkdtemp(join(tmpdir(),"ordax-native-state-linked-"));
  let h;
  try{
    const outside=join(dir,"unrelated.json");
    await writeFile(outside,"preserve-external-file","utf8");
    await symlink(outside,join(dir,"native-state.json"));
    h=await startHost(dir);
    assert.equal((await h.trusted("/__ordax/native/first-run")).status,503);
    assert.equal((await h.trusted("/__ordax/native/first-run",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(createInitialFirstRunState()),
    })).status,503);
    assert.equal(await readFile(outside,"utf8"),"preserve-external-file");
    assert.deepEqual((await readdir(dir)).filter(name=>name.startsWith(".native-state.json.")),[]);
  }finally{if(h)await h.close();await rm(dir,{recursive:true,force:true});}
});

test("visual emulator retains its existing no-token state port while installed mode fails on weak token",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ordax-native-state-emulator-"));
  let h;
  try{
    assert.throws(()=>createEmulatorNativeHost({stateDirectory:dir,stateToken:"weak"}),TypeError);
    h=await startHost(dir,{stateToken:null,allowEmulatorReset:true});
    assert.equal((await h.direct("/__ordax/native/first-run")).status,200);
    assert.equal((await h.direct("/__ordax/emulator/reset-first-run",{method:"POST"})).status,200);
  }finally{if(h)await h.close();await rm(dir,{recursive:true,force:true});}
});
