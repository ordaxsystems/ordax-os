import test from "node:test";
import assert from "node:assert/strict";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import {
  NATIVE_ACCOUNT_MEMORY_DEFERRED_NAMESPACE,
  NATIVE_ACCOUNT_MEMORY_RECOVERY_NAMESPACE,
  NATIVE_ACCOUNT_MEMORY_SYNC_NAMESPACE,
  createNativeAccountMemoryComposition,
} from "../system/composition/native/account-memory.mjs";

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

function stateRegistry(opened) {
  const stores = new Map();
  return Object.freeze({
    open(namespace, { partitionKey = null } = {}) {
      const key = `${namespace}:${partitionKey ?? ""}`;
      opened.push({ namespace, partitionKey });
      if (!stores.has(key)) {
        let payload = null;
        stores.set(key, Object.freeze({
          schema: SYNC_STATE_STORE_SCHEMA,
          scope: "device",
          load: () => payload,
          save(value) {
            payload = value;
            return true;
          },
          async flush() {
            return true;
          },
        }));
      }
      return stores.get(key);
    },
  });
}

function response(value, status = 200) {
  return Object.freeze({
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
  });
}

function entitlement(subjectId = "account-a", decision = "allowed") {
  return Object.freeze({
    subjectType: "account",
    subjectId,
    key: "memory.cloud.enabled",
    decision,
    value: null,
    authority: "server",
    expiresAt: null,
  });
}

test("Native Account Memory composition binds fixed entitlement route and account-partitioned durable state", async () => {
  const calls = [];
  const opened = [];
  let ordinal = 0;
  const composition = createNativeAccountMemoryComposition({
    windowRef: {
      async fetch(url, options) {
        calls.push({ url, options });
        return response(entitlement());
      },
    },
    identitySession: identitySession(),
    memoryPort: createMemoryRuntime(),
    syncStateRegistry: stateRegistry(opened),
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}:native-composition`;
    },
  });

  await composition.settled();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/account/entitlements/memory-cloud");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(composition.getSnapshot().accountMemory.entitlement.authority, "server");
  assert.equal(composition.getSnapshot().accountMemory.entitlement.decision, "allowed");
  assert.equal(composition.getSnapshot().publicCloudMemoryEnabled, false);

  const namespaces = new Set(opened.map(({ namespace, partitionKey }) => `${namespace}:${partitionKey}`));
  assert.equal(namespaces.has(`${NATIVE_ACCOUNT_MEMORY_SYNC_NAMESPACE}:account-a`), true);
  assert.equal(namespaces.has(`${NATIVE_ACCOUNT_MEMORY_DEFERRED_NAMESPACE}:account-a`), true);
  assert.equal(namespaces.has(`${NATIVE_ACCOUNT_MEMORY_RECOVERY_NAMESPACE}:account-a`), true);

  composition.destroy();
});

test("Native Account Memory composition fails closed when entitlement endpoint is unavailable", async () => {
  const composition = createNativeAccountMemoryComposition({
    windowRef: {
      async fetch() {
        return response({ error: "unavailable" }, 503);
      },
    },
    identitySession: identitySession(),
    memoryPort: createMemoryRuntime(),
    syncStateRegistry: stateRegistry([]),
    createIdempotencyKey: (kind) => `memory:${kind}:native-unavailable`,
  });

  await composition.settled();
  const snapshot = composition.getSnapshot().accountMemory.entitlement;
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.decision, "denied");
  assert.equal(snapshot.authority, null);
  assert.equal(composition.memorySync.pendingMutations().length, 0);

  composition.destroy();
});
