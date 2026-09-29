import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { SYNC_TRANSPORT_SCHEMA } from "../system/contracts/sync-transport.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createAccountMemorySessionRuntime } from "../system/services/sync/account-memory-session-runtime.mjs";

function identitySession() {
  const snapshot = { state: "signed-in", subjectId: "account-a", displayName: "A" };
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
  };
}

function stateStore() {
  let payload = null;
  return {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "session",
    load: () => payload,
    save(value) {
      payload = value;
      return true;
    },
  };
}

function item(overrides = {}) {
  return {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "portable memory awaiting transport",
    provenance: "user-confirmed:transport-authorization-test",
    sourceTimestamp: "2026-09-29T23:00:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function transport() {
  const mutations = [];
  return {
    schema: SYNC_TRANSPORT_SCHEMA,
    mutations,
    async snapshot() {
      return { cursor: 0, objects: [] };
    },
    async pullChanges({ afterCursor }) {
      return { afterCursor, nextCursor: afterCursor, changes: [] };
    },
    async applyMutation(mutation) {
      mutations.push(mutation);
      return {
        objectId: mutation.objectId,
        dataClass: mutation.dataClass,
        serverRevision: 1,
        tombstone: mutation.operation === "delete",
        applied: true,
        conflict: false,
        changeCursor: 1,
      };
    },
  };
}

function createSession({ memory = createMemoryRuntime(), authorizeSync } = {}) {
  let ordinal = 0;
  return createAccountMemorySessionRuntime({
    identitySession: identitySession(),
    memoryPort: memory,
    createSyncStateStore: () => stateStore(),
    authorizeSync,
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}:transport-boundary`;
    },
  });
}

test("a pending upsert is not transported after authorization is revoked", async () => {
  let allowed = true;
  const descriptors = [];
  const memory = createMemoryRuntime();
  const current = memory.remember(item());
  const session = createSession({
    memory,
    authorizeSync(descriptor) {
      descriptors.push(descriptor);
      return allowed;
    },
  });
  const remote = transport();

  const staged = session.stageUpsert(current);
  assert.equal(staged.status, "pending");
  assert.equal(session.pendingMutations().length, 1);

  allowed = false;
  const blocked = await session.flush(remote);
  assert.equal(blocked.accepted, 0);
  assert.equal(blocked.failures, 1);
  assert.equal(remote.mutations.length, 0, "revoked authorization must stop the mutation before transport");
  assert.equal(session.pendingMutations().length, 1, "blocked mutation must remain durable for an authorized retry");

  const transportDescriptor = descriptors.at(-1);
  assert.equal(transportDescriptor.subjectId, "account-a");
  assert.equal(transportDescriptor.dataClass, "memory");
  assert.equal(transportDescriptor.operation, "upsert");
  assert.equal(transportDescriptor.item.id, "memory-a");

  allowed = true;
  const retried = await session.flush(remote);
  assert.equal(retried.accepted, 1);
  assert.equal(retried.failures, 0);
  assert.equal(remote.mutations.length, 1);
  assert.equal(session.pendingMutations().length, 0);
});

test("an old portable upsert cannot leave the device after the local item becomes restricted", async () => {
  const memory = createMemoryRuntime();
  const portable = memory.remember(item());
  const session = createSession({ memory, authorizeSync: () => true });
  const remote = transport();

  assert.equal(session.stageUpsert(portable).status, "pending");
  memory.remember(item({
    sensitivity: "restricted",
    content: "now restricted and local only",
    sourceTimestamp: "2026-09-29T23:01:00Z",
  }));

  const result = await session.flush(remote);
  assert.equal(result.accepted, 0);
  assert.equal(result.failures, 1);
  assert.equal(remote.mutations.length, 0, "stale portable payload must never cross the transport boundary");
  assert.equal(session.pendingMutations().length, 1, "stale intent remains quarantined until local coordination resolves it");
});

test("an old upsert cannot overwrite a newer portable local edit", async () => {
  const memory = createMemoryRuntime();
  const original = memory.remember(item());
  const session = createSession({ memory, authorizeSync: () => true });
  const remote = transport();

  assert.equal(session.stageUpsert(original).status, "pending");
  memory.remember(item({
    content: "newer local edit",
    sourceTimestamp: "2026-09-29T23:02:00Z",
  }));

  const result = await session.flush(remote);
  assert.equal(result.accepted, 0);
  assert.equal(result.failures, 1);
  assert.equal(remote.mutations.length, 0);
});

test("delete mutations are reauthorized with identity-only payload after the local item is gone", async () => {
  let allowed = true;
  const descriptors = [];
  const memory = createMemoryRuntime();
  memory.remember(item());
  memory.forget({ id: "memory-a", ownerKind: "account", ownerId: "account-a" });
  const session = createSession({
    memory,
    authorizeSync(descriptor) {
      descriptors.push(descriptor);
      return allowed;
    },
  });
  const remote = transport();

  const staged = session.stageForget({ id: "memory-a", ownerKind: "account", ownerId: "account-a" });
  assert.equal(staged.status, "pending");
  allowed = false;
  await session.flush(remote);

  assert.equal(remote.mutations.length, 0);
  const descriptor = descriptors.at(-1);
  assert.deepEqual(descriptor.memoryIdentity, {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
  });
  assert.equal("item" in descriptor, false);
});

test("a stale delete cannot remove cloud state after portable local Memory is recreated", async () => {
  const memory = createMemoryRuntime();
  const session = createSession({ memory, authorizeSync: () => true });
  const remote = transport();

  assert.equal(session.stageForget({ id: "memory-a", ownerKind: "account", ownerId: "account-a" }).status, "pending");
  memory.remember(item({ content: "recreated before delete transport" }));

  const result = await session.flush(remote);
  assert.equal(result.accepted, 0);
  assert.equal(result.failures, 1);
  assert.equal(remote.mutations.length, 0);
});
