import assert from "node:assert/strict";
import test from "node:test";

import { ENTITLEMENTS_PORT_SCHEMA } from "../system/contracts/entitlements.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { SYNC_TRANSPORT_SCHEMA } from "../system/contracts/sync-transport.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createAccountMemoryAuthorizedComposition } from "../system/services/sync/account-memory-authorized-composition.mjs";

function identitySession(initial) {
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

function stateStore(scope = "device") {
  let payload = null;
  return {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope,
    load: () => payload,
    save(value) {
      payload = value;
      return true;
    },
    read: () => payload,
  };
}

function storeFactory(scope = "device") {
  const stores = new Map();
  const factory = (subjectId) => {
    if (!stores.has(subjectId)) stores.set(subjectId, stateStore(scope));
    return stores.get(subjectId);
  };
  factory.stores = stores;
  return factory;
}

function failingStoreFactory(scope = "device") {
  const stores = new Map();
  const factory = (subjectId) => {
    if (!stores.has(subjectId)) {
      stores.set(subjectId, {
        schema: SYNC_STATE_STORE_SCHEMA,
        scope,
        load: () => null,
        save: () => false,
      });
    }
    return stores.get(subjectId);
  };
  factory.stores = stores;
  return factory;
}

function decision(subjectId, allowed) {
  return Object.freeze({
    subjectType: "account",
    subjectId,
    key: "memory.cloud.enabled",
    decision: allowed ? "allowed" : "denied",
    value: null,
    authority: "server",
    expiresAt: null,
  });
}

function entitlements(resolve) {
  return Object.freeze({ schema: ENTITLEMENTS_PORT_SCHEMA, resolve });
}

function item(subjectId = "account-a", id = "memory-a", overrides = {}) {
  return {
    id,
    ownerKind: "account",
    ownerId: subjectId,
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: `portable memory for ${subjectId}`,
    provenance: "user-confirmed:authorized-composition-test",
    sourceTimestamp: "2026-09-30T01:00:00Z",
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
        serverRevision: mutations.length,
        tombstone: mutation.operation === "delete",
        applied: true,
        conflict: false,
        changeCursor: mutations.length,
      };
    },
  };
}

