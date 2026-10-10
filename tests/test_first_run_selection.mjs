import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRST_RUN_APP_SELECTION_SCHEMA,
  listFirstRunDefaultAppIds,
  planFirstRunAppSelection,
} from "../system/services/apps/first-run-selection.mjs";
import {
  getFirstPartyAppDeliveryPolicy,
  projectFirstPartyAppDelivery,
} from "../system/services/apps/delivery-policy.mjs";

const empty = {
  initialProvisioning: true,
  installedAppIds: [],
  explicitlyRemovedAppIds: [],
  verifiedCandidateAppIds: [],
};

test("default selection references existing removable app policies without changing installed truth", () => {
  const defaults = listFirstRunDefaultAppIds();
  assert.equal(defaults.length, 15);
  assert.equal(new Set(defaults).size, defaults.length);
  assert.ok(defaults.includes("files") && defaults.includes("internet"));
  assert.ok(defaults.includes("notes") && defaults.includes("calculator"));
  for (const appId of defaults) {
    const policy = getFirstPartyAppDeliveryPolicy(appId);
    assert.ok(policy, appId);
    assert.notEqual(policy.deliveryClass, "structural", appId);
    assert.equal(policy.removable, true, appId);
    assert.equal(projectFirstPartyAppDelivery(appId, {
      installed: false, catalogued: false, transition: "idle",
      blockedReason: null, failedRetained: false,
    }).launchable, false, appId);
  }
  for (const appId of ["settings", "account", "store", "system", "studio"]) {
    assert.equal(defaults.includes(appId), false);
  }
});

test("no verified packages means no claimed default installation", () => {
  const plan = planFirstRunAppSelection(empty);
  assert.equal(plan.schema, FIRST_RUN_APP_SELECTION_SCHEMA);
  assert.deepEqual(plan.eligibleCandidateAppIds, []);
  assert.deepEqual(plan.unavailableAppIds, listFirstRunDefaultAppIds());
  assert.equal(plan.installedByThisPlan, false);
  assert.equal(plan.authority, "none");
  assert.equal(plan.mayInstallWithoutVerifiedLifecycle, false);
});

test("first provisioning considers only verified absent candidates, never previously removed apps", () => {
  const plan = planFirstRunAppSelection({
    initialProvisioning: true,
    installedAppIds: ["files"],
    explicitlyRemovedAppIds: ["notes"],
    verifiedCandidateAppIds: ["calculator", "clock", "notes", "files"],
  });
  assert.deepEqual(plan.alreadyInstalledAppIds, ["files"]);
  assert.deepEqual(plan.suppressedAppIds, ["notes"]);
  assert.deepEqual(plan.eligibleCandidateAppIds, ["calculator", "clock"]);
  assert.ok(plan.unavailableAppIds.includes("internet"));
  assert.equal(plan.reinstallAfterUserRemoval, false);
});

test("later reconnects and updates never re-run first-install recommendations", () => {
  const plan = planFirstRunAppSelection({
    ...empty,
    initialProvisioning: false,
    verifiedCandidateAppIds: listFirstRunDefaultAppIds(),
  });
  assert.deepEqual(plan.eligibleCandidateAppIds, []);
  assert.deepEqual(plan.suppressedAppIds, listFirstRunDefaultAppIds());
});

test("invalid or ambiguous authority observations fail closed", () => {
  assert.throws(() => planFirstRunAppSelection(), /initialProvisioning/);
  assert.throws(() => planFirstRunAppSelection({ ...empty, verifiedCandidateAppIds: ["notes", "notes"] }), /duplicate/);
  assert.throws(() => planFirstRunAppSelection({ ...empty, installedAppIds: ["unknown"] }), /unknown/);
  assert.throws(() => planFirstRunAppSelection({ ...empty, installedAppIds: ["notes"], explicitlyRemovedAppIds: ["notes"] }), /overlap/);
  assert.throws(() => planFirstRunAppSelection({ ...empty, verifiedCandidateAppIds: null }), /array/);
});
