import assert from "node:assert/strict";
import test from "node:test";

import { ENTITLEMENTS_PORT_SCHEMA } from "../system/contracts/entitlements.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { MEMORY_STORE_SCHEMA } from "../system/contracts/memory-store.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createSyncStateNamespaceRegistry } from "../system/services/sync/state-store-registry.mjs";
import {
  NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
  createNativeAccountMemoryFoundation,
} from "../system/composition/native/account-memory.mjs";

function identitySession(subjectId = "account-a") {
  const snapshot = {
    state: "signed-in",
    subjectId,
    displayName: "Conta A",
  };
  const listeners = new Set();
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
  };
}

function rootStore(scope = "device") {
  let payload = null;
  let flushes = 0;
  return {
    schema: SYNC_STATE_STORE_SCHEMA,
    get scope() { return scope; },
    load() { return payload; },
    save(value) {
      payload = value;
      return true;
    },
    async flush() {
      flushes += 1;
      return true;
    },
    get flushes() { return flushes; },
  };
}

function memoryStore() {
  let payload = null;
  return {
    schema: MEMORY_STORE_SCHEMA,
    scope: "device",
    load() { return payload; },
    save(value) {
      payload = value;
      return true;
    },
    async flush() { return true; },
  };
}

function deniedEntitlements({ unavailable = false } = {}) {
  return {
    schema: ENTITLEMENTS_PORT_SCHEMA,
    async resolve(request) {
      if (unavailable) throw new Error("offline");
      return {
        schema: ENTITLEMENTS_PORT_SCHEMA,
        subjectType: "account",
        subjectId: request.subjectId,
        key: request.key,
        decision: "denied",
        value: null,
        authority: "server",
        expiresAt: null,
      };
    },
  };
}

function memoryItem(id = "memory-a") {
  return {
    id,
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "conteúdo que nunca deve entrar no journal/deferred state",
    provenance: "user-manual",
    sourceTimestamp: "2026-09-30T04:40:00Z",
    spaceId: null,
    projectId: null,
  };
}

test("Native Account Memory stays local-only when durable sync-state is unavailable", () => {
  const memory = createMemoryRuntime({ store: memoryStore() });
  const registry = createSyncStateNamespaceRegistry(rootStore("session"));

  const foundation = createNativeAccountMemoryFoundation({
    identitySession: identitySession(),
    memoryPort: memory,
    syncStateRegistry: registry,
    entitlementsPort: deniedEntitlements(),
    createIdempotencyKey: (kind, ordinal) => `memory:${kind}:${ordinal}`,
  });

  assert.equal(foundation.schema, NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA);
  assert.equal(foundation.protectedMutations, null);
  assert.equal(foundation.accountMemory, null);
  assert.deepEqual(foundation.getSnapshot(), {
    schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
    state: "local-only",
    reason: "device-durable-sync-state-required",
    syncStateScope: "session",
    protectedMutationsAvailable: false,
    cloudTransportWired: false,
    productionPromoted: false,
  });
});

test("Native Account Memory partitions canonical deferred and crash state by account subject", async () => {
  const root = rootStore("device");
  const registry = createSyncStateNamespaceRegistry(root);
  const memory = createMemoryRuntime({ store: memoryStore() });
  const foundation = createNativeAccountMemoryFoundation({
    identitySession: identitySession(),
    memoryPort: memory,
    syncStateRegistry: registry,
    entitlementsPort: deniedEntitlements(),
    createIdempotencyKey: (kind, ordinal) => `memory:${kind}:${ordinal}`,
  });

  await foundation.accountMemory.settled();
  const saved = await foundation.protectedMutations.remember(memoryItem());

  assert.equal(saved.id, "memory-a");
  const snapshot = foundation.getSnapshot();
  assert.equal(snapshot.state, "protected-local-first");
  assert.equal(snapshot.syncStateScope, "device");
  assert.equal(snapshot.protectedMutationsAvailable, true);
  assert.equal(snapshot.cloudTransportWired, false);
  assert.equal(snapshot.productionPromoted, false);

  const rootPayload = root.load();
  assert.match(rootPayload, /memory-deferred\.p\./);
  assert.match(rootPayload, /memory-crash\.p\./);
  assert.doesNotMatch(rootPayload, /conteúdo que nunca deve entrar/);
  assert.equal(root.flushes > 0, true);

  foundation.destroy();
});

test("unavailable entitlement remains denied and keeps portable Memory in durable local coordination", async () => {
  const root = rootStore("device");
  const registry = createSyncStateNamespaceRegistry(root);
  const memory = createMemoryRuntime({ store: memoryStore() });
  const foundation = createNativeAccountMemoryFoundation({
    identitySession: identitySession(),
    memoryPort: memory,
    syncStateRegistry: registry,
    entitlementsPort: deniedEntitlements({ unavailable: true }),
    createIdempotencyKey: (kind, ordinal) => `memory:${kind}:${ordinal}`,
  });

  await foundation.accountMemory.settled();
  assert.equal(foundation.getSnapshot().entitlement.state, "unavailable");
  assert.equal(foundation.getSnapshot().entitlement.decision, "denied");

  await foundation.protectedMutations.remember(memoryItem("memory-offline"));

  assert.equal(
    foundation.accountMemory.deferredIntents.pendingIntents()
      .some((entry) => entry.id === "memory-offline"),
    true,
  );
  assert.equal(foundation.accountMemory.memorySync.pendingMutations().length, 0);
  assert.equal(foundation.getSnapshot().cloudTransportWired, false);

  foundation.destroy();
});
