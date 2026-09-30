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

function storeFactory() {
  const stores = new Map();
  return (subjectId) => {
    if (!stores.has(subjectId)) stores.set(subjectId, stateStore());
    return stores.get(subjectId);
  };
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

function item(subjectId = "account-a", id = "memory-a") {
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

function createHarness({ resolveEntitlement, initialIdentity } = {}) {
  const identity = identitySession(initialIdentity ?? {
    state: "signed-in",
    subjectId: "account-a",
    displayName: "A",
  });
  const memory = createMemoryRuntime();
  let ordinal = 0;
  const composition = createAccountMemoryAuthorizedComposition({
    identitySession: identity,
    entitlementsPort: entitlements(resolveEntitlement),
    memoryPort: memory,
    createSyncStateStore: storeFactory(),
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}:authorized-composition`;
    },
  });
  return { identity, memory, composition };
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

  const result = await composition.memorySync.flush(remote);
  assert.equal(result.accepted, 1);
  assert.equal(result.failures, 0);
  assert.equal(remote.mutations.length, 1);
  assert.equal(composition.memorySync.pendingMutations().length, 0);
});

test("denied entitlement keeps local-first Memory durable and blocks transport", async () => {
  const { memory, composition } = createHarness({
    resolveEntitlement: async (request) => decision(request.subjectId, false),
  });
  const remote = transport();

  await composition.settled();
  composition.memory.remember(item());

  assert.equal(find(memory)?.id, "memory-a");
  assert.equal(composition.memorySync.pendingMutations().length, 1);
  const blocked = await composition.memorySync.flush(remote);
  assert.equal(blocked.accepted, 0);
  assert.equal(blocked.failures, 1);
  assert.equal(remote.mutations.length, 0);
  assert.equal(composition.memorySync.pendingMutations().length, 1);
});

test("pending local Memory retries successfully after server authorization becomes allowed", async () => {
  let allowed = false;
  const { composition } = createHarness({
    resolveEntitlement: async (request) => decision(request.subjectId, allowed),
  });
  const remote = transport();

  await composition.settled();
  composition.memory.remember(item());
  const blocked = await composition.memorySync.flush(remote);
  assert.equal(blocked.failures, 1);
  assert.equal(remote.mutations.length, 0);
  assert.equal(composition.memorySync.pendingMutations().length, 1);

  allowed = true;
  const refreshed = await composition.refreshAuthorization();
  assert.equal(refreshed.entitlement.decision, "allowed");
  const retried = await composition.memorySync.flush(remote);
  assert.equal(retried.accepted, 1);
  assert.equal(retried.failures, 0);
  assert.equal(remote.mutations.length, 1);
  assert.equal(composition.memorySync.pendingMutations().length, 0);
});

test("signed-out local Memory remains local and cannot manufacture account sync state", async () => {
  let entitlementCalls = 0;
  const { memory, composition } = createHarness({
    initialIdentity: { state: "signed-out", subjectId: null, displayName: null },
    resolveEntitlement: async (request) => {
      entitlementCalls += 1;
      return decision(request.subjectId, true);
    },
  });

  await composition.settled();
  const local = item("account-a");
  composition.memory.remember(local);

  assert.equal(find(memory)?.id, "memory-a");
  assert.equal(entitlementCalls, 0);
  assert.equal(composition.memorySync.pendingMutations().length, 0);
  assert.equal(composition.getSnapshot().entitlement.state, "signed-out");
});

test("provider failure never grants transport and preserves the pending local intent", async () => {
  const { composition } = createHarness({
    resolveEntitlement: async () => {
      throw new Error("entitlement provider unavailable");
    },
  });
  const remote = transport();

  const settled = await composition.settled();
  assert.equal(settled.entitlement.state, "unavailable");
  assert.equal(settled.entitlement.decision, "denied");

  composition.memory.remember(item());
  const result = await composition.memorySync.flush(remote);
  assert.equal(result.accepted, 0);
  assert.equal(result.failures, 1);
  assert.equal(remote.mutations.length, 0);
  assert.equal(composition.memorySync.pendingMutations().length, 1);
});

test("composition snapshot keeps public promotion disabled and destroy is terminal", async () => {
  const { composition } = createHarness({
    resolveEntitlement: async (request) => decision(request.subjectId, true),
  });
  const snapshot = await composition.settled();

  assert.equal(snapshot.authorizationEnforcedAtTransportBoundary, true);
  assert.equal(snapshot.localFirstWhileAuthorizationUnavailable, true);
  assert.equal(snapshot.productionPromoted, false);

  composition.destroy();
  await assert.rejects(composition.settled(), /disposed/);
  assert.throws(() => composition.getSnapshot(), /disposed/);
});
