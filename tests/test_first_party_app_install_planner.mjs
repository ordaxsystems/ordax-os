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
    releaseSchema: "prototype-ordax.runtime-component-release/2",
    releaseMode: "component-slot",
    sourceRepository: "washingtonmsdj/ordax-apps",
    sourceCommit: "1".repeat(40),
    releaseEnvelopeSha256: "a".repeat(64),
    packageSha256: "b".repeat(64),
    compatibilitySha256: "c".repeat(64),
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

test("caller-supplied production activation flag cannot mint a ready plan", () => {
  const planner = createFirstPartyAppInstallPlanner();
  const plan = planner.planInstall({
    appId: "notes",
    observation: observation(),
    artifact: artifact(),
    productionActivationAllowed: true,
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.reason, "production-activation-blocked");
  assert.equal(plan.artifact, null);
  assert.equal(plan.authority, "none");
});

test("planner blocks installed, busy, blocked, uncatalogued and structural states", () => {
  const planner = createFirstPartyAppInstallPlanner();

  assert.equal(
    planner.planInstall({
      appId: "notes",
      observation: observation({ installed: true, catalogued: false }),
      artifact: artifact(),
    }).reason,
    "already-installed",
  );

  assert.equal(
    planner.planInstall({
      appId: "notes",
      observation: observation({ transition: "installing" }),
      artifact: artifact(),
    }).reason,
    "lifecycle-busy",
  );

  assert.equal(
    planner.planInstall({
      appId: "notes",
      observation: observation({ blockedReason: "policy" }),
      artifact: artifact(),
    }).reason,
    "platform-blocked",
  );

  assert.equal(
    planner.planInstall({
      appId: "notes",
      observation: observation({ catalogued: false }),
      artifact: artifact(),
    }).reason,
    "not-catalogued",
  );

  assert.equal(
    planner.planInstall({
      appId: "system",
      observation: observation({ installed: false, catalogued: true }),
      artifact: artifact({ appId: "system" }),
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
    }),
    /identity does not match/,
  );

  assert.equal(
    planner.planInstall({
      appId: "notes",
      observation: observation(),
      artifact: artifact({ verified: false }),
    }).reason,
    "artifact-unverified",
  );

  assert.equal(
    planner.planInstall({
      appId: "notes",
      observation: observation(),
      artifact: artifact({ compatible: false }),
    }).reason,
    "incompatible-artifact",
  );

  assert.throws(
    () => planner.planInstall({
      appId: "notes",
      observation: observation(),
      artifact: artifact({ packageSha256: "../bad" }),
    }),
    /package sha256 is invalid/,
  );
});

test("planner artifact reference is bound to runtime-component release v2 identity", () => {
  const planner = createFirstPartyAppInstallPlanner();

  for (const overrides of [
    { releaseSchema: "prototype-ordax.runtime-component-release/1" },
    { releaseMode: "git-app" },
    { sourceRepository: "../private" },
    { sourceCommit: "not-a-commit" },
    { releaseEnvelopeSha256: "d".repeat(63) },
    { compatibilitySha256: "e".repeat(63) },
  ]) {
    assert.throws(
      () => planner.planInstall({
        appId: "notes",
        observation: observation(),
        artifact: artifact(overrides),
      }),
      /install artifact/,
    );
  }
});
