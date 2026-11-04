import test from "node:test";
import assert from "node:assert/strict";
import { createNativeSurfaceHost } from "../system/adapters/native/runtime.mjs";
import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import { APPLICATION_ACTION_CAPABILITY_SCHEMA } from
  "../system/contracts/application-action-capability.mjs";
import { createApplicationIntelligenceAwareness } from
  "../system/services/intelligence/application-awareness.mjs";
import { createApplicationActionCapabilityRegistry } from
  "../system/services/intelligence/application-action-capabilities.mjs";
import { createApplicationContextIntelligence } from
  "../system/services/intelligence/application-context.mjs";
import { INTELLIGENCE_PORT_SCHEMA } from "../system/contracts/intelligence.mjs";
import { createCapabilityDiscovery } from
  "../system/services/system-foundation/capability-discovery.mjs";
import { createCurrentVerifiedActionGate } from
  "../system/services/system-foundation/current-verified-action-gate.mjs";

const app=listFirstPartyApps()[0];
const SHA="a".repeat(40);
const origin=Object.freeze({
  application:Object.freeze({
    id:app.id,component:Object.freeze({id:app.id,version:"0.4.2"}),
  }),
  revision:12,
  sourceCommit:SHA,
});
const capability={
  schema:APPLICATION_ACTION_CAPABILITY_SCHEMA,
  appId:app.id,actionId:"document.open-resource",
  title:"Open granted resource",
  description:"Metadata only",
  sourceClass:"first-party",platform:"ordax",
  provider:{kind:"first-party-native",adapterId:"document-actions",revision:"1"},
  binding:{payloadSha256:null},
  parameters:[],
  riskClass:"read-only",confirmation:"none",
  executionAuthorized:false,modelDirectExecutionAuthorized:false,
  provenance:"verified:test",
};
function metadata({
  source="slot",version="0.4.2",sourceCommit=SHA,revision=12,
}={}){
  return {
    componentId:app.id,state:"current",source,revision,
    version:source==="slot"?version:null,
    sourceCommit:source==="slot"?sourceCommit:null,
    entrypoint:source==="slot"?`system/apps/${app.id}/src/runtime.mjs`:null,
    pendingHealth:null,
  };
}
function env(t){
  let observations=[];
  const events=new Map();
  const browser={
    navigator:{onLine:true},
    addEventListener(name,callback){events.set(name,callback)},
    removeEventListener(name){events.delete(name)},
  };
  const host=createNativeSurfaceHost(browser,{systemMetricsAvailable:true});
  const awareness=createApplicationIntelligenceAwareness({
    firstPartyApplications:[app],installedApplications:[],
  });
  const gate=createCurrentVerifiedActionGate({
    verifiedSemantics:[origin],
    getCurrentObservations:()=>observations,
  });
  const registry=createApplicationActionCapabilityRegistry({
    awareness,
    capabilities:[capability],
    isCurrent:gate.isCurrent,
  });
  const catalog=createCapabilityDiscovery({
    getSurfaceHost:()=>host,
    getApplicationActions:()=>registry,
    isApplicationActionCurrent:gate.isCurrent,
  });
  t.after(()=>host.dispose());
  return {gate,awareness,registry,catalog,host,setCurrent(value){observations=value}};
}

test("one signed current-slot observation controls Fabric, Personal proposals and Aura context",async t=>{
  const {awareness,registry,catalog,setCurrent}=env(t);
  let request=null;
  const intelligence=createApplicationContextIntelligence({
    awarenessPort:awareness,
    actionCapabilityRegistryPort:registry,
    intelligencePort:Object.freeze({
      schema:INTELLIGENCE_PORT_SCHEMA,
      getSnapshot(){return {
        schema:INTELLIGENCE_PORT_SCHEMA,state:"ready",
        inferenceAvailable:true,engineId:"llama.cpp",modelId:"test",
        authority:"none",toolExecution:false,
      }},
      subscribe(){return ()=>{}},
      respond(value){request=value;return Promise.resolve({
        schema:"ordax.intelligence-response/1",text:"ok",
        engineId:"llama.cpp",modelId:"test",authority:"none",
      })},
    }),
  });
  const prompt=async()=>{
    await intelligence.respond({prompt:"Abra o recurso"});
    const item=request.context.find(entry=>
      entry.id==="ordax-application-action-capabilities");
    return JSON.parse(item.text).actions;
  };
  assert.equal(registry.list().length,0);
  assert.equal((await prompt()).length,0);
  assert.equal(catalog.snapshot().entries.filter(x=>x.kind==="application-action").length,0);
  setCurrent([metadata()]);
  assert.equal(registry.list().length,1);
  assert.equal((await prompt()).length,1);
  assert.equal(catalog.snapshot().entries.filter(x=>x.kind==="application-action").length,1);
  assert.equal(registry.propose(app.id,capability.actionId,{}).executionAuthorized,false);
  setCurrent([metadata({version:"0.4.3",revision:13})]);
  assert.equal(registry.list().length,0);
  assert.equal((await prompt()).length,0);
  assert.equal(catalog.snapshot().entries.filter(x=>x.kind==="application-action").length,0);
  assert.throws(()=>registry.propose(app.id,capability.actionId,{}),/not current/);
  setCurrent([metadata({source:"removed",revision:14})]);
  assert.equal((await prompt()).length,0);
  assert.equal(intelligence.getSnapshot().toolExecution,false);
});
test("boot actions stay hidden until a matching CURRENT verified slot is observed",t=>{
  const {catalog,setCurrent}=env(t);
  const initial=catalog.snapshot();
  assert.ok(initial.entries.length>=1);
  assert.ok(initial.entries.every(x=>x.kind==="system-state"));
  setCurrent([metadata()]);
  const ready=catalog.refresh();
  assert.equal(ready.revision,initial.revision+1);
  assert.equal(ready.entries.filter(x=>x.kind==="application-action").length,1);
  assert.equal(ready.toolExecution,false);
  assert.equal(ready.entries[0].execution,"unavailable");
  assert.equal(catalog.refresh().revision,ready.revision,
    "repeated Store refresh without identity changes is stable");
});

