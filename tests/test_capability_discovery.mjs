import assert from "node:assert/strict";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import { createNativeSurfaceHost } from "../system/adapters/native/runtime.mjs";
import {
  SYSTEM_CAPABILITY_STATE_SCHEMA,
} from "../system/contracts/system-foundation.mjs";
import {
  APPLICATION_ACTION_CAPABILITY_SCHEMA,
} from "../system/contracts/application-action-capability.mjs";
import { createSystemFoundationRuntime } from "../system/services/system-foundation/runtime.mjs";
import { CAPABILITY_DISCOVERY_SCHEMA,
  validateCapabilityDiscoverySnapshot } from
  "../system/contracts/capability-discovery.mjs";
import { createCapabilityDiscovery } from
  "../system/services/system-foundation/capability-discovery.mjs";
import { createApplicationIntelligenceAwareness } from
  "../system/services/intelligence/application-awareness.mjs";
import { createApplicationActionCapabilityRegistry } from
  "../system/services/intelligence/application-action-capabilities.mjs";
import { PERSONAL_ACTION_CATALOG_SCHEMA, PERSONAL_ACTION_ENTRY_SCHEMA } from
  "../system/contracts/personal-action-catalog.mjs";

function systemCapability(id,available=true){
  return {
    schema:SYSTEM_CAPABILITY_STATE_SCHEMA,
    id,available,source:"test.native",
  };
}
const app=listFirstPartyApps()[0];
function appCapability(revision="1"){
  return {
    schema:APPLICATION_ACTION_CAPABILITY_SCHEMA,
    appId:app.id,actionId:"document.open-resource",
    title:"Open a granted resource",
    description:"Open a resource with a verified first-party provider.",
    sourceClass:"first-party",platform:"ordax",
    provider:{kind:"first-party-native",adapterId:"document-actions",revision},
    binding:{payloadSha256:null},
    parameters:[
      {id:"resource",type:"resource-grant-id",required:true,maxLength:128},
      {id:"quality",type:"integer",required:false,minimum:1,maximum:100},
    ],
    riskClass:"read-only",confirmation:"none",
    executionAuthorized:false,modelDirectExecutionAuthorized:false,
    provenance:"test:verified-provider",
  };
}
function registry(revision="1"){
  return createApplicationActionCapabilityRegistry({
    awareness:createApplicationIntelligenceAwareness({
      firstPartyApplications:[app],installedApplications:[],
    }),
    capabilities:[appCapability(revision)],
  });
}
test("discovery derives live system and app semantic metadata but never publishes executable tools",()=>{
  const foundation=createSystemFoundationRuntime({
    capabilities:[systemCapability("surface.native",true),
      systemCapability("aura.local",false)],
  });
  const live=registry();
  const catalog=createCapabilityDiscovery({
    getFoundation:()=>foundation,getApplicationActions:()=>live,
  });
  const result=catalog.snapshot();
  assert.equal(result.schema,CAPABILITY_DISCOVERY_SCHEMA);
  assert.equal(result.revision,1);
  assert.equal(result.revisionScope,"session");
  assert.equal(result.authority,"none");
  assert.equal(result.toolExecution,false);
  assert.deepEqual(result.entries.map(item=>item.id),[
    "app:"+app.id+":document.open-resource",
    "system:aura.local","system:surface.native",
  ]);
  const application=result.entries[0];
  assert.equal(application.kind,"application-action");
  assert.equal(application.availability,"declared-only");
  assert.equal(application.execution,"unavailable");
  assert.equal(application.authority,"none");
  assert.equal(application.inputSchema.type,"object");
  assert.equal(application.inputSchema.additionalProperties,false);
  assert.deepEqual(application.inputSchema.required,["resource"]);
  assert.equal(application.inputSchema.properties.resource.type,"string");
  assert.equal(application.inputSchema.properties.resource.pattern,
    "^[a-z][a-z0-9-]{0,127}$");
  assert.equal(application.inputSchema.properties.quality.minimum,1);
  assert.equal(application.inputSchema.properties.quality.maximum,100);
  assert.equal(result.entries[1].availability,"unavailable");
  assert.equal(result.entries[2].availability,"reported-available");
  assert.equal(Object.isFrozen(result.entries),true);
  assert.equal(Object.isFrozen(application.inputSchema.properties),true);
  assert.deepEqual(catalog.get(application.id),application);
  for(const forbidden of ["execute","run","invoke","grant","authorize","register"]){
    assert.equal(catalog[forbidden],undefined);
  }
});
test("live source mutations update the discovery revision without creating another SSOT",()=>{
  const foundation=createSystemFoundationRuntime({
    capabilities:[systemCapability("surface.native",true)],
  });
  let actions=registry();
  const catalog=createCapabilityDiscovery({
    getFoundation:()=>foundation,getApplicationActions:()=>actions,
  });
  const first=catalog.snapshot();
  assert.equal(catalog.snapshot().revision,first.revision);
  foundation.capabilities.set({
    id:"surface.native",available:false,
    source:"test.native",reason:"host-disconnected",
  });
  const second=catalog.snapshot();
  assert.equal(second.revision,first.revision+1);
  assert.equal(second.entries[1].availability,"unavailable");
  assert.equal(catalog.snapshot().revision,second.revision);
  actions=registry("2");
  const third=catalog.snapshot();
  assert.equal(third.revision,second.revision+1,
    "a verified provider update invalidates the catalog revision");
  assert.deepEqual(third.entries,second.entries,
    "provider metadata does not expose an executable permission");
  actions=null; // package removed / no action registry mounted
  const fourth=catalog.snapshot();
  assert.equal(fourth.revision,third.revision+1);
  assert.equal(fourth.entries.length,1);
  assert.equal(catalog.get("app:"+app.id+":document.open-resource"),null);
});
test("invalidated registry or Foundation fails closed instead of serving old cached metadata",()=>{
  const foundation=createSystemFoundationRuntime({
    capabilities:[systemCapability("surface.native",true)],
  });
  let source=registry(),currentFoundation=foundation;
  const catalog=createCapabilityDiscovery({
    getFoundation:()=>currentFoundation,getApplicationActions:()=>source,
  });
  assert.equal(catalog.snapshot().entries.length,2);
  source={schema:"ordax.application-action-capability-registry/1",
    list:()=>[],get:()=>null,listForApp:()=>[],propose:()=>null,
    contextItem:()=>null,execute:()=>true,
  };
  assert.throws(()=>catalog.snapshot(),/must not expose execute/);
  source=registry();
  currentFoundation={schema:"ordax.system-foundation/1",capabilities:{
    list:()=>[{}],
  }};
  assert.throws(()=>catalog.snapshot(),/System capability state schema/);
  currentFoundation=null;
  assert.throws(()=>catalog.snapshot(),/System Foundation capability source/);
  currentFoundation=foundation;
  assert.equal(catalog.snapshot().revision,2,
    "invalid reads publish no revision; the first valid recovery reattests a new revision");
  assert.throws(()=>createCapabilityDiscovery({getFoundation:()=>foundation}),
    /exactly one live system source/);
});
test("read-only public contract rejects forged tools, permission claims and duplicate identities",()=>{
  const discovery=createCapabilityDiscovery({
    getFoundation:()=>createSystemFoundationRuntime({
      capabilities:[systemCapability("surface.native",true)],
    }),
    getApplicationActions:()=>registry(),
  });
  const sample=JSON.parse(JSON.stringify(discovery.snapshot()));
  assert.equal(validateCapabilityDiscoverySnapshot(sample),sample);
  // "system:action.*" is reserved for Native action descriptions. A
  // system-state entry must not masquerade as an action by ID while keeping
  // the less restrictive state-only shape.
  const masquerading = structuredClone(sample);
  const systemState = masquerading.entries.find(entry => entry.kind === "system-state");
  systemState.id = "system:action.native-file.ensure-directory";
  assert.throws(() => validateCapabilityDiscoverySnapshot(masquerading),
    /reserved|system.*action|inconsistent/i);
  const forged={...sample,toolExecution:true};
  assert.throws(()=>validateCapabilityDiscoverySnapshot(forged),/envelope/);
  assert.throws(()=>validateCapabilityDiscoverySnapshot({...sample,execute:true}),
    /undeclared field/);
  const executable=structuredClone(sample);
  executable.entries[0].execution="ready";
  assert.throws(()=>validateCapabilityDiscoverySnapshot(executable),/execution authority/);
  const duplicate=structuredClone(sample);
  duplicate.entries.push(duplicate.entries[0]);
  assert.throws(()=>validateCapabilityDiscoverySnapshot(duplicate),/invalid or has execution authority/);
  const injected=structuredClone(sample);
  injected.entries[0].inputSchema.properties.resource.shell="powershell";
  assert.throws(()=>validateCapabilityDiscoverySnapshot(injected),/undeclared field/);
  const bounds=structuredClone(sample);
  bounds.entries[0].inputSchema.properties.quality.minimum=Infinity;
  assert.throws(()=>validateCapabilityDiscoverySnapshot(bounds),/minimum/);
  const unbounded=structuredClone(sample);
  unbounded.entries[0].inputSchema.properties.resource.pattern="(.+)+";
  assert.throws(()=>validateCapabilityDiscoverySnapshot(unbounded),/pattern/);
  const duplicateArgument=structuredClone(sample);
  duplicateArgument.entries[0].inputSchema.required=["resource","resource"];
  assert.throws(()=>validateCapabilityDiscoverySnapshot(duplicateArgument),/unique/);
});
test("Native Capability Fabric reads and subscribes to the real Host without a parallel registry",()=>{
  const events=new Map();
  const browser={
    navigator:{onLine:true},
    addEventListener:(type,fn)=>events.set(type,fn),
    removeEventListener:(type)=>events.delete(type),
  };
  let identity=false;
  const host=createNativeSurfaceHost(browser,{
    networkStatusAvailable:true,
    systemMetricsAvailable:true,
    readAccountIdentityAvailable:()=>identity,
  });
  let active=host;
  const catalog=createCapabilityDiscovery({
    getSurfaceHost:()=>active,
    getApplicationActions:()=>registry(),
  });
  const initial=catalog.snapshot();
  const revisions=[],failures=[];
  const unsubscribe=catalog.subscribe(
    snapshot=>revisions.push(snapshot.revision),
    error=>failures.push(error),
  );
  host.refresh();
  assert.deepEqual(revisions,[],"unchanged host refresh cannot duplicate events");
  assert.equal(initial.entries.find(item=>item.id==="system:network.status")?.availability,
    "reported-available");
  assert.equal(initial.entries.find(item=>item.id==="system:system.metrics")?.execution,
    "unavailable");
  assert.equal(initial.entries.find(item=>item.id==="system:account.identity"),undefined);
  assert.equal(initial.entries.some(item=>item.kind==="application-action"),true);
  assert.equal(initial.toolExecution,false);
  identity=true;
  host.refresh();
  const updated=catalog.snapshot();
  assert.equal(updated.revision,initial.revision+1);
  assert.deepEqual(revisions,[updated.revision]);
  host.refresh();
  assert.deepEqual(revisions,[updated.revision],"same revision must not notify twice");
  assert.equal(updated.entries.find(item=>item.id==="system:account.identity")?.ownerId,
    "surface.native");
  active=null;
  assert.throws(()=>catalog.snapshot(),/Native Surface Host is required/);
  host.refresh();
  assert.equal(failures.length,1,"invalid source is reported without returning stale data");
  unsubscribe();
  host.refresh();
  assert.equal(failures.length,1,"a released listener cannot receive more events");
  host.dispose();
  assert.equal(events.size,0);
  assert.throws(()=>createCapabilityDiscovery({
    getSurfaceHost:()=>host,getFoundation:()=>createSystemFoundationRuntime(),
    getApplicationActions:()=>null,
  }),/exactly one live system source/);
  const foundationCatalog=createCapabilityDiscovery({
    getFoundation:()=>createSystemFoundationRuntime(),
    getApplicationActions:()=>null,
  });
  assert.throws(()=>foundationCatalog.subscribe(()=>{}),/requires the live Native Surface Host/);
});
test("source enumeration order does not create a false capability revision",()=>{
  const states=[systemCapability("network.native"),systemCapability("surface.native")];
  const foundation={schema:"ordax.system-foundation/1",capabilities:{
    list:()=>states,
  }};
  const catalog=createCapabilityDiscovery({
    getFoundation:()=>foundation,getApplicationActions:()=>null,
  });
  assert.equal(catalog.snapshot().revision,1);
  states.reverse();
  assert.equal(catalog.snapshot().revision,1,
    "provider enumeration is not a semantic capability change");
});
test("discovery rejects source overflow, unknown IDs, and does not return stale entries",()=>{
  let count=0;
  const foundation={
    schema:"ordax.system-foundation/1",
    capabilities:{list:()=>Array.from({length:count},(_,index)=>
      systemCapability("test.action-"+index))},
  };
  const catalog=createCapabilityDiscovery({
    getFoundation:()=>foundation,getApplicationActions:()=>null,
  });
  count=2;
  assert.equal(catalog.snapshot().entries.length,2);
  count=1025;
  assert.throws(()=>catalog.snapshot(),/bounded sources/);
  assert.throws(()=>catalog.get("system:unrecognized"),/bounded sources/,
    "invalid catalog size must not produce an apparently valid result");
  assert.equal(catalog.get("../../system/shell"),null);
});