function createHarness({ resolveEntitlement, initialIdentity, deferredStoreFactory = null, onStageError = null } = {}) {
  const identity = identitySession(initialIdentity ?? {
    state: "signed-in",
    subjectId: "account-a",
    displayName: "A",
  });
  const memory = createMemoryRuntime();
  const syncStores = storeFactory("device");
  const deferredStores = deferredStoreFactory ?? storeFactory("device");
  let ordinal = 0;
  const composition = createAccountMemoryAuthorizedComposition({
    identitySession: identity,
    entitlementsPort: entitlements(resolveEntitlement),
    memoryPort: memory,
    createSyncStateStore: syncStores,
    createDeferredStateStore: deferredStores,
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}:authorized-composition`;
    },
    onStageError,
  });
  return { identity, memory, composition, syncStores, deferredStores };
}

function find(memory, subjectId = "account-a", id = "memory-a") {
  return memory.search({
    ownerKind: "account",
    ownerId: subjectId,
    scopes: ["account"],
    includeRestricted: true,
    limit: 20,
    offset: 0,
  }).find((entry) => entry.id === id) ?? null;
}

test("server-authorized Memory can cross transport only after entitlement settles", async () => {
  const { composition } = createHarness({
    resolveEntitlement: async (request) => decision(request.subjectId, true),
  });
  const remote = transport();

  await composition.settled();
  composition.memory.remember(item());
  assert.equal(composition.memorySync.pendingMutations().length, 1);
  assert.equal(composition.deferredIntents.pendingIntents().length, 0);

  const result = await composition.memorySync.flush(remote);
  assert.equal(result.accepted, 1);
  assert.equal(result.failures, 0);
  assert.equal(remote.mutations.length, 1);
  assert.equal(composition.memorySync.pendingMutations().length, 0);
});

test("denied entitlement preserves a durable deferred identity without creating a transportable mutation", async () => {
  const { memory, composition, deferredStores } = createHarness({
    resolveEntitlement: async (request) => decision(request.subjectId, false),
  });
  const remote = transport();

  await composition.settled();
  composition.memory.remember(item());

  assert.equal(find(memory)?.id, "memory-a");
  assert.equal(composition.memorySync.pendingMutations().length, 0);
  assert.equal(composition.deferredIntents.pendingIntents().length, 1);
  assert.equal(composition.deferredIntents.pendingIntents()[0].operation, "upsert");
  const durable = deferredStores.stores.get("account-a").read();
  assert.match(durable, /memory-a/);
  assert.doesNotMatch(durable, /portable memory for account-a/);

  const blocked = await composition.memorySync.flush(remote);
  assert.equal(blocked.accepted, 0);
  assert.equal(blocked.failures, 0);
  assert.equal(remote.mutations.length, 0);
});

test("deferred local Memory is promoted to the canonical queue after server authorization becomes allowed", async () => {
  let allowed = false;
  const { composition } = createHarness({
    resolveEntitlement: async (request) => decision(request.subjectId, allowed),
  });
  const remote = transport();

  await composition.settled();
  composition.memory.remember(item());
  assert.equal(composition.memorySync.pendingMutations().length, 0);
  assert.equal(composition.deferredIntents.pendingIntents().length, 1);
  assert.equal(remote.mutations.length, 0);

  allowed = true;
  const refreshed = await composition.refreshAuthorization();
  assert.equal(refreshed.entitlement.decision, "allowed");
  assert.equal(composition.deferredIntents.pendingIntents().length, 0);
  assert.equal(composition.memorySync.pendingMutations().length, 1);

  const retried = await composition.memorySync.flush(remote);
  assert.equal(retried.accepted, 1);
  assert.equal(retried.failures, 0);
  assert.equal(remote.mutations.length, 1);
  assert.equal(composition.memorySync.pendingMutations().length, 0);
});

test("portable Memory made restricted while unauthorized defers a tombstone and purges cloud state after authorization returns", async () => {
  let allowed = true;
  const { memory, composition } = createHarness({
    resolveEntitlement: async (request) => decision(request.subjectId, allowed),
  });
  const remote = transport();

  await composition.settled();
  composition.memory.remember(item());
  const first = await composition.memorySync.flush(remote);
  assert.equal(first.accepted, 1);
  assert.equal(remote.mutations[0].operation, "upsert");

  allowed = false;
  await composition.refreshAuthorization();
  composition.memory.remember(item("account-a", "memory-a", {
    sensitivity: "restricted",
    content: "must remain local now",
    sourceTimestamp: "2026-09-30T01:01:00Z",
  }));

  assert.equal(find(memory)?.sensitivity, "restricted");
  assert.equal(composition.memorySync.pendingMutations().length, 0);
  assert.equal(composition.deferredIntents.pendingIntents().length, 1);
  assert.equal(composition.deferredIntents.pendingIntents()[0].operation, "delete");

  allowed = true;
  await composition.refreshAuthorization();
  assert.equal(composition.deferredIntents.pendingIntents().length, 0);
  assert.equal(composition.memorySync.pendingMutations().length, 1);
  const cleanup = await composition.memorySync.flush(remote);
  assert.equal(cleanup.accepted, 1);
  assert.equal(remote.mutations.length, 2);
  assert.equal(remote.mutations[1].operation, "delete");
  assert.deepEqual(remote.mutations[1].payload.memoryIdentity, {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
  });
});

test("signed-out local Memory remains local and cannot manufacture deferred account sync state", async () => {
  let entitlementCalls = 0;
  const { memory, composition } = createHarness({
    initialIdentity: { state: "signed-out", subjectId: null, displayName: null },
    resolveEntitlement: async (request) => {
      entitlementCalls += 1;
      return decision(request.subjectId, true);
    },
  });

  await composition.settled();
  composition.memory.remember(item("account-a"));

  assert.equal(find(memory)?.id, "memory-a");
  assert.equal(entitlementCalls, 0);
  assert.equal(composition.memorySync.pendingMutations().length, 0);
  assert.equal(composition.deferredIntents.pendingIntents().length, 0);
  assert.equal(composition.getSnapshot().entitlement.state, "signed-out");
});

test("provider failure never grants transport and keeps only a durable identity intent", async () => {
  const { composition, deferredStores } = createHarness({
    resolveEntitlement: async () => {
      throw new Error("entitlement provider unavailable");
    },
  });
  const remote = transport();

  const settled = await composition.settled();
  assert.equal(settled.entitlement.state, "unavailable");
  assert.equal(settled.entitlement.decision, "denied");

  composition.memory.remember(item());
  assert.equal(composition.memorySync.pendingMutations().length, 0);
  assert.equal(composition.deferredIntents.pendingIntents().length, 1);
  assert.doesNotMatch(deferredStores.stores.get("account-a").read(), /portable memory/);

  const result = await composition.memorySync.flush(remote);
  assert.equal(result.accepted, 0);
  assert.equal(result.failures, 0);
  assert.equal(remote.mutations.length, 0);
});

test("deferred persistence failure is observable in composition health instead of being masked", async () => {
  const errors = [];
  const { memory, composition } = createHarness({
    resolveEntitlement: async (request) => decision(request.subjectId, false),
    deferredStoreFactory: failingStoreFactory("device"),
    onStageError(error, context) {
      errors.push({ error, context });
    },
  });

  await composition.settled();
  composition.memory.remember(item());

  assert.equal(find(memory)?.id, "memory-a");
  assert.equal(composition.memorySync.pendingMutations().length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].error.message, /Deferred Memory intent persistence failed/);
  assert.equal(errors[0].context.kind, "upsert");

  const snapshot = composition.getSnapshot();
  assert.equal(snapshot.deferredStageHealthy, false);
  assert.equal(snapshot.deferredReplayHealthy, true);
  assert.equal(snapshot.deferredCoordinationHealthy, false);
  assert.equal(snapshot.deferredCoordinationFailurePhase, "stage");
});

test("a later successful deferred stage observation clears stage health degradation", async () => {
  let failSave = true;
  const stores = new Map();
  const deferredStoreFactory = (subjectId) => {
    if (!stores.has(subjectId)) {
      let payload = null;
      stores.set(subjectId, {
        schema: SYNC_STATE_STORE_SCHEMA,
        scope: "device",
        load: () => payload,
        save(value) {
          if (failSave) return false;
          payload = value;
          return true;
        },
      });
    }
    return stores.get(subjectId);
  };
  const { composition } = createHarness({
    resolveEntitlement: async (request) => decision(request.subjectId, false),
    deferredStoreFactory,
  });

  await composition.settled();
  composition.memory.remember(item("account-a", "memory-a"));
  assert.equal(composition.getSnapshot().deferredCoordinationHealthy, false);

  failSave = false;
  composition.memory.remember(item("account-a", "memory-b"));
  const recovered = composition.getSnapshot();
  assert.equal(recovered.deferredStageHealthy, true);
  assert.equal(recovered.deferredCoordinationHealthy, true);
  assert.equal(recovered.deferredCoordinationFailurePhase, null);
});

test("composition snapshot records durable local-first boundary and destroy is terminal", async () => {
  const { composition } = createHarness({
    resolveEntitlement: async (request) => decision(request.subjectId, true),
  });
  const snapshot = await composition.settled();

  assert.equal(snapshot.authorizationEnforcedAtTransportBoundary, true);
  assert.equal(snapshot.localFirstWhileAuthorizationUnavailable, true);
  assert.equal(snapshot.deferredStateStoresPortableContent, false);
  assert.equal(snapshot.deferredIntents.queuePersistence, "device");
  assert.equal(snapshot.deferredStageHealthy, true);
  assert.equal(snapshot.deferredReplayHealthy, true);
  assert.equal(snapshot.deferredCoordinationHealthy, true);
  assert.equal(snapshot.deferredCoordinationFailurePhase, null);
  assert.equal(snapshot.productionPromoted, false);

  composition.destroy();
  await assert.rejects(composition.settled(), /disposed/);
  assert.throws(() => composition.getSnapshot(), /disposed/);
});
