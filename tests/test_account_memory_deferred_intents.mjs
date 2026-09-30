import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { MEMORY_SYNC_RUNTIME_SCHEMA } from "../system/services/sync/account-memory-runtime.mjs";
import { createAccountMemoryDeferredIntents } from "../system/services/sync/account-memory-deferred-intents.mjs";

function identitySession(initial = { state: "signed-in", subjectId: "account-a", displayName: "A" }) {
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
  };
}

function persistentStore(initial = null) {
  let payload = initial;
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

function storeFactory() {
  const stores = new Map();
  const factory = (subjectId) => {
    if (!stores.has(subjectId)) stores.set(subjectId, persistentStore());
    return stores.get(subjectId);
  };
  factory.stores = stores;
  return factory;
}

function item(overrides = {}) {
  return {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "portable content must not be duplicated in deferred coordination",
    provenance: "user-confirmed:deferred-intent-test",
    sourceTimestamp: "2026-09-30T01:00:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function memorySync({ pending = [], conflicts = [], result = { status: "pending", objectId: "memory-a" } } = {}) {
  const calls = [];
  return {
    calls,
    runtime: {
      schema: MEMORY_SYNC_RUNTIME_SCHEMA,
      stageUpsert(value) {
        calls.push({ kind: "upsert", value });
        return result;
      },
      stageForget(value) {
        calls.push({ kind: "delete", value });
        return result;
      },
      pendingMutations() {
        return pending;
      },
      pendingConflicts() {
        return conflicts;
      },
    },
  };
}

function blocked(objectId = "memory-a") {
  return { status: "blocked", reason: "authorization-required", objectId };
}

test("authorization-blocked upsert persists only account identity and survives recreation", () => {
  const identity = identitySession();
  const memory = createMemoryRuntime();
  const current = memory.remember(item());
  const stores = storeFactory();
  let deferred = createAccountMemoryDeferredIntents({
    identitySession: identity,
    memoryPort: memory,
    createDeferredStateStore: stores,
  });

  const observed = deferred.observeStageResult(blocked(), { kind: "upsert", value: current });
  assert.equal(observed.status, "deferred");
  assert.equal(deferred.pendingIntents().length, 1);
  const raw = stores.stores.get("account-a").read();
  assert.match(raw, /memory-a/);
  assert.match(raw, /"operation":"upsert"/);
  assert.doesNotMatch(raw, /portable content must not be duplicated/);
  deferred.destroy();

  deferred = createAccountMemoryDeferredIntents({
    identitySession: identity,
    memoryPort: memory,
    createDeferredStateStore: stores,
  });
  assert.equal(deferred.pendingIntents().length, 1);
  assert.deepEqual(deferred.pendingIntents()[0], {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
    operation: "upsert",
  });
});

test("replay derives the current portable item and transfers ownership to canonical pending state", () => {
  const identity = identitySession();
  const memory = createMemoryRuntime();
  const current = memory.remember(item());
  const stores = storeFactory();
  const deferred = createAccountMemoryDeferredIntents({
    identitySession: identity,
    memoryPort: memory,
    createDeferredStateStore: stores,
  });
  deferred.observeStageResult(blocked(), { kind: "upsert", value: current });
  const sync = memorySync();

  const replay = deferred.replay(sync.runtime);

  assert.equal(replay.attempted, 1);
  assert.equal(replay.transferred, 1);
  assert.equal(replay.deferred, 0);
  assert.equal(sync.calls.length, 1);
  assert.equal(sync.calls[0].kind, "upsert");
  assert.equal(sync.calls[0].value.content, current.content);
  assert.equal(deferred.pendingIntents().length, 0);
});

test("replay converts an old deferred upsert into cloud cleanup when current Memory is restricted", () => {
  const identity = identitySession();
  const memory = createMemoryRuntime();
  const portable = memory.remember(item());
  const stores = storeFactory();
  const deferred = createAccountMemoryDeferredIntents({
    identitySession: identity,
    memoryPort: memory,
    createDeferredStateStore: stores,
  });
  deferred.observeStageResult(blocked(), { kind: "upsert", value: portable });
  memory.remember(item({
    sensitivity: "restricted",
    content: "local only now",
    sourceTimestamp: "2026-09-30T01:01:00Z",
  }));
  const sync = memorySync();

  deferred.replay(sync.runtime);

  assert.equal(sync.calls.length, 1);
  assert.equal(sync.calls[0].kind, "delete");
  assert.deepEqual(sync.calls[0].value, {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
  });
  assert.equal(deferred.pendingIntents().length, 0);
});

test("canonical pending ownership clears duplicate deferred ownership without restaging", () => {
  const identity = identitySession();
  const memory = createMemoryRuntime();
  const current = memory.remember(item());
  const stores = storeFactory();
  const deferred = createAccountMemoryDeferredIntents({
    identitySession: identity,
    memoryPort: memory,
    createDeferredStateStore: stores,
  });
  deferred.observeStageResult(blocked(), { kind: "upsert", value: current });
  const sync = memorySync({
    pending: [{
      objectId: "memory-a",
      operation: "upsert",
      payload: { memory: current },
    }],
  });

  const replay = deferred.replay(sync.runtime);

  assert.equal(replay.transferred, 1);
  assert.equal(sync.calls.length, 0);
  assert.equal(deferred.pendingIntents().length, 0);
});

test("stale pending upsert cannot consume a deferred delete for restricted current Memory", () => {
  const identity = identitySession();
  const memory = createMemoryRuntime();
  const portable = memory.remember(item());
  const stores = storeFactory();
  const deferred = createAccountMemoryDeferredIntents({
    identitySession: identity,
    memoryPort: memory,
    createDeferredStateStore: stores,
  });
  deferred.observeStageResult(blocked(), { kind: "upsert", value: portable });
  memory.remember(item({
    sensitivity: "restricted",
    content: "restricted local state",
    sourceTimestamp: "2026-09-30T01:02:00Z",
  }));
  const sync = memorySync({
    pending: [{
      objectId: "memory-a",
      operation: "upsert",
      payload: { memory: portable },
    }],
  });

  deferred.replay(sync.runtime);

  assert.equal(sync.calls.length, 1);
  assert.equal(sync.calls[0].kind, "delete");
  assert.deepEqual(sync.calls[0].value, {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
  });
  assert.equal(deferred.pendingIntents().length, 0);
});

test("account switches keep deferred identities partitioned by subject", () => {
  const identity = identitySession();
  const memory = createMemoryRuntime();
  const stores = storeFactory();
  const deferred = createAccountMemoryDeferredIntents({
    identitySession: identity,
    memoryPort: memory,
    createDeferredStateStore: stores,
  });
  const accountA = memory.remember(item());
  deferred.observeStageResult(blocked(), { kind: "upsert", value: accountA });

  identity.set({ state: "signed-in", subjectId: "account-b", displayName: "B" });
  assert.equal(deferred.pendingIntents().length, 0);
  const accountB = memory.remember(item({
    id: "memory-b",
    ownerId: "account-b",
    content: "B memory",
  }));
  deferred.observeStageResult(blocked("memory-b"), { kind: "upsert", value: accountB });
  assert.equal(deferred.pendingIntents()[0].id, "memory-b");

  identity.set({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  assert.equal(deferred.pendingIntents()[0].id, "memory-a");
});

test("corrupt deferred coordination fails closed instead of silently discarding intent", () => {
  const identity = identitySession();
  const memory = createMemoryRuntime();
  const stores = storeFactory();
  stores.stores.set("account-a", persistentStore('{"$schema":"wrong","subjectId":"account-a","intents":[]}'));
  const deferred = createAccountMemoryDeferredIntents({
    identitySession: identity,
    memoryPort: memory,
    createDeferredStateStore: stores,
  });

  assert.throws(
    () => deferred.pendingIntents(),
    /requires explicit recovery/,
  );
});