test("unobservable provider gap invalidates revision even if its recovered metadata is identical", () => {
  const foundation = createSystemFoundationRuntime();
  const appRegistry = registry();
  let offline = false;
  const discovery = createCapabilityDiscovery({
    getFoundation: () => foundation,
    getApplicationActions: () => {
      if (offline) throw new Error("Provider discovery transport unavailable");
      return appRegistry;
    },
  });
  const initial = discovery.snapshot();
  offline = true;
  assert.throws(() => discovery.snapshot(), /Provider discovery transport unavailable/);
  offline = false;
  const reattested = discovery.snapshot();
  assert.deepEqual(reattested.entries, initial.entries);
  assert.equal(reattested.revision, initial.revision + 1,
    "a lost observation must not preserve an old capability approval revision");
  assert.equal(discovery.snapshot().revision, reattested.revision);
});

test("reentrant catalog refresh cannot deliver duplicate revisions or reverse the subscriber cursor", t => {
  const browser = {
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  };
  const host = createNativeSurfaceHost(browser);
  t.after(() => host.dispose());
  let actions = registry("1");
  const catalog = createCapabilityDiscovery({
    getSurfaceHost: () => host,
    getApplicationActions: () => actions,
  });
  const initial = catalog.snapshot().revision;
  const seen = [];
  const unsubscribe = catalog.subscribe(snapshot => {
    seen.push(snapshot.revision);
    if (seen.length === 1) {
      actions = registry("3");
      catalog.refresh();
    }
  });
  t.after(unsubscribe);
  actions = registry("2");
  catalog.refresh();
  assert.deepEqual(seen, [initial + 1, initial + 2],
    "nested refresh must not cause re-delivery of the latest version");
  assert.equal(catalog.refresh().revision, initial + 2);
  assert.deepEqual(seen, [initial + 1, initial + 2]);
});

