import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRST_RUN_APP_SELECTION_SCHEMA,
  listFirstRunDefaultAppIds,
  planFirstRunAppSelection,
  planFirstRunAppSelectionFromStore,
} from "../system/services/apps/first-run-selection.mjs";
import { APP_STORE_CATALOG_SCHEMA, validateAppStoreCatalogSnapshot } from "../system/contracts/app-store.mjs";
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
  assert.equal(defaults.length, 16);
  assert.equal(new Set(defaults).size, defaults.length);
  assert.ok(defaults.includes("files") && defaults.includes("internet"));
  assert.ok(defaults.includes("assistant"), "Aura is selected using its existing app id");
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

function storeEntry(appId, overrides = {}) {
  return {
    appId, title: appId, state: "available", installedVersion: null,
    availableVersion: "0.2.0", installable: true, updatable: false,
    removable: false, blockedReason: null, artifactIdentityVerified: true,
    provenanceVerified: true, ...overrides,
  };
}

function storeSnapshot(entries, state = "ready") {
  return validateAppStoreCatalogSnapshot({
    schema: APP_STORE_CATALOG_SCHEMA, state, entries,
    reason: state === "ready" ? null : "catalog-envelope-unavailable",
    authority: "none",
  });
}

function nativeCurrent(appId, source, overrides = {}) {
  return {
    componentId: appId, state: "current", source, revision: 3,
    version: source === "slot" ? "0.4.3" : null,
    sourceCommit: source === "slot" ? "a".repeat(40) : null,
    entrypoint: source === "slot" ? `system/apps/${appId}/src/runtime.mjs` : null,
    pendingHealth: null, ...overrides,
  };
}

test("Store-backed first-run selection uses only actual verified current-slot and installable candidates", () => {
  const current = storeSnapshot([
    storeEntry("notes", {
      state: "installed", installedVersion: "0.4.3",
      availableVersion: null, installable: false, removable: true,
      artifactIdentityVerified: false, provenanceVerified: false,
    }),
    storeEntry("calculator"),
    storeEntry("clock", {
      state: "blocked", installable: false,
      blockedReason: "runtime-module-read-unavailable",
    }),
    storeEntry("studio"),
  ]);
  const plan = planFirstRunAppSelectionFromStore({
    initialProvisioning: true,
    explicitlyRemovedAppIds: [],
    storeCatalogSnapshot: current,
    nativeCurrentMetadata: [
      nativeCurrent("notes", "slot"),
      nativeCurrent("calculator", "absent"),
      nativeCurrent("clock", "removed"),
    ],
  });
  assert.deepEqual(plan.alreadyInstalledAppIds, ["notes"]);
  assert.deepEqual(plan.eligibleCandidateAppIds, ["calculator"]);
  assert.deepEqual(plan.suppressedAppIds, ["clock"]);
  assert.ok(plan.unavailableAppIds.includes("files"), "bundled OS app absent from this Store projection is unknown, not installed");
  assert.equal(plan.defaultAppIds.includes("studio"), false);
  assert.equal(plan.authority, "none");
  assert.equal(plan.installedByThisPlan, false);
});

test("Aura default candidate is selected only with verified Native absence; removal is respected", () => {
  const catalog = storeSnapshot([storeEntry("assistant", {
    availableVersion: "0.1.2",
  })]);
  const candidate = planFirstRunAppSelectionFromStore({
    initialProvisioning: true,
    explicitlyRemovedAppIds: [],
    storeCatalogSnapshot: catalog,
    nativeCurrentMetadata: [nativeCurrent("assistant", "absent")],
  });
  assert.ok(candidate.eligibleCandidateAppIds.includes("assistant"));
  assert.equal(candidate.installedByThisPlan, false);
  assert.equal(candidate.authority, "none");

  const withoutProof = planFirstRunAppSelectionFromStore({
    initialProvisioning: true,
    explicitlyRemovedAppIds: [],
    storeCatalogSnapshot: catalog,
  });
  assert.ok(withoutProof.unavailableAppIds.includes("assistant"));
  assert.ok(!withoutProof.eligibleCandidateAppIds.includes("assistant"));

  const userRemoved = planFirstRunAppSelectionFromStore({
    initialProvisioning: true,
    explicitlyRemovedAppIds: [],
    storeCatalogSnapshot: catalog,
    nativeCurrentMetadata: [nativeCurrent("assistant", "removed")],
  });
  assert.ok(userRemoved.suppressedAppIds.includes("assistant"));
  assert.ok(!userRemoved.eligibleCandidateAppIds.includes("assistant"));

  const afterFirstRun = planFirstRunAppSelectionFromStore({
    initialProvisioning: false,
    explicitlyRemovedAppIds: [],
    storeCatalogSnapshot: catalog,
    nativeCurrentMetadata: [nativeCurrent("assistant", "absent")],
  });
  assert.ok(afterFirstRun.suppressedAppIds.includes("assistant"));
  assert.ok(!afterFirstRun.eligibleCandidateAppIds.includes("assistant"));
});

