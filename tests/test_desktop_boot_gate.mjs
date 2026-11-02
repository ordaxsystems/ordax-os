import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createNativeFirstRunStateStore } from "../system/adapters/native/first-run-state.mjs";
import { createNativePreferenceStore } from "../system/adapters/native/preferences.mjs";
import { createNativeLocalSession } from "../system/adapters/native/local-session.mjs";
import { createInitialFirstRunState } from "../system/contracts/first-run-state-store.mjs";

test("Native shared Surface acknowledges health before optional apps, Store or Intelligence",()=>{
 const source=readFileSync(new URL("../system/composition/native/main.mjs", import.meta.url),"utf8");
 const mounted=source.indexOf("if (!firstRunPending) bootScreen.ready()");
 const recorded=source.indexOf('componentManager.setCurrentHealth("surface-shell", "healthy")');
 const health=source.indexOf("void updateWatcher.markHealthy()");
 const optional=source.indexOf("storeCatalogComposition = await storeCatalogCompositionPromise");
 const installed=source.indexOf("mountNativeVerifiedInstalledApps({", optional);
 assert.ok(mounted>=0 && recorded>mounted && health>recorded);
 assert.ok(optional>health && installed>optional);
 // Native shell health does not depend on optional Store/Intelligence or the
 // asynchronously resolved Device Profile, even when a First Run is pending.
 // The visible boot curtain must remain until that wizard is mounted.
 const wizard=source.indexOf("firstRun = mountFirstRunExperience(root, {");
 const deferred=source.indexOf("if (firstRunPending) bootScreen.ready()", wizard);
 assert.ok(wizard>health && deferred>wizard,
   "incomplete onboarding may hide the boot curtain only after its modal exists");
 assert.match(source,/if \(firstRunPending && windowsDesktopHost\) bootScreen.fail\(bootText\("surface.boot.failed"\)\)/,
   "failed Windows onboarding must not expose an unlocked desktop");
 assert.equal(source.split("bootScreen.ready()").length-1,3,
   "ready is owned only by completed boot, mounted First Run and USB recovery");
});

test("Installed Desktop bootstrap has one fail-closed deadline before Surface mount", () => {
  const source=readFileSync(new URL("../system/composition/native/main.mjs",import.meta.url),"utf8");
  const contract=JSON.parse(readFileSync(new URL("../docs/contracts/first-run.json",import.meta.url),"utf8"));
  assert.deepEqual(contract.windows_critical_bootstrap,{
    read_deadline_ms:15000,
    timeout_fails_closed_before_surface_mount:true,
    write_confirmations_are_not_cancelled:true,
  });
  const deadline=source.indexOf(`const desktopBootstrapSignal = windowsDesktopHost ? AbortSignal.timeout(${contract.windows_critical_bootstrap.read_deadline_ms}) : null`);
  const required=source.indexOf("const bootState = Promise.all([");
  const guarded=source.indexOf('Windows Native bootstrap timed out; Surface remains locked');
  const mount=source.indexOf("const surface = mountSurface(");
  assert.ok(deadline>0 && required>deadline && guarded>required && mount>guarded,
    "a stalled installed Desktop cannot mount Surface or claim health");
  assert.match(source,/createNativePreferenceStore\(window, \{\s*signal: desktopBootstrapSignal/s);
  assert.match(source,/requireDurableRead: windowsDesktopHost,\s*signal: desktopBootstrapSignal/s);
  assert.match(source,/createNativeLocalSession\(window, \{ signal: desktopBootstrapSignal \}\)/);
});

test("Windows initial Native reads abort consistently without fabricating a PIN or completed receipt",async()=>{
  const controller=new AbortController();
  const calls=[];
  const windowRef={fetch(path,init){
    calls.push({path,init});
    return new Promise((resolve,reject)=>{
      init.signal?.addEventListener("abort",()=>reject(init.signal.reason),{once:true});
    });
  }};
  const result=Promise.allSettled([
    createNativePreferenceStore(windowRef,{signal:controller.signal}),
    createNativeFirstRunStateStore(windowRef,{requireDurableRead:true,signal:controller.signal}),
    createNativeLocalSession(windowRef,{signal:controller.signal}),
  ]);
  assert.equal(calls.length,3);
  assert.deepEqual(calls.map(c=>c.init.method),["GET","GET","GET"]);
  assert.ok(calls.every(c=>c.init.signal===controller.signal));
  controller.abort(new Error("Installed Windows bootstrap deadline"));
  const [prefs,receipt,session]=await result;
  assert.equal(prefs.status,"fulfilled","optional preferences may retain in-memory state");
  assert.deepEqual(prefs.value.load(),{});
  assert.equal(receipt.status,"rejected","durable first-use receipt must not be forged");
  assert.match(receipt.reason.message,/could not be verified/);
  assert.equal(session.status,"rejected","locked-session authority must not be fabricated");
  assert.match(session.reason.message,/Installed Windows bootstrap deadline/);
});

test("Windows bootstrap deadline applies to GET only, never cancels durable POST receipts",async()=>{
  const controller=new AbortController();
  const calls=[];
  const firstRun=createInitialFirstRunState();
  const localSession={
    schema:"ordax.local-session/1",state:"unlocked",credentialConfigured:false,
    protectionScope:"surface-session-not-storage-encryption",
  };
  const windowRef={async fetch(path,init){
    calls.push({path,init});
    const data=path==="/__ordax/native/first-run"?firstRun:
      path==="/__ordax/native/local-session"?localSession:{};
    return {ok:true,json:async()=>data};
  }};
  const [prefs,receipt,session]=await Promise.all([
    createNativePreferenceStore(windowRef,{signal:controller.signal}),
    createNativeFirstRunStateStore(windowRef,{requireDurableRead:true,signal:controller.signal}),
    createNativeLocalSession(windowRef,{signal:controller.signal}),
  ]);
  controller.abort(new Error("Bootstrap GET already finished"));
  assert.equal(await prefs.save({"regional.locale":"pt-BR"}),true);
  assert.equal(await receipt.save(firstRun),true);
  assert.equal((await session.lock()).state,"unlocked");
  assert.equal(calls.filter(c=>c.init.method==="GET").length,3);
  const posts=calls.filter(c=>c.init.method==="POST");
  assert.equal(posts.length,3);
  assert.ok(posts.every(c=>!Object.hasOwn(c.init,"signal")),
    "state, preference and local-session writes must await real acknowledgement");
});
