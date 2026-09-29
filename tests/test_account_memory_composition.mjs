import test from "node:test";
import assert from "node:assert/strict";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createMemorySyncObject } from "../system/services/sync/account-memory-runtime.mjs";
import { createAccountMemorySyncComposition } from "../system/services/sync/account-memory-composition.mjs";

function identitySession() {
  const snapshot = { state: "signed-in", subjectId: "account-a", displayName: "A" };
  const listeners = new Set();
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    listenerCount: () => listeners.size,
  };
}

function stateStore() {
  let payload = null;
  return {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "device",
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
    content: "local value",
    provenance: "user-confirmed:composition-test",
    sourceTimestamp: "2026-09-29T23:50:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function find(memory) {
  return memory.search({
    ownerKind: "account",
    ownerId: "account-a",
    scopes: ["account"],
    includeRestricted: true,
    limit: 20,
    offset: 0,
  }).find((entry) => entry.id === "memory-a") ?? null;
}

function composition() {
  const identity = identitySession();
  const memory = createMemoryRuntime();
  let ordinal = 0;
  const value = createAccountMemorySyncComposition({
    identitySession: identity,
    memoryPort: memory,
    createSyncStateStore: () => stateStore(),
    authorizeSync: () => true,
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}:composition`;
    },
  });
  return { identity, memory, composition: value };
}

test("local app Memory stages through sync exactly once", () => {
  const { composition: value } = composition();

  value.memory.remember(item());

  assert.equal(value.memorySync.pendingMutations().length, 1);
  assert.equal(value.memorySync.pendingMutations()[0].payload.memory.content, "local value");
  assert.equal(value.getSnapshot().remoteApplyStagesOutboundMutation, false);
});

test("remote Memory reconciliation writes the base Memory without creating an outbound echo", async () => {
  const { memory, composition: value } = composition();
  const remote = item({
    content: "authoritative remote value",
    sourceTimestamp: "2026-09-29T23:51:00Z",
  });

  const result = await value.memorySync.applyRemoteBatch([
    createMemorySyncObject({ item: remote, serverRevision: 4 }),
  ]);

  assert.equal(result.applied, 1);
  assert.equal(find(memory)?.content, "authoritative remote value");
  assert.equal(value.memorySync.pendingMutations().length, 0, "remote apply must not be restaged outbound");
});

test("remote reconciliation is visible through the app-facing Memory port", async () => {
  const { composition: value } = composition();
  const remote = item({ content: "visible through shared local store" });

  await value.memorySync.applyRemoteBatch([
    createMemorySyncObject({ item: remote, serverRevision: 1 }),
  ]);

  assert.equal(find(value.memory)?.content, "visible through shared local store");
});

test("composition disposal tears down identity-bound sync without mutating local Memory", () => {
  const { identity, memory, composition: value } = composition();
  value.memory.remember(item());
  assert.equal(identity.listenerCount(), 1);

  value.destroy();

  assert.equal(identity.listenerCount(), 0);
  assert.equal(find(memory)?.content, "local value");
  assert.throws(() => value.getSnapshot(), /disposed/);
});
