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
import { resolveMemorySyncConflict } from "../system/services/sync/memory-conflict-resolution.mjs";
import { createPreferenceSyncRuntime } from "../system/services/sync/preference-runtime.mjs";
import { createWorkspaceMetadataBridge } from "../system/services/sync/workspace-metadata.mjs";

const SUBJECT = "user-1";

function signedInIdentity(subjectId = SUBJECT) {
  const snapshot = Object.freeze({ state: "signed-in", subjectId, displayName: "Pessoa" });
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

function keyFactory(prefix) {
  let ordinal = 0;
  return (kind = "state") => `${prefix}:${kind}:${++ordinal}:abcdefgh`;
}

function checkpointStore(initial = null) {
  let value = initial;
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

function memoryItem(overrides = {}) {
  return {
    id: "memory-orchestrated-1",
    ownerKind: "account",
    ownerId: SUBJECT,
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "memória restaurada pelo account runtime",
    provenance: "user-confirmed:orchestration-test",
    sourceTimestamp: "2026-09-29T12:20:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function createMemorySync({ subjectId = SUBJECT, authorizeSync = () => true } = {}) {
  const memory = createMemoryRuntime();
  const memorySync = createAccountMemorySyncRuntime({
    memoryPort: memory,
    subjectId,
    syncStateStore: syncStateStore(),
    authorizeSync,
    createIdempotencyKey: keyFactory("memory"),
  });
  return { memory, memorySync };
}

function transport({ snapshotObjects = [], pullChanges = [], nextCursor = 0, onMutation = null } = {}) {
  const mutations = [];
  let revision = 20;
  return {
    schema: SYNC_TRANSPORT_SCHEMA,
    mutations,
    snapshotCalls: 0,
    pullCalls: 0,
    async snapshot() {
      this.snapshotCalls += 1;
      return Object.freeze({ cursor: nextCursor, objects: Object.freeze(snapshotObjects) });
    },
    async pullChanges({ afterCursor }) {
      this.pullCalls += 1;
      return Object.freeze({
        afterCursor,
        nextCursor,
        changes: Object.freeze(pullChanges),
      });
    },
    async applyMutation(mutation) {
      mutations.push(mutation);
      if (onMutation) return onMutation(mutation);
      revision = Math.max(revision + 1, mutation.baseServerRevision + 1);
      return Object.freeze({
        objectId: mutation.objectId,
        dataClass: mutation.dataClass,
        serverRevision: revision,
        tombstone: mutation.operation === "delete",
        applied: true,
        conflict: false,
        changeCursor: revision,
      });
    },
  };
}

function createAccountHarness({
  memorySync,
  remote,
  checkpoint = checkpointStore(),
  identity = signedInIdentity(),
} = {}) {
  const preferences = preferencesRuntime();
  const preferenceSync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: keyFactory("preference"),
  });
  const bridge = createWorkspaceMetadataBridge(workspaceStore());
  const accountSync = createAccountSyncRuntime({
    identitySession: identity,
    transport: remote,
    checkpointStore: checkpoint,
    preferenceSync,
    preferences,
    workspaceMetadataSource: bridge.source,
    workspaceStore: bridge.store,
    memorySync,
    createIdempotencyKey: keyFactory("account"),
  });
  return {
    accountSync,
    preferenceSync,
    destroy() {
      accountSync.destroy();
      preferenceSync.destroy();
    },
  };
}

function existingCheckpoint(cursor = 10) {
  return {
    subjectId: SUBJECT,
    cursor,
    revisions: {
      "appearance/theme": 0,
      "preferences/surface": 0,
      "workspace/portable": 0,
    },
  };
}

test("canonical account snapshot dispatches Memory without giving Memory its own cursor or transport", async () => {
  const { memory, memorySync } = createMemorySync();
  const remoteMemory = createMemorySyncObject({ item: memoryItem(), serverRevision: 4 });
  const remote = transport({ snapshotObjects: [remoteMemory], nextCursor: 12 });
  const checkpoint = checkpointStore();
  const harness = createAccountHarness({ memorySync, remote, checkpoint });

  await harness.accountSync.refresh();

  assert.equal(memory.search({ ownerId: SUBJECT, scopes: ["account"] })[0].id, "memory-orchestrated-1");
  assert.equal(checkpoint.peek().cursor, 12);
  assert.equal(memorySync.getSnapshot().ownsCursor, false);
  assert.equal(memorySync.getSnapshot().ownsTransport, false);
  assert.deepEqual(harness.accountSync.getSnapshot().trackedDataClasses, [
    "appearance",
    "preferences",
    "workspace-metadata",
    "memory",
  ]);
  assert.equal(harness.accountSync.getSnapshot().accountContinuity, "active");

  harness.destroy();
});

test("incremental account pull applies Memory before advancing the canonical account cursor", async () => {
  const { memory, memorySync } = createMemorySync();
  const remoteMemory = createMemorySyncObject({
    item: memoryItem({ id: "incremental-memory" }),
    serverRevision: 8,
  });
  const remote = transport({ pullChanges: [remoteMemory], nextCursor: 11 });
  const checkpoint = checkpointStore(existingCheckpoint(10));
  const harness = createAccountHarness({ memorySync, remote, checkpoint });

  await harness.accountSync.refresh();

  assert.equal(remote.snapshotCalls, 0);
  assert.equal(remote.pullCalls, 1);
  assert.equal(memory.search({ ownerId: SUBJECT, scopes: ["account"] })[0].id, "incremental-memory");
  assert.equal(checkpoint.peek().cursor, 11);

  harness.destroy();
});

test("blocked Memory remote state prevents canonical cursor advancement instead of being skipped", async () => {
  const { memory, memorySync } = createMemorySync({ authorizeSync: () => false });
  const remoteMemory = createMemorySyncObject({ item: memoryItem(), serverRevision: 8 });
  const remote = transport({ pullChanges: [remoteMemory], nextCursor: 11 });
  const checkpoint = checkpointStore(existingCheckpoint(10));
  const harness = createAccountHarness({ memorySync, remote, checkpoint });

  const result = await harness.accountSync.refresh();

  assert.equal(result.accountContinuity, "not-active");
  assert.equal(checkpoint.peek().cursor, 10);
  assert.deepEqual(memory.search({ ownerId: SUBJECT, scopes: ["account"] }), []);

  harness.destroy();
});

test("unresolved Memory conflict prevents canonical cursor advancement", async () => {
  const { memory, memorySync } = createMemorySync();
  memorySync.remember(memoryItem({ content: "intenção local pendente" }));
  const remoteMemory = createMemorySyncObject({
    item: memoryItem({
      content: "alteração remota concorrente",
      sourceTimestamp: "2026-09-29T12:21:00Z",
    }),
    serverRevision: 8,
  });
  const remote = transport({ pullChanges: [remoteMemory], nextCursor: 11 });
  const checkpoint = checkpointStore(existingCheckpoint(10));
  const harness = createAccountHarness({ memorySync, remote, checkpoint });

  const result = await harness.accountSync.refresh();

  assert.equal(result.accountContinuity, "not-active");
  assert.equal(checkpoint.peek().cursor, 10);
  assert.equal(memorySync.getSnapshot().conflictCount, 1);
  assert.equal(memorySync.getSnapshot().pendingMutationCount, 1);
  assert.equal(memory.search({ ownerId: SUBJECT, scopes: ["account"] })[0].content, "intenção local pendente");

  harness.destroy();
});

test("accepting authoritative Memory keeps the canonical cursor blocked until that remote state is consumed", async () => {
  const { memory, memorySync } = createMemorySync();
  memorySync.remember(memoryItem({ content: "intenção local pendente" }));
  const remoteMemory = createMemorySyncObject({
    item: memoryItem({
      content: "estado remoto autoritativo",
      sourceTimestamp: "2026-09-29T12:22:00Z",
    }),
    serverRevision: 8,
  });
  const remote = transport({ pullChanges: [remoteMemory], nextCursor: 11 });
  const checkpoint = checkpointStore(existingCheckpoint(10));
  const harness = createAccountHarness({ memorySync, remote, checkpoint });

  const conflicted = await harness.accountSync.refresh();
  assert.equal(conflicted.accountContinuity, "not-active");
  assert.equal(checkpoint.peek().cursor, 10);

  const resolution = resolveMemorySyncConflict({
    conflict: memorySync.pendingConflicts()[0],
    pendingMutation: memorySync.pendingMutations()[0],
    decision: "accept-authoritative-remote",
    subjectId: SUBJECT,
  });
  const accepted = memorySync.applyConflictResolution(resolution);
  assert.equal(accepted.status, "reconciliation-required");
  assert.equal(memorySync.getSnapshot().reconciliationRequiredCount, 1);
  assert.equal(memorySync.getSnapshot().pendingMutationCount, 0);

  const canonicalPull = remote.pullChanges.bind(remote);
  remote.pullChanges = async ({ afterCursor }) => {
    remote.pullCalls += 1;
    return Object.freeze({
      afterCursor,
      nextCursor: 11,
      changes: Object.freeze([]),
    });
  };

  const stillBlocked = await harness.accountSync.refresh();
  assert.equal(stillBlocked.accountContinuity, "not-active");
  assert.equal(checkpoint.peek().cursor, 10);
  assert.equal(memorySync.getSnapshot().reconciliationRequiredCount, 1);
  assert.equal(memory.search({ ownerId: SUBJECT, scopes: ["account"] })[0].content, "intenção local pendente");

  remote.pullChanges = canonicalPull;
  const reconciled = await harness.accountSync.refresh();
  assert.equal(reconciled.accountContinuity, "active");
  assert.equal(checkpoint.peek().cursor, 11);
  assert.equal(memorySync.getSnapshot().conflictCount, 0);
  assert.equal(memorySync.getSnapshot().reconciliationRequiredCount, 0);
  assert.equal(memory.search({ ownerId: SUBJECT, scopes: ["account"] })[0].content, "estado remoto autoritativo");

  harness.destroy();
});

test("pending Memory mutation flushes through the exact transport owned by the account runtime", async () => {
  const { memorySync } = createMemorySync();
  memorySync.remember(memoryItem({ id: "outbound-memory", content: "alteração offline" }));
  assert.equal(memorySync.getSnapshot().pendingMutationCount, 1);

  const remote = transport({ nextCursor: 10 });
  const checkpoint = checkpointStore(existingCheckpoint(10));
  const harness = createAccountHarness({ memorySync, remote, checkpoint });

  await harness.accountSync.refresh();

  const outbound = remote.mutations.filter((mutation) => mutation.dataClass === "memory");
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].payload.memory.id, "outbound-memory");
  assert.equal(memorySync.getSnapshot().pendingMutationCount, 0);
  assert.equal(memorySync.getSnapshot().ownsTransport, false);

  harness.destroy();
});

test("account and Memory subject mismatch fails closed before remote reconciliation", async () => {
  const { memorySync } = createMemorySync({ subjectId: "different-account" });
  const remote = transport({ nextCursor: 10 });
  const checkpoint = checkpointStore(existingCheckpoint(10));
  const harness = createAccountHarness({ memorySync, remote, checkpoint });

  await assert.rejects(
    () => harness.accountSync.refresh(),
    /subject does not match the active account/,
  );
  assert.equal(remote.snapshotCalls, 0);
  assert.equal(remote.pullCalls, 0);
  assert.equal(checkpoint.peek().cursor, 10);

  harness.destroy();
});
