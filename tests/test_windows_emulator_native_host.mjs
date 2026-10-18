import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,rm,writeFile,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createEmulatorNativeHost} from "../tools/windows-emulator/native-host.mjs";
import {createNativePreferenceStore} from "../system/adapters/native/preferences.mjs";
import {createNativeFirstRunStateStore} from "../system/adapters/native/first-run-state.mjs";
import {completeFirstRunState,createInitialFirstRunState} from "../system/services/state/first-run.mjs";

test("emulator development controls stay hidden unless explicitly requested",async()=>{
  const [html,main]=await Promise.all([
    readFile(new URL("../tools/windows-emulator/index.html",import.meta.url),"utf8"),
    readFile(new URL("../tools/windows-emulator/main.mjs",import.meta.url),"utf8"),
  ]);
  assert.match(html,/<details class="ordax-emulator-controls" data-emulator-controls hidden>/);
  assert.match(html,/body\[data-emulator-controls="visible"\] #ordax-emulator-surface \{grid-row:2;\}/);
  assert.doesNotMatch(html,/Emulador · sem kernel/);
  assert.match(main,/new URLSearchParams\(window\.location\.search\)\.get\("dev-controls"\) === "1"/);
  assert.match(main,/developmentControls\.hidden = !showDevelopmentControls/);
});

test("emulator persists through the real Native adapters and never grants hardware authority",async()=>{
  const prefix=join(tmpdir(),"ordax-emulator-host-");
  const directory=await mkdtemp(prefix);
  let middleware=createEmulatorNativeHost({stateDirectory:directory});
  const server=createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+server.address().port;
  const request=(path,options={})=>fetch(origin+path,{...options,headers:{Origin:origin,...options.headers}});
  const windowRef={fetch:request};
  try {
    const firstRun=await createNativeFirstRunStateStore(windowRef);
    assert.equal(firstRun.load().completed,false);
    const preferences=await createNativePreferenceStore(windowRef);
    assert.equal(await preferences.save({"regional.locale":"en-US","regional.time-zone":"America/Manaus"}),true);
    const receipt=completeFirstRunState({locale:"en-US",timeZone:"America/Manaus",accountMode:"local-only"});
    assert.equal(await firstRun.save(receipt),true);
    middleware=createEmulatorNativeHost({stateDirectory:directory});
    assert.deepEqual((await createNativeFirstRunStateStore(windowRef)).load(),receipt);
    assert.equal((await createNativePreferenceStore(windowRef)).load()["regional.time-zone"],"America/Manaus");
    const post=(path,body,headers={})=>request(path,{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)});
    assert.equal((await post("/__ordax/native/first-run",createInitialFirstRunState())).status,409);
    assert.equal((await post("/__ordax/native/preferences",{}, {Origin:"https://untrusted.example"})).status,403);
    assert.equal((await post("/__ordax/native/first-run",{password:"never-accepted"})).status,400);
    for(const path of ["network-management","power-actions","app-data","local-session","product-device"])
      assert.equal((await request("/__ordax/native/"+path)).status,503);
    assert.equal((await request("/__ordax/emulator/reset-first-run",{method:"POST"})).status,200);
    assert.equal((await createNativeFirstRunStateStore(windowRef)).load().completed,false);
    assert.equal((await createNativePreferenceStore(windowRef)).load()["regional.locale"],"en-US");
    await writeFile(join(directory,"native-state.json"),"{corrupt","utf8");
    assert.equal((await request("/__ordax/native/preferences")).status,503);
    assert.equal((await post("/__ordax/native/preferences",{})).status,503);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    assert.ok(directory.startsWith(prefix));
    await rm(directory,{recursive:true,force:true});
  }
});
