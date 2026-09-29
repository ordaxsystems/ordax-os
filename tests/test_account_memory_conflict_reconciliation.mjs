import assert from "node:assert/strict";
import test from "node:test";

import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { SYNC_TRANSPORT_SCHEMA } from "../system/contracts/sync-transport.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import {
  createAccountMemorySyncRuntime,
  createMemorySyncObject,
} from "../system/services/sync/account-memory-runtime.mjs";
import { resolveMemorySyncConflict } from "../system/services/sync/memory-conflict-resolution.mjs";

const SUBJECT = "account-subject-a";

function memoryItem(overrides = {}) {
  return {
    id: "memory-1",
    ownerKind: "account",
    ownerId: SUBJECT,
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "intenção local",
    provenance: "user-confirmed:conflict-reconciliation-test",
    sourceTimestamp: "2026-09-29T17:30:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function createStateStore(initial = null) {
  let payload = initial;
  return {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "device",
    load() {
      return payload;
    },
    save(value) {
      payload = value;
      return true;
    },
    read() {
      return payload;
    },
  };
}

function createConflictTransport() {
  const mutations = [];
  return {
    schema: SYNC_TRANSPORT_SCHEMA,
    mutations,
    async snapshot() {
      return Object.freeze({ cursor: 0, objects: Object.freeze([]) });
    },
    async pullChanges({ afterCursor }) {
      return Object.freeze({ afterCursor, nextCursor: afterCursor, changes: Object.freeze([]) });
    },
    async applyMutation(mutation) {
      mutations.push(mutation);
      return Object.freeze({
        objectId: mutation.objectId,
        dataClass: mutation.dataClass,
        serverRevision: 7,
        tombstone: mutation.operation === "delete",
        applied: false,
        conflict: true,
        changeCursor: null,
      });
    },
  };
}

function createRuntime({ memory = createMemoryRuntime(), stateStore = null } = {}) {
  let ordinal = 0;
  return {
    memory,
    runtime: createAccountMemorySyncRuntime({
      memoryPort: memory,
      subjectId: SUBJECT,
      syncStateStore: stateStore,
      authorizeSync: () => true,
      createIdempotencyKey(kind) {
        ordinal += 1;
        return `memory:${kind}:${ordinal}`;
      },
    }),
  };
}

function acceptRemote(runtime) {
  const conflict = runtime.pendingConflicts()[0];
  const pendingMutation = runtime.pendingMutations()[0];
  const resolution = resolveMemorySyncConflict({
    conflict,
    pendingMutation,
    decision: "accept-authoritative-remote",
    subjectId: SUBJECT,
  });
  return runtime.applyConflictResolution(resolution);
}

test("accept-authoritative-remote discards pending intent but keeps the object quarantined until canonical remote reconciliation", async () => {
  const transport = createConflictTransport();
  const { memory, runtime } = createRuntime();

  runtime.remember(memoryItem());
  await runtime.flush(transport);
  assert.equal(runtime.getSnapshot().pendingMutationCount, 1);
  assert.equal(runtime.getSnapshot().conflictCount, 1);

  const appliedResolution = acceptRemote(runtime);
  assert.equal(appliedResolution.status, "reconciliation-required");
  assert.equal(runtime.getSnapshot().pendingMutationCount, 0);
  assert.equal(runtime.getSnapshot().conflictCount, 1);
  assert.equal(runtime.getSnapshot().reconciliationRequiredCount, 1);
  assert.equal(runtime.pendingConflicts()[0].reason, "reconciliation-required");

  const mutationsBeforeRetry = transport.mutations.length;
  const retried = await runtime.flush(transport);
  assert.equal(retried.accepted, 0);
  assert.equal(transport.mutations.length, mutationsBeforeRetry);

  const remote = createMemorySyncObject({
    item: memoryItem({ content: "estado remoto canônico" }),
    serverRevision: 7,
  });
  const reconciled = await runtime.applyRemoteObject(remote);
  assert.equal(reconciled.status, "applied");
  assert.equal(reconciled.reason, "authoritative-remote-reconciliation");
  assert.equal(runtime.getSnapshot().conflictCount, 0);
  assert.equal(runtime.getSnapshot().reconciliationRequiredCount, 0);
  assert.equal(memory.search({ ownerKind: "account", ownerId: SUBJECT, scopes: ["account"] })[0].content, "estado remoto canônico");
});

test("reconciliation-required survives durable runtime recreation and still blocks mutation replay", async () => {
  const stateStore = createStateStore();
  const transport = createConflictTransport();
  const first = createRuntime({ stateStore });

  first.runtime.remember(memoryItem());
  await first.runtime.flush(transport);
  acceptRemote(first.runtime);

  const persisted = JSON.parse(stateStore.read());
  assert.equal(persisted.pending.length, 0);
  assert.equal(persisted.conflicts.length, 1);
  assert.equal(persisted.conflicts[0].reason, "reconciliation-required");

  const second = createRuntime({ stateStore });
  assert.equal(second.runtime.getSnapshot().recoveredCoordinationState, true);
  assert.equal(second.runtime.getSnapshot().reconciliationRequiredCount, 1);
  assert.equal(second.runtime.pendingMutations().length, 0);
  assert.equal(second.runtime.pendingConflicts()[0].reason, "reconciliation-required");

  const mutationsBeforeRetry = transport.mutations.length;
  await second.runtime.flush(transport);
  assert.equal(transport.mutations.length, mutationsBeforeRetry);
});
