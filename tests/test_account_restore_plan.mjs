import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_RESTORE_PLAN_SCHEMA,
  buildAccountRestorePlan,
} from "../system/services/sync/account-restore-plan.mjs";

const SUBJECT = "account-subject-a";

function syncObject(objectId, dataClass, overrides = {}) {
  return {
    objectId,
    dataClass,
    serverRevision: 1,
    tombstone: false,
    ...overrides,
  };
}

function memorySyncSnapshot(overrides = {}) {
  return {
    subjectId: SUBJECT,
    pendingMutationCount: 0,
    conflictCount: 0,
    revisionCount: 1,
    recoveryBlocked: false,
    ...overrides,
  };
}

test("restore plan orders portable state before authorized Memory and derived rebuild", () => {
  const plan = buildAccountRestorePlan({
    subjectId: SUBJECT,
    snapshotObjects: [
      syncObject("memory/bWVtb3J5LTE", "memory"),
      syncObject("workspace/portable", "workspace-metadata"),
      syncObject("preferences/surface", "preferences"),
      syncObject("appearance/theme", "appearance"),
    ],
    memorySyncSnapshot: memorySyncSnapshot(),
  });

  assert.equal(plan.schema, ACCOUNT_RESTORE_PLAN_SCHEMA);
  assert.deepEqual(plan.phases.map((entry) => entry.id), [
    "portable-settings-and-workspace",
    "profile-space-and-app-metadata",
    "authorized-memory",
    "rebuild-derived-local-state",
    "restore-health-check",
  ]);
  assert.deepEqual(plan.phases[0].objectIds, [
    "workspace/portable",
    "preferences/surface",
    "appearance/theme",
  ]);
  assert.deepEqual(plan.phases[2].objectIds, ["memory/bWVtb3J5LTE"]);
  assert.equal(plan.phases[2].status, "ready");
  assert.equal(plan.fullRestoreImplemented, false);
  assert.equal(plan.appliesDeviceSecrets, false);
  assert.equal(plan.grantsAuthority, false);
});

test("Memory restore fails closed when coordination recovery or conflict is unresolved", () => {
  const objects = [syncObject("memory/bWVtb3J5LTE", "memory")];

  const recoveryBlocked = buildAccountRestorePlan({
    subjectId: SUBJECT,
    snapshotObjects: objects,
    memorySyncSnapshot: memorySyncSnapshot({ recoveryBlocked: true }),
  });
  assert.equal(recoveryBlocked.foundationApplyAllowed, false);
  assert.equal(recoveryBlocked.phases[2].status, "blocked");
  assert.equal(recoveryBlocked.phases[2].reason, "memory-coordination-recovery-required");

  const conflictBlocked = buildAccountRestorePlan({
    subjectId: SUBJECT,
    snapshotObjects: objects,
    memorySyncSnapshot: memorySyncSnapshot({ conflictCount: 1 }),
  });
  assert.equal(conflictBlocked.foundationApplyAllowed, false);
  assert.equal(conflictBlocked.phases[2].reason, "memory-conflict-resolution-required");
});

test("fresh restore never overwrites local pending Memory intent", () => {
  const plan = buildAccountRestorePlan({
    subjectId: SUBJECT,
    snapshotObjects: [syncObject("memory/bWVtb3J5LTE", "memory")],
    memorySyncSnapshot: memorySyncSnapshot({ pendingMutationCount: 1 }),
  });

  assert.equal(plan.foundationApplyAllowed, false);
  assert.equal(plan.phases[2].status, "blocked");
  assert.equal(plan.phases[2].reason, "local-memory-pending-intent");
});

test("Memory objects require the subject-bound Memory sync runtime before restore", () => {
  const plan = buildAccountRestorePlan({
    subjectId: SUBJECT,
    snapshotObjects: [syncObject("memory/bWVtb3J5LTE", "memory")],
  });

  assert.equal(plan.foundationApplyAllowed, false);
  assert.equal(plan.phases[2].reason, "memory-sync-runtime-required");
});

test("unpromoted profile Space or app classes remain explicitly deferred instead of guessed", () => {
  const plan = buildAccountRestorePlan({
    subjectId: SUBJECT,
    snapshotObjects: [
      syncObject("profile/developer", "profile-metadata"),
      syncObject("space/professional", "space-metadata"),
      syncObject("app/example", "app-state-metadata"),
    ],
  });

  assert.equal(plan.deferredObjectCount, 3);
  assert.equal(plan.phases[1].status, "deferred");
  assert.equal(plan.phases[1].reason, "data-class-not-promoted-for-restore");
  assert.equal(plan.fullRestoreImplemented, false);
});

test("never-sync classes in an account snapshot abort restore planning", () => {
  for (const dataClass of [
    "device-private-keys",
    "machine-identity-secrets",
    "device-bound-credentials",
    "local-privileged-recovery-material",
    "raw-disk-state",
    "ephemeral-cache",
  ]) {
    assert.throws(
      () => buildAccountRestorePlan({
        subjectId: SUBJECT,
        snapshotObjects: [syncObject(`forbidden/${dataClass}`, dataClass)],
      }),
      /Never-sync data class reached account restore/,
    );
  }
});

test("restore planning rejects duplicate object identity and cross-account Memory runtime state", () => {
  assert.throws(
    () => buildAccountRestorePlan({
      subjectId: SUBJECT,
      snapshotObjects: [
        syncObject("appearance/theme", "appearance"),
        syncObject("appearance/theme", "preferences"),
      ],
    }),
    /duplicate object identity/,
  );

  assert.throws(
    () => buildAccountRestorePlan({
      subjectId: SUBJECT,
      snapshotObjects: [syncObject("memory/bWVtb3J5LTE", "memory")],
      memorySyncSnapshot: memorySyncSnapshot({ subjectId: "different-account" }),
    }),
    /subject does not match/,
  );
});
