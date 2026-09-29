import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { PREFERENCE_RUNTIME_SCHEMA } from "../system/contracts/preference-runtime.mjs";
import { SYNC_CHECKPOINT_STORE_SCHEMA } from "../system/contracts/sync-checkpoint-store.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { SYNC_TRANSPORT_SCHEMA } from "../system/contracts/sync-transport.mjs";
import {
  WORKSPACE_STORE_SCHEMA,
  createDefaultWorkspaceRecord,
  validateWorkspaceRecord,
} from "../system/contracts/workspace-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createPreferenceSnapshot, setPreferenceValue } from "../system/services/preferences/catalog.mjs";
import { createAccountSyncRuntime } from "../system/services/sync/account-runtime.mjs";
import {
  createAccountMemorySyncRuntime,
  createMemorySyncObject,
} from "../system/services/sync/account-memory-runtime.mjs";
import { createPreferenceSyncRuntime } from "../system/services/sync/preference-runtime.mjs";
import { createWorkspaceMetadataBridge } from "../system/services/sync/workspace-metadata.mjs";

const SUBJECT = "restore-user-1";

function signedInIdentity() {
  const snapshot = Object.freeze({
    state: "signed-in",
    subjectId: SUBJECT,
    displayName: "Pessoa",
  });
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe() {
      return () => {};
    },
  };
}

function preferencesRuntime() {
  let snapshot = createPreferenceSnapshot();
  const listeners = new Set();
  return {
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot: () => snapshot,
    set(id, value) {
      const next = setPreferenceValue(snapshot, id, value);
      if (next === snapshot) return snapshot;
      snapshot = next;
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
    load() {
      return value;
    },
    save(next) {
      value = next;
      return true;
    },
    peek() {
      return value;
    },
  };
}

function syncStateStore() {
  let value = null;
  return {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "device",
    load() {
      return value;
    },
    save(next) {
      value = next;
      return true;
    },
  };
}

function keyFactory(prefix) {
  let ordinal = 0;
  return (kind = "state") => `${prefix}:${kind}:${++ordinal}:abcdefgh`;
}

function remoteMemory() {
  return createMemorySyncObject({
    serverRevision: 9,
    item: {
      id: "restored-memory-1",
      ownerKind: "account",
      ownerId: SUBJECT,
      scope: "account",
      kind: "fact",
      sensitivity: "private",
      content: "memória autorizada restaurada após reinstalação simulada",
      provenance: "user-confirmed:reinstall-restore-proof",
      sourceTimestamp: "2026-09-29T20:20:00Z",
      spaceId: null,
      projectId: null,
    },
  });
}

function accountSnapshotObjects() {
  return [
    {
      objectId: "appearance/theme",
      dataClass: "appearance",
      objectSchemaVersion: 1,
      resolverVersion: 1,
      serverRevision: 4,
      tombstone: false,
      payload: { theme: "dark" },
    },
    {
      objectId: "preferences/surface",
      dataClass: "preferences",
      objectSchemaVersion: 1,
      resolverVersion: 1,
      serverRevision: 5,
      tombstone: false,
      payload: {
        "accessibility.contrast": "high",
        "accessibility.motion": "reduced",
        "accessibility.text-scale": "large",
      },
    },
    {
      objectId: "workspace/portable",
      dataClass: "workspace-metadata",
      objectSchemaVersion: 1,
      resolverVersion: 1,
      serverRevision: 7,
      tombstone: false,
      payload: {
        activeAreaId: "area-2",
        areas: [
          { id: "area-1", ordinal: 1, appIds: ["files"] },
          { id: "area-2", ordinal: 2, appIds: ["settings", "internet"] },
        ],
      },
    },
    remoteMemory(),
  ];
}

test("fresh install restores promoted account state and authorized Memory from one canonical snapshot without echo", async () => {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("restore-preference"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  const memory = createMemoryRuntime();
  const memorySync = createAccountMemorySyncRuntime({
    memoryPort: memory,
    subjectId: SUBJECT,
    syncStateStore: syncStateStore(),
    authorizeSync: () => true,
    createIdempotencyKey: keyFactory("restore-memory"),
  });
  const checkpoint = checkpointStore();
  const mutations = [];
  let snapshotCalls = 0;
  let pullCalls = 0;

  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      snapshotCalls += 1;
      return Object.freeze({
        cursor: 31,
        objects: Object.freeze(accountSnapshotObjects()),
      });
    },
    async pullChanges({ afterCursor }) {
      pullCalls += 1;
      return Object.freeze({ afterCursor, nextCursor: afterCursor, changes: Object.freeze([]) });
    },
    async applyMutation(mutation) {
      mutations.push(mutation);
      throw new Error("fresh restore must not echo remote state as a local mutation");
    },
  };

  const accountSync = createAccountSyncRuntime({
    identitySession: signedInIdentity(),
    transport,
    checkpointStore: checkpoint,
    preferenceSync,
    preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    memorySync,
    createIdempotencyKey: keyFactory("restore-account"),
  });

  assert.equal(checkpoint.peek(), null, "simulated reinstall starts without a local account checkpoint");
  assert.deepEqual(memory.search({ ownerId: SUBJECT, scopes: ["account"] }), []);

  await accountSync.refresh();

  assert.equal(snapshotCalls, 1);
  assert.equal(pullCalls, 0);
  assert.equal(mutations.length, 0);
  assert.equal(checkpoint.peek().subjectId, SUBJECT);
  assert.equal(checkpoint.peek().cursor, 31);
  assert.equal(preferences.getSnapshot()["appearance.theme"], "dark");
  assert.equal(preferences.getSnapshot()["accessibility.contrast"], "high");
  assert.equal(preferences.getSnapshot()["accessibility.motion"], "reduced");
  assert.equal(preferences.getSnapshot()["accessibility.text-scale"], "large");
  assert.equal(bridge.source.getSnapshot().activeAreaId, "area-2");
  assert.deepEqual(bridge.source.getSnapshot().areas[1].appIds, ["settings", "internet"]);

  const restoredMemory = memory.search({ ownerId: SUBJECT, scopes: ["account"] });
  assert.equal(restoredMemory.length, 1);
  assert.equal(restoredMemory[0].id, "restored-memory-1");
  assert.equal(
    restoredMemory[0].content,
    "memória autorizada restaurada após reinstalação simulada",
  );
  assert.equal(memorySync.getSnapshot().pendingMutationCount, 0);
  assert.equal(memorySync.getSnapshot().conflictCount, 0);
  assert.equal(memorySync.getSnapshot().reconciliationRequiredCount, 0);
  assert.equal(memorySync.getSnapshot().ownsCursor, false);
  assert.equal(memorySync.getSnapshot().ownsTransport, false);
  assert.equal(accountSync.getSnapshot().accountContinuity, "active");

  accountSync.destroy();
  preferenceSync.destroy();
});
