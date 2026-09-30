import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { PREFERENCE_RUNTIME_SCHEMA } from "../system/contracts/preference-runtime.mjs";
import { SYNC_CHECKPOINT_STORE_SCHEMA } from "../system/contracts/sync-checkpoint-store.mjs";
import { SYNC_TRANSPORT_SCHEMA } from "../system/contracts/sync-transport.mjs";
import {
  WORKSPACE_STORE_SCHEMA,
  createDefaultWorkspaceRecord,
  validateWorkspaceRecord,
} from "../system/contracts/workspace-store.mjs";
import { createPreferenceSnapshot, setPreferenceValue } from "../system/services/preferences/catalog.mjs";
import { createPreferenceSyncRuntime } from "../system/services/sync/preference-runtime.mjs";
import { createWorkspaceMetadataBridge } from "../system/services/sync/workspace-metadata.mjs";
import { MEMORY_SYNC_RUNTIME_SCHEMA } from "../system/services/sync/account-memory-runtime.mjs";
import { NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA } from "../system/composition/native/account-memory-foundation.mjs";
import {
  createNativeAccountSyncRuntime,
  describeNativeAccountSyncComposition,
} from "../system/composition/native/account-sync.mjs";

function identitySession() {
  const snapshot = Object.freeze({ state: "signed-in", subjectId: "user-1", displayName: "Pessoa" });
  return Object.freeze({
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe() {
      return () => {};
    },
  });
}

function preferencesRuntime() {
  let snapshot = createPreferenceSnapshot();
  const listeners = new Set();
  return {
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot: () => snapshot,
    set(id, value) {
      snapshot = setPreferenceValue(snapshot, id, value);
      for (const listener of [...listeners]) listener(snapshot);
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
  };
}

function workspaceStore() {
  let snapshot = createDefaultWorkspaceRecord();
  return {
    schema: WORKSPACE_STORE_SCHEMA,
    load: () => snapshot,
    save(next) {
      snapshot = validateWorkspaceRecord(next);
      return true;
    },
  };
}

function checkpointStore() {
  let value = null;
  return {
    schema: SYNC_CHECKPOINT_STORE_SCHEMA,
    scope: "device",
    load: () => value,
    save(next) {
      value = next;
      return true;
    },
    peek: () => value,
  };
}

function keyFactory(prefix) {
  let ordinal = 0;
  return (kind = "state") => `${prefix}:${kind}:${++ordinal}:abcdefgh`;
}

function memoryFoundation(events) {
  const memorySync = Object.freeze({
    schema: MEMORY_SYNC_RUNTIME_SCHEMA,
    getSnapshot() {
      return Object.freeze({
        schema: MEMORY_SYNC_RUNTIME_SCHEMA,
        subjectId: "user-1",
        pendingMutationCount: 0,
        conflictCount: 0,
        revisionCount: 0,
        queuePersistence: "device",
        recoveredCoordinationState: false,
        recoveryBlocked: false,
        recoveryBlockReason: null,
        reconciliationOwnership: "account-runtime",
        ownsCursor: false,
        ownsTransport: false,
        liveClientIntegration: false,
        productionPromoted: false,
      });
    },
    async applyRemoteBatch(values) {
      events.push(["remote", values]);
      return Object.freeze({ applied: values.length, ignored: 0, rejected: 0, blocked: 0 });
    },
    async flush(transport) {
      events.push(["flush", transport.schema]);
      return Object.freeze({ accepted: 0, failures: 0 });
    },
  });
  return Object.freeze({
    schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
    memorySync,
  });
}

function remoteMemoryTransport() {
  return Object.freeze({
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      return Object.freeze({
        cursor: 9,
        objects: [Object.freeze({
          objectId: "memory/remote-a",
          dataClass: "memory",
          objectSchemaVersion: 1,
          resolverVersion: 1,
          serverRevision: 3,
          tombstone: false,
          payload: Object.freeze({ memory: Object.freeze({ id: "remote-a" }) }),
        })],
      });
    },
    async pullChanges({ afterCursor }) {
      return Object.freeze({ afterCursor, nextCursor: afterCursor, changes: [] });
    },
    async applyMutation(value) {
      return Object.freeze({
        $schema: "prototype-ordax.sync-ack/1",
        objectId: value.objectId,
        dataClass: value.dataClass,
        serverRevision: value.baseServerRevision + 1,
        tombstone: false,
        applied: true,
        conflict: false,
      });
    },
  });
}

function createSyncHarness({ foundation, transport = remoteMemoryTransport() }) {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("pref"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  const checkpoint = checkpointStore();
  const sync = createNativeAccountSyncRuntime({
    accountMemoryFoundation: foundation,
    identitySession: identitySession(),
    transport,
    checkpointStore: checkpoint,
    preferenceSync,
    preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    createIdempotencyKey: keyFactory("account"),
  });
  return Object.freeze({
    sync,
    checkpoint,
    destroy() {
      sync.destroy();
      preferenceSync.destroy();
    },
  });
}

test("Native account sync accepts Memory only from the canonical foundation", async () => {
  const events = [];
  const foundation = memoryFoundation(events);
  const harness = createSyncHarness({ foundation });

  await harness.sync.refresh();

  assert.equal(events[0][0], "remote");
  assert.equal(events[0][1][0].dataClass, "memory");
  assert.equal(events.some(([kind]) => kind === "flush"), true);
  assert.equal(harness.sync.getSnapshot().trackedDataClasses.includes("memory"), true);
  assert.equal(describeNativeAccountSyncComposition(foundation).memorySyncWired, true);
  assert.equal(describeNativeAccountSyncComposition(foundation).publicCloudMemoryEnabled, false);

  harness.destroy();
});

test("Native account sync refuses to advance a checkpoint across remote Memory without a reconciler", async () => {
  const foundation = Object.freeze({
    schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
    memorySync: null,
  });
  const harness = createSyncHarness({ foundation });

  assert.equal(harness.checkpoint.peek(), null);
  await harness.sync.refresh();

  assert.equal(harness.checkpoint.peek(), null);
  assert.equal(harness.sync.getSnapshot().accountContinuity, "not-active");
  assert.equal(harness.sync.getSnapshot().trackedDataClasses.includes("memory"), false);
  assert.equal(describeNativeAccountSyncComposition(foundation).remoteMemoryWithoutReconciler, "fail-closed");

  harness.destroy();
});

test("Native account sync rejects ad-hoc Memory providers", () => {
  assert.throws(
    () => createNativeAccountSyncRuntime({ accountMemoryFoundation: { schema: "fake", memorySync: {} } }),
    /canonical Account Memory foundation/,
  );
});

test("Native account sync remains valid without Account Memory foundation", () => {
  const snapshot = describeNativeAccountSyncComposition(null);
  assert.equal(snapshot.memorySyncWired, false);
  assert.equal(snapshot.memorySyncSource, "none");
  assert.equal(snapshot.remoteMemoryWithoutReconciler, "fail-closed");
  assert.equal(snapshot.publicCloudMemoryEnabled, false);
});
