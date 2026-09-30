import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { SYNC_TRANSPORT_SCHEMA } from "../system/contracts/sync-transport.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createMemorySyncObject } from "../system/services/sync/account-memory-runtime.mjs";
import {
  ACCOUNT_MEMORY_SESSION_RUNTIME_SCHEMA,
  createAccountMemorySessionRuntime,
} from "../system/services/sync/account-memory-session-runtime.mjs";
import { createSyncStateNamespaceRegistry } from "../system/services/sync/state-store-registry.mjs";

function identitySession(initial = { state: "signed-out", subjectId: null, displayName: null }) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    set(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
    },
    listenerCount: () => listeners.size,
  };
}

function rootStore() {
  let payload = null;
  return {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "device",
    load: () => payload,
    save(value) {
      payload = value;
      return true;
    },
    read: () => payload,
  };
}

function item(subjectId, id) {
  return {
    id,
    ownerKind: "account",
    ownerId: subjectId,
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: `memory for ${subjectId}`,
    provenance: "user-confirmed:account-memory-session-test",
    sourceTimestamp: "2026-09-29T13:30:00Z",
    spaceId: null,
    projectId: null,
  };
}

function createHarness(initialIdentity) {
  const identity = identitySession(initialIdentity);
  const root = rootStore();
  const registry = createSyncStateNamespaceRegistry(root, { legacyNamespace: "appearance" });
  const memory = createMemoryRuntime();
  let ordinal = 0;
  const session = createAccountMemorySessionRuntime({
    identitySession: identity,
    memoryPort: memory,
    createSyncStateStore(subjectId) {
      return registry.open("memory", { partitionKey: subjectId });
    },
    authorizeSync: () => true,
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}:session`;
    },
  });
  return { identity, root, registry, memory, session };
}

test("signed-out Memory sync lifecycle is inactive and cannot stage account state", () => {
  const { session } = createHarness({ state: "signed-out", subjectId: null, displayName: null });
  assert.equal(session.schema, "ordax.memory-sync-runtime/1");
  assert.equal(session.sessionSchema, ACCOUNT_MEMORY_SESSION_RUNTIME_SCHEMA);
  assert.equal(session.getSnapshot().subjectId, null);
  assert.equal(session.getSnapshot().identityState, "signed-out");
  assert.deepEqual(session.pendingMutations(), []);
  const staged = session.stageUpsert(item("account-a", "memory-a"));
  assert.equal(staged.status, "blocked");
  assert.equal(staged.reason, "signed-in-account-required");
});

test("sign-in creates exactly the active subject runtime and account switch restores each partition", () => {
  const { identity, session } = createHarness({
    state: "signed-in",
    subjectId: "account-a",
    displayName: "A",
  });

  session.stageUpsert(item("account-a", "memory-a"));
  assert.equal(session.getSnapshot().subjectId, "account-a");
  assert.equal(session.pendingMutations().length, 1);
  assert.equal(session.pendingMutations()[0].payload.memory.ownerId, "account-a");

  identity.set({ state: "signed-in", subjectId: "account-b", displayName: "B" });
  assert.equal(session.getSnapshot().subjectId, "account-b");
  assert.equal(session.pendingMutations().length, 0);
  session.stageUpsert(item("account-b", "memory-b"));
  assert.equal(session.pendingMutations()[0].payload.memory.ownerId, "account-b");

  identity.set({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  assert.equal(session.getSnapshot().subjectId, "account-a");
  assert.equal(session.pendingMutations().length, 1);
  assert.equal(session.pendingMutations()[0].payload.memory.id, "memory-a");

  identity.set({ state: "signed-in", subjectId: "account-b", displayName: "B" });
  assert.equal(session.pendingMutations().length, 1);
  assert.equal(session.pendingMutations()[0].payload.memory.id, "memory-b");
});

test("sign-out detaches account coordination without deleting either account partition", () => {
  const { identity, root, session } = createHarness({
    state: "signed-in",
    subjectId: "account-a",
    displayName: "A",
  });
  session.stageUpsert(item("account-a", "memory-a"));
  const persistedBeforeSignOut = root.read();

  identity.set({ state: "signed-out", subjectId: null, displayName: null });
  assert.equal(session.getSnapshot().subjectId, null);
  assert.equal(session.pendingMutations().length, 0);
  assert.equal(root.read(), persistedBeforeSignOut, "sign-out must not erase pending durable account state");

  identity.set({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  assert.equal(session.pendingMutations().length, 1);
  assert.equal(session.pendingMutations()[0].payload.memory.id, "memory-a");
});

test("remote Memory is never applied while signed out and is owner-bound after sign-in", async () => {
  const { identity, memory, session } = createHarness({ state: "signed-out", subjectId: null, displayName: null });
  const remoteA = createMemorySyncObject({ item: item("account-a", "remote-a"), serverRevision: 3 });

  const inactive = await session.applyRemoteBatch([remoteA]);
  assert.equal(inactive.inactive, true);
  assert.deepEqual(memory.search({ ownerId: "account-a", scopes: ["account"] }), []);

  identity.set({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  const applied = await session.applyRemoteBatch([remoteA]);
  assert.equal(applied.applied, 1);
  assert.equal(memory.search({ ownerId: "account-a", scopes: ["account"] })[0].id, "remote-a");

  identity.set({ state: "signed-in", subjectId: "account-b", displayName: "B" });
  const blockedCrossAccount = await session.applyRemoteBatch([remoteA]);
  assert.equal(blockedCrossAccount.rejected, 1);
  assert.deepEqual(memory.search({ ownerId: "account-b", scopes: ["account"] }), []);
});

test("identity lifecycle wrapper owns neither transport nor cursor and dispose removes subscription", () => {
  const { identity, session } = createHarness({
    state: "signed-in",
    subjectId: "account-a",
    displayName: "A",
  });
  assert.equal(identity.listenerCount(), 1);
  assert.equal(session.getSnapshot().ownsTransport, false);
  assert.equal(session.getSnapshot().ownsCursor, false);
  assert.equal(session.getSnapshot().productionPromoted, false);

  session.destroy();
  assert.equal(identity.listenerCount(), 0);
  assert.throws(() => session.getSnapshot(), /disposed/);
});


test("manual conflict decision is resolved inside the active subject runtime and durably staged", async () => {
  const { memory, session } = createHarness({
    state: "signed-in",
    subjectId: "account-a",
    displayName: "A",
  });
  memory.remember(item("account-a", "memory-conflict"));
  session.stageUpsert(item("account-a", "memory-conflict"));
  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      return Object.freeze({ cursor: 0, objects: Object.freeze([]) });
    },
    async pullChanges({ afterCursor }) {
      return Object.freeze({ afterCursor, nextCursor: afterCursor, changes: Object.freeze([]) });
    },
    async applyMutation(mutation) {
      return Object.freeze({
        objectId: mutation.objectId,
        dataClass: mutation.dataClass,
        serverRevision: 7,
        tombstone: false,
        applied: false,
        conflict: true,
        changeCursor: null,
      });
    },
  };

  await session.flush(transport);
  assert.equal(session.pendingConflicts().length, 1);
  const result = await session.resolveConflict("memory-conflict", "preserve-local-intent");
  assert.equal(result.status, "pending");
  assert.equal(result.reason, "local-intent-rebased");
  assert.equal(session.pendingConflicts().length, 0);
  assert.equal(session.pendingMutations().length, 1);
  assert.equal(session.pendingMutations()[0].baseServerRevision, 7);
});

test("accept remote becomes reconciliation-required and cannot be silently decided twice", async () => {
  const { memory, session } = createHarness({
    state: "signed-in",
    subjectId: "account-a",
    displayName: "A",
  });
  memory.remember(item("account-a", "memory-remote"));
  session.stageUpsert(item("account-a", "memory-remote"));
  const transport = {
    schema: SYNC_TRANSPORT_SCHEMA,
    async snapshot() {
      return Object.freeze({ cursor: 0, objects: Object.freeze([]) });
    },
    async pullChanges({ afterCursor }) {
      return Object.freeze({ afterCursor, nextCursor: afterCursor, changes: Object.freeze([]) });
    },
    async applyMutation(mutation) {
      return Object.freeze({
        objectId: mutation.objectId,
        dataClass: mutation.dataClass,
        serverRevision: 5,
        tombstone: false,
        applied: false,
        conflict: true,
        changeCursor: null,
      });
    },
  };
  await session.flush(transport);
  const accepted = await session.resolveConflict("memory-remote", "accept-authoritative-remote");
  assert.equal(accepted.status, "reconciliation-required");
  assert.equal(session.pendingMutations().length, 0);
  assert.equal(session.pendingConflicts()[0].reason, "reconciliation-required");
  await assert.rejects(
    session.resolveConflict("memory-remote", "accept-authoritative-remote"),
    /already requires authoritative remote reconciliation/,
  );
});