test("Store displayed installedVersion never substitutes Native current-slot proof", () => {
  const ready = storeSnapshot([
    storeEntry("notes", {
      state: "installed", installedVersion: "0.4.3",
      availableVersion: null, installable: false, removable: true,
      artifactIdentityVerified: false, provenanceVerified: false,
    }),
  ]);
  const base = {
    initialProvisioning: true,
    explicitlyRemovedAppIds: [],
    storeCatalogSnapshot: ready,
  };
  const withoutNative = planFirstRunAppSelectionFromStore(base);
  assert.deepEqual(withoutNative.alreadyInstalledAppIds, []);
  assert.ok(withoutNative.unavailableAppIds.includes("notes"));
  assert.ok(!withoutNative.eligibleCandidateAppIds.includes("notes"));
  assert.equal(withoutNative.installedByThisPlan, false);

  const matching = planFirstRunAppSelectionFromStore({
    ...base, nativeCurrentMetadata: [nativeCurrent("notes", "slot")],
  });
  assert.deepEqual(matching.alreadyInstalledAppIds, ["notes"]);

  const staleVersion = planFirstRunAppSelectionFromStore({
    ...base,
    nativeCurrentMetadata: [nativeCurrent("notes", "slot", { version: "0.5.0" })],
  });
  assert.deepEqual(staleVersion.alreadyInstalledAppIds, []);
  assert.ok(staleVersion.unavailableAppIds.includes("notes"));
  assert.equal(staleVersion.eligibleCandidateAppIds.includes("notes"), false);

  const removed = planFirstRunAppSelectionFromStore({
    ...base, nativeCurrentMetadata: [nativeCurrent("notes", "removed")],
  });
  assert.deepEqual(removed.alreadyInstalledAppIds, []);
  assert.ok(removed.suppressedAppIds.includes("notes"), "verified removal wins over a stale Store entry");
  assert.equal(removed.eligibleCandidateAppIds.includes("notes"), false);

  const absent = planFirstRunAppSelectionFromStore({
    ...base, nativeCurrentMetadata: [nativeCurrent("notes", "absent")],
  });
  assert.deepEqual(absent.alreadyInstalledAppIds, []);
  assert.ok(absent.unavailableAppIds.includes("notes"), "Store installed claim is not a verified install candidate");
});

test("Store-backed selection cannot install when catalog is unavailable, candidate blocked, or provisioning ended", () => {
  const unavailable = storeSnapshot([], "unavailable");
  const noCatalog = planFirstRunAppSelectionFromStore({
    initialProvisioning: true, explicitlyRemovedAppIds: [],
    storeCatalogSnapshot: unavailable,
  });
  assert.deepEqual(noCatalog.eligibleCandidateAppIds, []);
  assert.deepEqual(noCatalog.unavailableAppIds, listFirstRunDefaultAppIds());
  const ready = storeSnapshot([storeEntry("calculator")]);
  const disabled = planFirstRunAppSelectionFromStore({
    initialProvisioning: false, explicitlyRemovedAppIds: [],
    storeCatalogSnapshot: ready,
  });
  assert.deepEqual(disabled.eligibleCandidateAppIds, []);
  assert.deepEqual(disabled.suppressedAppIds, listFirstRunDefaultAppIds());
  assert.throws(() => planFirstRunAppSelectionFromStore({
    initialProvisioning: true, explicitlyRemovedAppIds: [],
    storeCatalogSnapshot: { ...ready, authority: "platform" },
  }), /authority:none/);
  assert.throws(() => planFirstRunAppSelectionFromStore({
    initialProvisioning: true, explicitlyRemovedAppIds: ["notes", "notes"],
    storeCatalogSnapshot: ready,
  }), /duplicate/);
});

test("Store alone cannot auto-install a user-removed app offered for voluntary reinstall", () => {
  const ready = storeSnapshot([storeEntry("notes"), storeEntry("calculator")]);
  const noNativeProof = planFirstRunAppSelectionFromStore({
    initialProvisioning: true, explicitlyRemovedAppIds: [],
    storeCatalogSnapshot: ready,
  });
  assert.deepEqual(noNativeProof.eligibleCandidateAppIds, []);
  assert.ok(noNativeProof.unavailableAppIds.includes("notes"));
  const removed = planFirstRunAppSelectionFromStore({
    initialProvisioning: true, explicitlyRemovedAppIds: [],
    storeCatalogSnapshot: ready,
    nativeCurrentMetadata: [
      nativeCurrent("notes", "removed"),
      nativeCurrent("calculator", "absent"),
    ],
  });
  assert.deepEqual(removed.eligibleCandidateAppIds, ["calculator"]);
  assert.ok(removed.suppressedAppIds.includes("notes"));
  assert.ok(!removed.eligibleCandidateAppIds.includes("notes"));
  assert.equal(removed.reinstallAfterUserRemoval, false);
});

test("Native metadata for defaults must be exact, unique and compatible with Store installed state", () => {
  const ready = storeSnapshot([storeEntry("notes")]);
  const options = {
    initialProvisioning: true,
    explicitlyRemovedAppIds: [],
    storeCatalogSnapshot: ready,
  };
  assert.throws(() => planFirstRunAppSelectionFromStore({
    ...options, nativeCurrentMetadata: [nativeCurrent("notes", "removed", { entrypoint: "x" })],
  }), /inconsistent/);
  assert.throws(() => planFirstRunAppSelectionFromStore({
    ...options, nativeCurrentMetadata: [nativeCurrent("notes", "absent"), nativeCurrent("notes", "absent")],
  }), /duplicate/);
  assert.throws(() => planFirstRunAppSelectionFromStore({
    ...options, nativeCurrentMetadata: [nativeCurrent("unknown", "absent")],
  }), /unknown/);
  assert.throws(() => planFirstRunAppSelectionFromStore({
    ...options, nativeCurrentMetadata: null,
  }), /bounded Native observation array/);
});
