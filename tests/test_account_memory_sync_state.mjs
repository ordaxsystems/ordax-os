import assert from "node:assert/strict";
import test from "node:test";

import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { SYNC_TRANSPORT_SCHEMA } from "../system/contracts/sync-transport.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import {
  MEMORY_SYNC_STATE_SCHEMA,
  createAccountMemorySyncRuntime,
  createMemorySyncObject,
} from "../system/services/sync/account-memory-runtime.mjs";
import { createSyncStateNamespaceRegistry } from "../system/services/sync/state-store-registry.mjs";

const SUBJECT = "account-subject-a";

function memoryItem(overrides = {}) {
  return {
    id: "memory-1",
    ownerKind: "account",
    ownerId: SUBJECT,
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "estado local autorizado",
    provenance: "user-confirmed:sync-state-test",
    sourceTimestamp: "2026-09-29T12:00:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function createStateStore({ initial = null, scope = "device", saveResult = true, loadError = false } = {}) {
  let payload = initial;
  return {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope,
    load() {
      if (loadError) throw new Error("durable state unavailable");
      return payload;
    },
    save(value) {
      if (saveResult === false) return false;
      payload = value;
      return true;
    },
    read() {
      return payload;
    },
  };
}

function createTransport({ conflictRevision = null, acceptedRevision = 4 } = {}) {
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
      if (conflictRevision !== null) {
        return Object.freeze({
          objectId: mutation.objectId,
          dataClass: mutation.dataClass,
          serverRevision: conflictRevision,
          tombstone: mutation.operation === "delete",
          applied: false,
          conflict: true,
          changeCursor: null,
        });
      }
      return Object.freeze({
        objectId: mutation.objectId,
        dataClass: mutation.dataClass,
        serverRevision: acceptedRevision,
        tombstone: mutation.operation === "delete",
        applied: true,
        conflict: false,
        changeCursor: acceptedRevision,
      });
    },
  };
}