test("remove, upgrade, missing current observation or source drift instantly withdraws old actions",t=>{
  const {catalog,setCurrent}=env(t);
  setCurrent([metadata()]);
  const ready=catalog.snapshot();
  const changes=[];
  const unsubscribe=catalog.subscribe(snapshot=>changes.push(snapshot.revision));
  setCurrent([metadata({source:"removed",revision:13})]);
  const removed=catalog.refresh();
  assert.equal(removed.entries.filter(x=>x.kind==="application-action").length,0);
  assert.equal(changes.length,1);
  setCurrent([metadata({version:"0.4.3",revision:13})]);
  assert.equal(catalog.refresh().entries.filter(x=>x.kind==="application-action").length,0);
  setCurrent([metadata({sourceCommit:"b".repeat(40)})]);
  assert.equal(catalog.refresh().entries.filter(x=>x.kind==="application-action").length,0);
  setCurrent([]);
  assert.equal(catalog.refresh().entries.filter(x=>x.kind==="application-action").length,0);
  setCurrent([metadata()]);
  assert.equal(catalog.refresh().entries.filter(x=>x.kind==="application-action").length,1);
  assert.ok(catalog.snapshot().revision>ready.revision);
  unsubscribe();
});

test("malformed current metadata and duplicate observations fail closed, not stale",t=>{
  const {catalog,setCurrent}=env(t);
  setCurrent([metadata()]);
  assert.equal(catalog.snapshot().entries.filter(x=>x.kind==="application-action").length,1);
  setCurrent(null);
  assert.throws(()=>catalog.snapshot(),/current observations unavailable/);
  setCurrent([metadata(),metadata()]);
  assert.equal(catalog.snapshot().entries.filter(x=>x.kind==="application-action").length,0,
    "duplicate current entries cannot confer app availability");
  setCurrent([{...metadata(),state:"pending"}]);
  assert.throws(()=>catalog.snapshot(),/state mismatch|Unsupported/);
  setCurrent([metadata()]);
  assert.equal(catalog.snapshot().entries.filter(x=>x.kind==="application-action").length,1);
});

test("invalid declaration bindings and foreign apps cannot gain discovery authority",t=>{
  assert.throws(()=>createCurrentVerifiedActionGate({
    verifiedSemantics:[origin,origin],
    getCurrentObservations:()=>[],
  }),/not unique/);
  assert.throws(()=>createCurrentVerifiedActionGate({
    verifiedSemantics:[{...origin,sourceCommit:"invalid"}],
    getCurrentObservations:()=>[],
  }),/not unique or valid/);
  const {gate,setCurrent}=env(t);
  setCurrent([metadata()]);
  assert.equal(gate.isCurrent({appId:"unknown-app"}),false);
  assert.equal(gate.isCurrent({appId:app.id}),true);
  assert.equal(typeof gate.execute,"undefined");
  assert.equal(typeof gate.authorize,"undefined");
});

test("an unrelated malformed or duplicate CURRENT slot invalidates the whole action view", t => {
  const { gate, registry, catalog, setCurrent } = env(t);
  const other = {
    ...metadata(), componentId: "clock",
    entrypoint: "system/apps/clock/src/runtime.mjs",
  };
  setCurrent([metadata(), other]);
  assert.equal(gate.isCurrent({ appId: app.id }), true);
  assert.equal(registry.list().length, 1);

  // A matching Notes slot alone is not enough: the Store publishes one
  // atomic CURRENT observation set, and any corrupt peer invalidates it.
  setCurrent([metadata(), { ...other, state: "pending" }]);
  assert.throws(() => gate.isCurrent({ appId: app.id }), /state mismatch|Unsupported/);
  assert.throws(() => registry.list(), /state mismatch|Unsupported/);
  assert.throws(() => catalog.snapshot(), /state mismatch|Unsupported/);

  setCurrent([metadata(), other, { ...other }]);
  assert.equal(gate.isCurrent({ appId: app.id }), false);
  assert.deepEqual(registry.list(), []);
  assert.deepEqual(catalog.snapshot().entries.filter(
    entry => entry.kind === "application-action"), []);

  setCurrent([metadata(), other]);
  assert.equal(registry.list().length, 1,
    "the same live registry must recover only after a valid complete observation");
});

