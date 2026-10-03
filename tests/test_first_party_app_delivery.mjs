import assert from "node:assert/strict";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import {
  getFirstPartyAppDeliveryPolicy,
  listFirstPartyAppDeliveryPolicies,
  projectFirstPartyAppDelivery,
} from "../system/services/apps/delivery-policy.mjs";

function observation(overrides = {}) {
  return {
    installed: false,
    catalogued: true,
    transition: "idle",
    blockedReason: null,
    failedRetained: false,
    ...overrides,
  };
}

test("delivery policy covers every current first-party app exactly once", () => {
  const appIds = listFirstPartyApps().map((app) => app.id).sort();
  const policyIds = listFirstPartyAppDeliveryPolicies().map((policy) => policy.appId).sort();
  assert.deepEqual(policyIds, appIds);
  assert.equal(new Set(policyIds).size, policyIds.length);
  assert.equal(getFirstPartyAppDeliveryPolicy("store"), null, "future Store UI must not be fabricated before it exists");
});

test("structural surfaces fail closed when their payload is missing", () => {
  for (const appId of ["settings", "account", "system"]) {
    const policy = getFirstPartyAppDeliveryPolicy(appId);
    assert.equal(policy.deliveryClass, "structural");
    assert.equal(policy.removable, false);

    const projection = projectFirstPartyAppDelivery(appId, observation());
    assert.equal(projection.state, "blocked");
    assert.equal(projection.reason, "structural-payload-missing");
    assert.equal(projection.launchable, false);
    assert.equal(projection.installable, false);
    assert.equal(projection.openAction, "none");
  }
});

test("bootstrap apps remain initial-image intent but removable after a real installed observation", () => {
  for (const appId of ["files", "internet"]) {
    const policy = getFirstPartyAppDeliveryPolicy(appId);
    assert.equal(policy.deliveryClass, "bootstrap");
    assert.equal(policy.removable, true);

    const installed = projectFirstPartyAppDelivery(appId, observation({ installed: true, catalogued: false }));
    assert.equal(installed.state, "installed");
    assert.equal(installed.launchable, true);
    assert.equal(installed.removable, true);
    assert.equal(installed.openAction, "launch");
    assert.equal(installed.dataRemovalRequiresSeparateAction, true);
  }
});

test("catalogued on-demand app is never treated as installed", () => {
  const assistant = projectFirstPartyAppDelivery("assistant", observation());
  assert.equal(assistant.state, "available");
  assert.equal(assistant.launchable, false);
  assert.equal(assistant.installable, true);
  assert.equal(assistant.showInLauncher, true);
  assert.equal(assistant.openAction, "show-install");
  assert.equal(assistant.authority, "none");

  const notes = projectFirstPartyAppDelivery("notes", observation());
  assert.equal(notes.state, "available");
  assert.equal(notes.launchable, false);
  assert.equal(notes.installable, true);
  assert.equal(notes.showInLauncher, false);
  assert.equal(notes.openAction, "none");
});

test("not-catalogued on-demand app is not projected as installable", () => {
  const projection = projectFirstPartyAppDelivery(
    "studio",
    observation({ catalogued: false }),
  );
  assert.equal(projection.state, "not-catalogued");
  assert.equal(projection.launchable, false);
  assert.equal(projection.installable, false);
  assert.equal(projection.showInLauncher, false);
  assert.equal(projection.openAction, "none");
});

test("staging never means activation and may retain an existing launchable version", () => {
  const firstInstall = projectFirstPartyAppDelivery(
    "assistant",
    observation({ transition: "staged" }),
  );
  assert.equal(firstInstall.state, "staged");
  assert.equal(firstInstall.launchable, false);
  assert.equal(firstInstall.installable, false);

  const update = projectFirstPartyAppDelivery(
    "assistant",
    observation({ installed: true, transition: "staged" }),
  );
  assert.equal(update.state, "staged");
  assert.equal(update.launchable, true, "last-known-good installed version stays launchable during staged update");
  assert.equal(update.openAction, "launch");
});

test("failed update can retain the previous installed app without coupling user-data deletion", () => {
  const projection = projectFirstPartyAppDelivery(
    "studio",
    observation({ installed: true, failedRetained: true }),
  );
  assert.equal(projection.state, "failed-retained");
  assert.equal(projection.launchable, true);
  assert.equal(projection.removable, true);
  assert.equal(projection.dataRemovalRequiresSeparateAction, true);
  assert.equal(projection.authority, "none");
});

test("invalid delivery observations fail closed", () => {
  assert.throws(
    () => projectFirstPartyAppDelivery("assistant", observation({ failedRetained: true })),
    /requires a known installed version/,
  );
  assert.throws(
    () => projectFirstPartyAppDelivery(
      "assistant",
      observation({ transition: "installing", blockedReason: "policy" }),
    ),
    /cannot coexist/,
  );
  assert.throws(
    () => projectFirstPartyAppDelivery("unknown", observation()),
    /Unknown first-party app delivery id/,
  );
});