function createRuntime({
  memory = createMemoryRuntime(),
  stateStore = null,
  subjectId = SUBJECT,
} = {}) {
  let ordinal = 0;
  return createAccountMemorySyncRuntime({
    memoryPort: memory,
    subjectId,
    syncStateStore: stateStore,
    authorizeSync: () => true,
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}:state`;
    },
  });
}

test("pending Memory mutation survives sync-runtime recreation with the same idempotency identity", () => {
  const memory = createMemoryRuntime();
  const stateStore = createStateStore();
  const first = createRuntime({ memory, stateStore });
  first.remember(memoryItem());

  const before = first.pendingMutations()[0];
  assert.equal(first.getSnapshot().queuePersistence, "device");
  assert.equal(JSON.parse(stateStore.read()).$schema, MEMORY_SYNC_STATE_SCHEMA);

  const second = createRuntime({ memory, stateStore });
  const recovered = second.pendingMutations()[0];
  assert.equal(second.getSnapshot().recoveredCoordinationState, true);
  assert.equal(second.getSnapshot().recoveryBlocked, false);
  assert.equal(second.getSnapshot().pendingMutationCount, 1);
  assert.equal(recovered.objectId, before.objectId);
  assert.equal(recovered.idempotencyKey, before.idempotencyKey);
  assert.equal(recovered.baseServerRevision, before.baseServerRevision);
});

test("accepted server revision survives restart and becomes the base of the next local edit", async () => {
  const memory = createMemoryRuntime();
  const stateStore = createStateStore();
  const transport = createTransport({ acceptedRevision: 4 });
  const first = createRuntime({ memory, stateStore });
  first.remember(memoryItem({ content: "primeira versão" }));
  await first.flush(transport);
  assert.equal(first.getSnapshot().pendingMutationCount, 0);

  const second = createRuntime({ memory, stateStore });
  second.remember(memoryItem({
    content: "segunda versão",
    sourceTimestamp: "2026-09-29T12:05:00Z",
  }));
  assert.equal(second.pendingMutations()[0].baseServerRevision, 4);
});

test("server conflict remains quarantined across restart and is not retried implicitly", async () => {
  const memory = createMemoryRuntime();
  const stateStore = createStateStore();
  const conflicting = createTransport({ conflictRevision: 7 });
  const first = createRuntime({ memory, stateStore });
  first.remember(memoryItem({ content: "não sobrescrever" }));
  await first.flush(conflicting);
  assert.equal(first.getSnapshot().conflictCount, 1);
  assert.equal(conflicting.mutations.length, 1);

  const second = createRuntime({ memory, stateStore });
  assert.equal(second.getSnapshot().recoveredCoordinationState, true);
  assert.equal(second.getSnapshot().conflictCount, 1);
  assert.equal(second.pendingConflicts()[0].reason, "server-conflict");

  const retryTransport = createTransport({ acceptedRevision: 8 });
  await second.flush(retryTransport);
  assert.equal(retryTransport.mutations.length, 0, "restart must not turn a conflict into an implicit retry/rebase");
  assert.equal(second.getSnapshot().pendingMutationCount, 1);
});

test("pending forget tombstone survives restart without persisting deleted Memory content", () => {
  const memory = createMemoryRuntime();
  const stateStore = createStateStore();
  const first = createRuntime({ memory, stateStore });
  first.remember(memoryItem({ content: "conteúdo que será esquecido" }));
  first.forget({ id: "memory-1", ownerKind: "account", ownerId: SUBJECT });

  const serialized = stateStore.read();
  assert.equal(serialized.includes("conteúdo que será esquecido"), false);
  const second = createRuntime({ memory, stateStore });
  assert.equal(second.pendingMutations().length, 1);
  assert.equal(second.pendingMutations()[0].operation, "delete");
  assert.equal("memory" in second.pendingMutations()[0].payload, false);
});

test("coordination state is subject-bound and never imports another account pending queue", () => {
  const stateStore = createStateStore();
  const first = createRuntime({ stateStore });
  first.remember(memoryItem());
  assert.equal(first.getSnapshot().pendingMutationCount, 1);

  const other = createRuntime({ stateStore, subjectId: "account-subject-b" });
  assert.equal(other.getSnapshot().recoveredCoordinationState, false);
  assert.equal(other.getSnapshot().recoveryBlocked, false);
  assert.equal(other.getSnapshot().pendingMutationCount, 0);
  assert.equal(other.getSnapshot().revisionCount, 0);
});

test("account-partitioned Memory runtimes share one physical sync-state store without cross-account overwrite", () => {
  const root = createStateStore();
  const registry = createSyncStateNamespaceRegistry(root, { legacyNamespace: "appearance" });
  const storeA = registry.open("memory", { partitionKey: "account-subject-a" });
  const storeB = registry.open("memory", { partitionKey: "account-subject-b" });

  const runtimeA = createRuntime({ subjectId: "account-subject-a", stateStore: storeA });
  runtimeA.remember(memoryItem({ id: "memory-a", ownerId: "account-subject-a", content: "fila A" }));

  const runtimeB = createRuntime({ subjectId: "account-subject-b", stateStore: storeB });
  runtimeB.remember(memoryItem({ id: "memory-b", ownerId: "account-subject-b", content: "fila B" }));

  const recoveredA = createRuntime({ subjectId: "account-subject-a", stateStore: storeA });
  const recoveredB = createRuntime({ subjectId: "account-subject-b", stateStore: storeB });

  assert.equal(recoveredA.getSnapshot().recoveredCoordinationState, true);
  assert.equal(recoveredB.getSnapshot().recoveredCoordinationState, true);
  assert.equal(recoveredA.pendingMutations().length, 1);
  assert.equal(recoveredB.pendingMutations().length, 1);
  assert.equal(recoveredA.pendingMutations()[0].payload.memory.ownerId, "account-subject-a");
  assert.equal(recoveredB.pendingMutations()[0].payload.memory.ownerId, "account-subject-b");
  assert.equal(recoveredA.pendingMutations()[0].payload.memory.id, "memory-a");
  assert.equal(recoveredB.pendingMutations()[0].payload.memory.id, "memory-b");

  const container = JSON.parse(root.read());
  assert.equal(Object.keys(container.slots).length, 2);
  assert.equal(Object.keys(container.slots).some((key) => key.includes("account-subject-a")), false);
  assert.equal(Object.keys(container.slots).some((key) => key.includes("account-subject-b")), false);
});

test("persisted coordination state contains no extra token fields and store failure preserves in-session pending intent", () => {
  const durableStore = createStateStore();
  const durable = createRuntime({ stateStore: durableStore });
  durable.remember(memoryItem({ accessToken: "token-must-not-persist" }));
  assert.equal(durableStore.read().includes("token-must-not-persist"), false);
  assert.equal(durableStore.read().includes("accessToken"), false);

  const rejectingStore = createStateStore({ saveResult: false });
  const degraded = createRuntime({ stateStore: rejectingStore });
  degraded.remember(memoryItem({ id: "pending-after-save-failure" }));
  assert.equal(degraded.getSnapshot().pendingMutationCount, 1);
  assert.equal(degraded.getSnapshot().queuePersistence, "session");
  assert.equal(rejectingStore.read(), null);
});

test("malformed or secret-bearing persisted state blocks synchronization instead of becoming an empty queue", async () => {
  const validStore = createStateStore();
  const runtime = createRuntime({ stateStore: validStore });
  runtime.remember(memoryItem());
  const persisted = JSON.parse(validStore.read());
  persisted.pending[0].payload.memory.content = "Authorization: Bearer secret-token-value-123456";

  const poisonedStore = createStateStore({ initial: JSON.stringify(persisted) });
  const memory = createMemoryRuntime();
  const recovered = createRuntime({ stateStore: poisonedStore, memory });
  assert.equal(recovered.getSnapshot().recoveredCoordinationState, false);
  assert.equal(recovered.getSnapshot().recoveryBlocked, true);
  assert.equal(recovered.getSnapshot().recoveryBlockReason, "invalid-persisted-state");
  assert.equal(recovered.getSnapshot().pendingMutationCount, 0);

  const local = recovered.remember(memoryItem({ id: "local-while-recovery-blocked" }));
  assert.equal(local.sync.status, "blocked");
  assert.equal(local.sync.reason, "coordination-recovery-required");
  assert.equal(memory.search({ ownerId: SUBJECT, scopes: ["account"] }).length, 1);

  const transport = createTransport({ acceptedRevision: 9 });
  await recovered.flush(transport);
  assert.equal(transport.mutations.length, 0, "corrupt durable coordination must never fall back to revision zero upload");

  const remote = createMemorySyncObject({ item: memoryItem({ id: "remote-while-recovery-blocked" }), serverRevision: 5 });
  const result = await recovered.applyRemoteBatch([remote]);
  assert.equal(result.blocked, 1);
  assert.equal(result.applied, 0);
  assert.equal(memory.search({ ownerId: SUBJECT, scopes: ["account"] }).some((item) => item.id === "remote-while-recovery-blocked"), false);
});

test("sync-state load failure also blocks reconciliation instead of pretending there is no prior coordination", async () => {
  const stateStore = createStateStore({ loadError: true });
  const runtime = createRuntime({ stateStore });
  assert.equal(runtime.getSnapshot().recoveryBlocked, true);
  assert.equal(runtime.getSnapshot().recoveryBlockReason, "state-load-failed");

  const transport = createTransport();
  const local = runtime.remember(memoryItem({ id: "after-load-failure" }));
  assert.equal(local.sync.status, "blocked");
  await runtime.flush(transport);
  assert.equal(transport.mutations.length, 0);
});
