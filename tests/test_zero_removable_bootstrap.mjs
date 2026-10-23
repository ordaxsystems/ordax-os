import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {listFirstPartyApps} from "../system/apps/catalog.mjs";
import {listFirstPartyAppDeliveryPolicies,getFirstPartyAppDeliveryPolicy} from "../system/services/apps/delivery-policy.mjs";
import {listFirstRunDefaultAppIds,planFirstRunAppSelection} from "../system/services/apps/first-run-selection.mjs";
import {getMvpAppDeliveryPolicy,planMvpFirstOnlineRefresh} from "../system/services/apps/mvp-delivery-policy.mjs";
const source=async p=>JSON.parse(await readFile(new URL("../"+p,import.meta.url),"utf8"));
test("all release policy projections define a clean zero-removable-app bootstrap",async()=>{
  const first=await source("docs/contracts/first-party-app-delivery.json");
  const mvp=await source("docs/contracts/mvp-app-delivery.json");
  const distribution=await source("docs/contracts/app-distribution.json");
  assert.deepEqual(listFirstPartyApps().map(a=>a.id).sort(),["account","settings","store","system"]);
  assert.deepEqual(listFirstPartyAppDeliveryPolicies().filter(x=>x.deliveryClass==="bootstrap"),[]);
  assert.deepEqual(first.current_target_policy.bootstrap,[]);
  assert.deepEqual(mvp.initial_usb.bootstrap_app_ids,[]);
  assert.deepEqual(distribution.mvp.bootstrap_app_ids,[]);
  assert.deepEqual(getMvpAppDeliveryPolicy().bundledBootstrapAppIds,[]);
  for(const id of ["files","internet","studio"]){
    assert.equal(getFirstPartyAppDeliveryPolicy(id)?.deliveryClass,"on-demand",id);
    assert.equal(mvp.initial_usb.on_demand_app_ids.includes(id),true,id);
    assert.equal(distribution.mvp.on_demand_app_ids.includes(id),true,id);
  }
});
test("first-run Store Essentials are suggestions, never installed payloads or install authority",()=>{
  assert.ok(listFirstRunDefaultAppIds().includes("internet"));
  const candidate=planFirstRunAppSelection({initialProvisioning:true,installedAppIds:[],explicitlyRemovedAppIds:[],verifiedCandidateAppIds:["internet"]});
  assert.deepEqual(candidate.eligibleCandidateAppIds,["internet"]);
  assert.deepEqual(candidate.alreadyInstalledAppIds,[]);
  assert.equal(candidate.installedByThisPlan,false);
  assert.equal(candidate.authority,"none");
  assert.deepEqual(planMvpFirstOnlineRefresh({online:true}).ensureBootstrapAppIds,[]);
  assert.deepEqual(planMvpFirstOnlineRefresh({online:false}).ensureBootstrapAppIds,[]);
  assert.equal(planMvpFirstOnlineRefresh({online:true}).onDemandAutoInstall,false);
});