test("a multi-app Native Store read never mixes CURRENT generations in one action list", t => {
  const secondApp = listFirstPartyApps()[1];
  const secondOrigin = {
    ...origin,
    application: {
      id: secondApp.id,
      component: { id: secondApp.id, version: "0.4.2" },
    },
  };
  const secondMetadata = {
    ...metadata(),
    componentId: secondApp.id,
    entrypoint: `system/apps/${secondApp.id}/src/runtime.mjs`,
  };
  let reads = 0;
  const gate = createCurrentVerifiedActionGate({
    verifiedSemantics: [origin, secondOrigin],
    // A changing CURRENT slot makes two consecutive reads disagree:
    // each application could seem current individually, but not together.
    getCurrentObservations() {
      return ++reads % 2 ? [metadata()] : [secondMetadata];
    },
  });
  const actions = [
    capability,
    { ...capability, appId: secondApp.id },
  ];
  const mixed = createApplicationActionCapabilityRegistry({
    awareness: createApplicationIntelligenceAwareness({
      firstPartyApplications: [app, secondApp],
      installedApplications: [],
    }),
    capabilities: actions,
    isCurrent: gate.isCurrent,
    isCurrentBatch: gate.isCurrentBatch,
  });
  const listed = mixed.list();
  assert.equal(reads, 1, "the whole list must use one canonical CURRENT observation");
  assert.deepEqual(listed.map(action => action.appId), [app.id],
    "two mutually exclusive CURRENT generations cannot be published together");
  const listedNext = mixed.list();
  assert.equal(reads, 2);
  assert.deepEqual(listedNext.map(action => action.appId), [secondApp.id]);
  const context = JSON.parse(mixed.contextItemForApps([
    app.id, secondApp.id,
  ]).text);
  assert.equal(reads, 3,
    "selected app context must use the same one-read CURRENT gate");
  assert.deepEqual(context.actions.map(action => action.appId), [app.id]);
  assert.throws(() => gate.isCurrentBatch(new Array(513)), /bounds/);
  assert.equal(typeof gate.execute, "undefined");
  assert.equal(typeof gate.authorize, "undefined");
});

test("CURRENT inference scope is transient, reentrant and never survives completion or failure", async t => {
  let observations = [metadata()];
  let reads = 0;
  const gate = createCurrentVerifiedActionGate({
    verifiedSemantics: [origin],
    getCurrentObservations() { reads++; return observations; },
  });
  assert.throws(() => gate.withCurrentSnapshot(null), /requires a callback/);
  const outcome = gate.withCurrentSnapshot(() => {
    assert.equal(gate.isCurrent({ appId: app.id }), true);
    observations = [metadata({ version: "0.4.3", revision: 13 })];
    return gate.withCurrentSnapshot(() => {
      assert.equal(gate.isCurrent({ appId: app.id }), true,
        "a nested synchronous caller must reuse the pinned view");
      return "verified";
    });
  });
  assert.equal(outcome, "verified");
  assert.equal(reads, 1);
  assert.equal(gate.isCurrent({ appId: app.id }), false,
    "outside the scope, CURRENT must be read live after withdrawal");
  assert.equal(reads, 2);
  observations = [metadata()];
  assert.throws(() => gate.withCurrentSnapshot(() => {
    assert.equal(gate.isCurrent({ appId: app.id }), true);
    throw new Error("test interruption");
  }), /test interruption/);
  observations = [];
  assert.equal(gate.isCurrent({ appId: app.id }), false,
    "a thrown request must not leave a stale pinned CURRENT view");
  assert.equal(reads, 4);
  observations = [metadata()];
  const asynchronous = gate.withCurrentSnapshot(() =>
    Promise.resolve().then(() => gate.isCurrent({ appId: app.id })));
  observations = [];
  assert.equal(await asynchronous, false,
    "async completion must read live CURRENT, not retain the synchronous scope");
  assert.equal(reads, 6);
  assert.equal(typeof gate.execute, "undefined");
  assert.equal(typeof gate.authorize, "undefined");
});

test("Native event subscription does not turn app observations into executable grants",t=>{
  const {catalog,host,setCurrent}=env(t);
  const revisions=[];
  const unsubscribe=catalog.subscribe(snapshot=>revisions.push(snapshot.revision));
  host.refresh();
  assert.deepEqual(revisions,[]);
  setCurrent([metadata()]);
  const current=catalog.refresh();
  assert.deepEqual(revisions,[current.revision]);
  host.refresh();
  assert.deepEqual(revisions,[current.revision]);
  unsubscribe();
  setCurrent([]);
  catalog.refresh();
  assert.deepEqual(revisions,[current.revision]);
});