test("a subscriber re-reading an unchanged catalog cannot re-deliver the same revision", t => {
  const host = createNativeSurfaceHost({
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  });
  t.after(() => host.dispose());
  let actions = registry("1");
  const catalog = createCapabilityDiscovery({
    getSurfaceHost: () => host,
    getApplicationActions: () => actions,
  });
  const seen = [];
  const unsubscribe = catalog.subscribe(snapshot => {
    seen.push(snapshot.revision);
    if (seen.length <= 3) catalog.refresh();
  });
  t.after(unsubscribe);
  actions = registry("2");
  catalog.refresh();
  assert.deepEqual(seen, [2],
    "the listener must not recursively re-enter with identical metadata");
});

test("nested refresh cannot deliver an old revision to a later subscriber", t => {
  const host = createNativeSurfaceHost({
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  });
  t.after(() => host.dispose());
  let actions = registry("1");
  const catalog = createCapabilityDiscovery({
    getSurfaceHost: () => host,
    getApplicationActions: () => actions,
  });
  const seenFirst = [], seenSecond = [];
  const unsubscribeFirst = catalog.subscribe(snapshot => {
    seenFirst.push(snapshot.revision);
    if (snapshot.revision === 2) {
      actions = registry("3");
      catalog.refresh();
    }
  });
  const unsubscribeSecond = catalog.subscribe(snapshot => {
    seenSecond.push(snapshot.revision);
  });
  t.after(unsubscribeFirst);
  t.after(unsubscribeSecond);
  actions = registry("2");
  catalog.refresh();
  catalog.refresh();
  assert.deepEqual(seenFirst, [2, 3]);
  assert.deepEqual(seenSecond, [3],
    "the later subscriber must not see revision 2 after already seeing 3");
});

