import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRST_PARTY_APP_INSTALL_PLANNER_SCHEMA,
  assertFirstPartyAppInstallPlanner,
} from "../system/contracts/first-party-app-install-plan.mjs";
import { createFirstPartyAppInstallPlanner } from "../system/services/apps/install-planner.mjs";

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

function artifact(overrides = {}) {
  return {
    appId: "notes",
    version: "0.4.1",
    sha256: "a".repeat(64),
    verified: true,
    compatible: true,
    ...overrides,
  };
}

test("planner remains authority-free and exposes no install executor methods", () => {
  const planner = createFirstPartyAppInstallPlanner();
  assert.equal(planner.schema, FIRST_PARTY_APP_INSTALL_PLANNER_SCHEMA);
  assert.equal(assertFirstPartyAppInstallPlanner(planner), planner);
  for (const forbidden of [
    "fetch",
    "install",
    "stage",
    "promote",
    "rollback",
    "uninstall",
    "sign",
    "execute",
    "writeFile",
  ]) {
    assert.equal(forbidden in planner, false);
  }
});

test("known on-demand app stays blocked without a signed catalog artifact", () => {
  const planner = createFirstPartyAppInstallPlanner();
  const plan = planner.planInstall({ appId: "notes", observation: observation() });
  assert.deepEqual(plan, {
    schema: "ordax.first-party-app-install-plan/1",
    appId: "notes",
    ready: false,
    reason: "artifact-unavailable",
    artifact: null,
    authority: "none",
  });
});

test("verified compatible artifact still fails closed while production activation is blocked", () => {
  const planner = createFirstPartyAppInstallPlanner();
  const plan = planner.planInstall({
    appId: "notes",
    observation: observation(),
    artifact: artifact(),
    productionActivationAllowed: false,
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.reason, "production-activation-blocked");
  assert.equal(plan.artifact, null);
  assert.equal(plan.authority, "none");
});

test("ready plan binds exact verified compatible artifact identity only after activation policy allows it", () => {
  const planner = createFirstPartyAppInstallPlanner();
  const plan = planner.planInstall({
    appId: "notes",
    observation: observation(),
    artifact: artifact(),
    productionActivationAllowed: true,
  });
  assert.equal(plan.ready, true);
  assert.equal(plan.reason, "install-plan-ready");
  assert.equal(plan.appId, "notes");
  assert.equal(plan.artifact.version, "0.4.1");
  assert.equal(plan.artifact.sha256, "a".repeat(64));
  assert.equal(plan.authority, "none");
});

test("planner blocks installed, busy, blocked, uncatalogued and structural states", () => {
  const planner = createFirstPartyAppInstallPlanner();

  assert.equal(
    planner.planInstall({
      appId: "notes",
      observation: observation({ installed: true, catalogued: false }),
      artifact: artifact(),
      productionActivationAllowed: true,
    }).reason,
    "already-installed",
  );

  assert.equal(
    planner.planInstall({
      appId: "notes",
      observation: observation({ transition: "installing" }),
      artifact: artifact(),
      productionActivationAllowed: true,
    }).reason,
    "lifecycle-busy",
  );

  assert.equal(
    planner.planInstall({
      appId: "notes",
      observation: observation({ blockedReason: "policy" }),
      artifact: artifact(),
      productionActivationAllowed: true,
    }).reason,
    "platform-blocked",
  );

  assert.equal(
    planner.planInstall({
      appId: "notes",
      observation: observation({ catalogued: false }),
      artifact: artifact(),
      productionActivationAllowed: true,
    }).reason,
    "not-catalogued",
  );

  assert.equal(
    planner.planInstall({
      appId: "system",
      observation: observation({ installed: false, catalogued: true }),
      artifact: artifact({ appId: "system" }),
      productionActivationAllowed: true,
    }).reason,
    "policy-not-installable",
  );
});

test("planner rejects mismatched or malformed artifact identity and blocks unverified/incompatible candidates", () => {
  const planner = createFirstPartyAppInstallPlanner();

  assert.throws(
    () => planner.planInstall({
      appId: "notes",
      observation: observation(),
      artifact: artifact({ appId: "studio" }),
      productionActivationAllowed: true,
    }),
    /identity does not match/,
  );

  assert.equal(
    planner.planInstall({
      appId: "notes",
      observation: observation(),
      artifact: artifact({ verified: false }),
      productionActivationAllowed: true,
    }).reason,
    "artifact-unverified",
  );

  assert.equal(
    planner.planInstall({
      appId: "notes",
      observation: observation(),
      artifact: artifact({ compatible: false }),
      productionActivationAllowed: true,
    }).reason,
    "incompatible-artifact",
  );

  assert.throws(
    () => planner.planInstall({
      appId: "notes",
      observation: observation(),
      artifact: artifact({ sha256: "../bad" }),
      productionActivationAllowed: true,
    }),
    /sha256 is invalid/,
  );
});
