import test from "node:test";
import assert from "node:assert/strict";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createSyncStateNamespaceRegistry } from "../system/services/sync/state-store-registry.mjs";
import { createNativeAccountMemoryFoundation } from "../system/composition/native/account-memory-foundation.mjs";

function identitySession(subjectId = "account-a") {
  const snapshot = Object.freeze({ state: "signed-in", subjectId, displayName: "A" });
  return Object.freeze({
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
  });
}

function rootStore(scope = "device", initial = null) {
  let payload = initial;
  return Object.freeze({
    schema: SYNC_STATE_STORE_SCHEMA,
    scope,
    load: () => payload,
    save(value) {
      payload = value;
      return true;
    },
    async flush() {
      return true;
    },
  });
}

function windowWithEntitlement(calls = []) {
  return Object.freeze({
    async fetch(url, options) {
      calls.push({ url, options });
      return Object.freeze({
        ok: true,
        status: 200,
        async json() {
          return Object.freeze({
            subjectType: "account",
            subjectId: "account-a",
            key: "memory.cloud.enabled",
            decision: "allowed",
            value: null,
            authority: "server",
            expiresAt: null,
          });
        },
      });
    },
  });
}

function createFoundation({ registry, calls = [] } = {}) {
  let ordinal = 0;
  return createNativeAccountMemoryFoundation({
    windowRef: windowWithEntitlement(calls),
    identitySession: identitySession(),
    memoryPort: createMemoryRuntime(),
    syncStateRegistry: registry,
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}:native-foundation`;
    },
  });
}

test("Native Account Memory remains local-only when durable sync state is unavailable", async () => {
  const calls = [];
  const foundation = createFoundation({ registry: null, calls });
  const snapshot = foundation.getSnapshot();

  assert.equal(snapshot.state, "local-only");
  assert.equal(snapshot.reason, "sync-state-unavailable");
  assert.equal(snapshot.protectedMutationsAvailable, false);
  assert.equal(foundation.memorySync, null);
  assert.equal(foundation.protectedMutations, null);
  assert.equal(calls.length, 0);
});

test("session-only sync state cannot unlock protected Account Memory", async () => {
  const calls = [];
  const registry = createSyncStateNamespaceRegistry(rootStore("session"));
  const foundation = createFoundation({ registry, calls });
  const snapshot = foundation.getSnapshot();

  assert.equal(snapshot.state, "local-only");
  assert.equal(snapshot.reason, "device-durable-sync-state-required");
  assert.equal(snapshot.syncStateScope, "session");
  assert.equal(snapshot.protectedMutationsAvailable, false);
  assert.equal(calls.length, 0);
});

test("device-durable registry enables protected local-first composition without public cloud promotion", async () => {
  const calls = [];
  const registry = createSyncStateNamespaceRegistry(rootStore("device"));
  const foundation = createFoundation({ registry, calls });

  await foundation.settled();
  const snapshot = foundation.getSnapshot();

  assert.equal(snapshot.state, "protected-local-first");
  assert.equal(snapshot.syncStateScope, "device");
  assert.equal(snapshot.protectedMutationsAvailable, true);
  assert.equal(snapshot.accountMutationsBlocked, false);
  assert.equal(snapshot.entitlement.authority, "server");
  assert.equal(snapshot.entitlement.decision, "allowed");
  assert.equal(snapshot.cloudTransportWired, false);
  assert.equal(snapshot.productionPromoted, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/account/entitlements/memory-cloud");

  foundation.destroy();
});

test("incompatible persisted coordination fails into recovery-required before Account mutation", async () => {
  const registry = createSyncStateNamespaceRegistry(
    rootStore("device", JSON.stringify({ $schema: "ordax.unknown/1", slots: {} })),
  );
  const foundation = createFoundation({ registry });
  const snapshot = foundation.getSnapshot();

  assert.equal(snapshot.state, "recovery-required");
  assert.equal(snapshot.accountMutationsBlocked, true);
  assert.equal(snapshot.cloudTransportWired, false);
  await assert.rejects(
    foundation.protectedMutations.remember({}),
    /coordination requires recovery/,
  );
});