test("discovery still routes a subscriber failure to its existing fail-closed onError", t => {
  const host = createNativeSurfaceHost({
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  });
  t.after(() => host.dispose());
  let actions = registry("1");
  const catalog = createCapabilityDiscovery({
    getSurfaceHost: () => host,
    getApplicationActions: () => actions,
  });
  const errors = [];
  const unsubscribe = catalog.subscribe(() => {
    throw new Error("Canonical grant reconciliation failed");
  }, error => errors.push(error.message));
  t.after(unsubscribe);
  actions = registry("2");
  catalog.refresh();
  catalog.refresh();
  assert.deepEqual(errors, ["Canonical grant reconciliation failed"]);
  assert.equal(catalog.snapshot().revision, 2);
});

test("subscribe closes the blind window when the Store source changes during Host listener registration", t => {
  const rawHost = createNativeSurfaceHost({
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  });
  t.after(() => rawHost.dispose());
  let installed = registry("1");
  let registrations = 0;
  const host = Object.freeze({
    ...rawHost,
    subscribe(listener) {
      registrations += 1;
      // Mimics a Store slot change while the Host listener is not attached.
      installed = registry("2");
      return rawHost.subscribe(listener);
    },
  });
  const fabric = createCapabilityDiscovery({
    getSurfaceHost: () => host,
    getApplicationActions: () => installed,
  });
  const revisions = [];
  const initial = fabric.snapshot();
  assert.equal(initial.revision, 1);
  const unsubscribe = fabric.subscribe(snapshot => revisions.push(snapshot.revision));
  t.after(unsubscribe);
  assert.equal(registrations, 1);
  assert.deepEqual(revisions, [initial.revision + 1],
    "the registration gap must not lose the verified Store slot update");
  assert.equal(fabric.snapshot().revision, initial.revision + 1);
  rawHost.refresh();
  assert.deepEqual(revisions, [initial.revision + 1]);
});

