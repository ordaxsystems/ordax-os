import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createMemorySyncObject } from "../system/services/sync/account-memory-runtime.mjs";
import { createNativeAccountMemoryComposition } from "../system/composition/native/account-memory.mjs";

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

function stateRegistry() {
  const stores = new Map();
  return Object.freeze({
    open(namespace, { partitionKey = null } = {}) {
      const key = `${namespace}:${partitionKey ?? ""}`;
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

function response(value) {
  return Object.freeze({
    ok: true,
    status: 200,
    async json() {
      return value;
    },
  });
}

function entitlement(decision = "allowed", overrides = {}) {
  return Object.freeze({
    subjectType: "account",
    subjectId: "account-a",
    key: "memory.cloud.enabled",
    decision,
    value: null,
    authority: "server",
    expiresAt: null,
    ...overrides,
  });
}

function item(id = "remote-a") {
  return Object.freeze({
    id,
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "remote portable memory",
    provenance: "user-confirmed:inbound-authorization-test",
    sourceTimestamp: "2026-09-30T12:00:00Z",
    spaceId: null,
    projectId: null,
  });
}

function compositionWith(decision, now = () => new Date("2026-09-30T12:30:00Z")) {
  const memory = createMemoryRuntime();
  let ordinal = 0;
  const composition = createNativeAccountMemoryComposition({
    windowRef: {
      async fetch() {
        return response(decision);
      },
    },
    identitySession: identitySession(),
    memoryPort: memory,
    syncStateRegistry: stateRegistry(),
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}:inbound-authorization`;
    },
    now,
  });
  return { memory, composition };
}

test("Native inbound Memory restore applies only with current server-authoritative entitlement", async () => {
  const { memory, composition } = compositionWith(entitlement("allowed"));
  await composition.settled();

  const result = await composition.memorySync.applyRemoteBatch([
    createMemorySyncObject({ item: item(), serverRevision: 4 }),
  ]);

  assert.equal(result.applied, 1);
  assert.equal(memory.search({ ownerId: "account-a", scopes: ["account"] })[0].id, "remote-a");
  assert.equal(composition.getSnapshot().inboundRestoreAuthorizationRequired, true);
  composition.destroy();
});

test("Native inbound Memory restore fails closed when entitlement is denied", async () => {
  const { memory, composition } = compositionWith(entitlement("denied"));
  await composition.settled();

  await assert.rejects(
    composition.memorySync.applyRemoteBatch([
      createMemorySyncObject({ item: item("remote-denied"), serverRevision: 5 }),
    ]),
    /inbound restore authorization is required/,
  );

  assert.deepEqual(memory.search({ ownerId: "account-a", scopes: ["account"] }), []);
  composition.destroy();
});

test("Native inbound Memory restore rejects an expired server entitlement", async () => {
  const { memory, composition } = compositionWith(entitlement("allowed", {
    expiresAt: "2026-09-30T12:29:59Z",
  }));
  await composition.settled();

  await assert.rejects(
    composition.memorySync.applyRemoteBatch([
      createMemorySyncObject({ item: item("remote-expired"), serverRevision: 6 }),
    ]),
    /inbound restore authorization is required/,
  );

  assert.deepEqual(memory.search({ ownerId: "account-a", scopes: ["account"] }), []);
  composition.destroy();
});