test("catch-up notification failure releases the Host listener instead of leaking a stale subscription", t => {
  const rawHost = createNativeSurfaceHost({
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  });
  t.after(() => rawHost.dispose());
  let installed = registry("1");
  let subscriptions = 0;
  let releases = 0;
  const host = Object.freeze({
    ...rawHost,
    subscribe(listener) {
      subscriptions += 1;
      installed = registry("2");
      const release = rawHost.subscribe(listener);
      return () => { releases += 1; release(); };
    },
  });
  const fabric = createCapabilityDiscovery({
    getSurfaceHost: () => host,
    getApplicationActions: () => installed,
  });
  assert.throws(
    () => fabric.subscribe(() => { throw new Error("Host catch-up rejected"); }),
    /Host catch-up rejected/,
  );
  assert.equal(subscriptions, 1);
  assert.equal(releases, 1, "a rejected initial notification must detach the listener");
  assert.doesNotThrow(() => rawHost.refresh(),
    "orphaned callbacks must not run after subscription setup failure");
});

test("unsubscribe during an in-flight refresh suppresses queued stale subscriber callbacks", t => {
  const host = createNativeSurfaceHost({
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  });
  t.after(() => host.dispose());
  let apps = registry("1");
  const fabric = createCapabilityDiscovery({
    getSurfaceHost: () => host,
    getApplicationActions: () => apps,
  });
  const delivered = [];
  let unsubscribeLate = null;
  const unsubscribeEarly = fabric.subscribe(snapshot => {
    delivered.push(["early", snapshot.revision]);
    unsubscribeLate();
  });
  unsubscribeLate = fabric.subscribe(snapshot => {
    delivered.push(["late", snapshot.revision]);
  });
  t.after(unsubscribeEarly);
  t.after(() => unsubscribeLate?.());
  apps = registry("2");
  fabric.refresh();
  assert.deepEqual(delivered, [["early", 2]],
    "a listener removed by an earlier callback must not receive queued notification");
  apps = registry("3");
  fabric.refresh();
  assert.deepEqual(delivered, [["early", 2], ["early", 3]]);
});

test("unsubscribe during catch-up suppresses listener after teardown and stays idempotent", t => {
  const host = createNativeSurfaceHost({
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  });
  t.after(() => host.dispose());
  let apps = registry("1");
  const fabric = createCapabilityDiscovery({
    getSurfaceHost: () => host,
    getApplicationActions: () => apps,
  });
  let count = 0;
  const unsubscribe = fabric.subscribe(() => { count++; });
  apps = registry("2");
  host.refresh();
  assert.equal(count, 1);
  unsubscribe();
  unsubscribe();
  apps = registry("3");
  host.refresh();
  fabric.refresh();
  assert.equal(count, 1, "Host events and Store refresh after teardown must be ignored");
});

test("unsubscribe triggered synchronously inside a source read suppresses that read's callback", t => {
  const host = createNativeSurfaceHost({
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  });
  t.after(() => host.dispose());
  let actions = registry("1");
  let teardownWhileReading = false;
  let unsubscribe = null;
  const fabric = createCapabilityDiscovery({
    getSurfaceHost: () => host,
    getApplicationActions() {
      if (teardownWhileReading) {
        teardownWhileReading = false;
        unsubscribe();
      }
      return actions;
    },
  });
  const revisions = [];
  unsubscribe = fabric.subscribe(snapshot => revisions.push(snapshot.revision));
  t.after(() => unsubscribe?.());
  actions = registry("2");
  teardownWhileReading = true;
  host.refresh();
  assert.deepEqual(revisions, [],
    "disposal inside a read must prevent a callback from that same read");
  actions = registry("3");
  fabric.refresh();
  assert.deepEqual(revisions, []);
});

const NATIVE_FIXTURE_ENTRY = Object.freeze({
  schema: PERSONAL_ACTION_ENTRY_SCHEMA,
  id: "native-file.ensure-directory",
  toolId: "ordax-native-file-space",
  toolArtifactSha256: "a".repeat(64),
  actionId: "files.directory.ensure",
  effect: "write",
  inputKind: "resource-value",
  resourceScheme: "file-space",
});

function discoveryForChangingNativeCatalog(list) {
  return createCapabilityDiscovery({
    getFoundation: () => createSystemFoundationRuntime(),
    getApplicationActions: () => null,
    getNativeActions: () => ({
      schema: PERSONAL_ACTION_CATALOG_SCHEMA,
      list,
      propose() {},
      request() {},
    }),
  });
}

test("Native catalog identity validation uses the same enumeration, not a second list()", () => {
  let reads = 0;
  const fabric = discoveryForChangingNativeCatalog(() =>
    ++reads === 1 ? [] : [NATIVE_FIXTURE_ENTRY]);
  assert.equal(fabric.isNativeActionRegistered(NATIVE_FIXTURE_ENTRY), false,
    "a newly returned action must not bypass the initial validated catalog");
  assert.equal(reads, 1);
});

test("duplicate Native catalog IDs fail closed before an individual match", () => {
  const fabric = discoveryForChangingNativeCatalog(() =>
    [NATIVE_FIXTURE_ENTRY, NATIVE_FIXTURE_ENTRY]);
  assert.throws(() => fabric.isNativeActionRegistered(NATIVE_FIXTURE_ENTRY),
    /duplicate/i);
  assert.throws(() => fabric.snapshot(), /duplicate/i);
});

test("Native provider A-B-A observed by identity check invalidates the earlier discovery revision", () => {
  let nativeEntries = [NATIVE_FIXTURE_ENTRY];
  const fabric = discoveryForChangingNativeCatalog(() => nativeEntries);
  const before = fabric.snapshot();
  assert.equal(fabric.isNativeActionRegistered(NATIVE_FIXTURE_ENTRY), true);
  assert.equal(fabric.snapshot().revision, before.revision,
    "a matching verified provider must not churn the approval revision");

  nativeEntries = [{
    ...NATIVE_FIXTURE_ENTRY,
    toolArtifactSha256: "b".repeat(64),
  }];
  assert.equal(fabric.isNativeActionRegistered(NATIVE_FIXTURE_ENTRY), false,
    "an artifact substitution must be observed even without Host or Store events");

  nativeEntries = [NATIVE_FIXTURE_ENTRY];
  const after = fabric.snapshot();
  assert.ok(after.revision > before.revision,
    "the old approval revision must not revive after a silent A-B-A provider change");
  assert.deepEqual(after.entries, before.entries,
    "the public descriptors can match while the private revision must advance");
});
