import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { MEMORY_STORE_SCHEMA } from "../system/contracts/memory-store.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createSyncStateNamespaceRegistry } from "../system/services/sync/state-store-registry.mjs";
import {
  createNativeAccountMemoryComposition,
} from "../system/composition/native/account-memory.mjs";

function identitySession(subjectId = "account-a") {
  const snapshot = Object.freeze({ state: "signed-in", subjectId, displayName: "Conta A" });
  return Object.freeze({
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
  });
}

function rootStore() {
  let payload = null;
  return Object.freeze({
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
    read: () => payload,
  });
}

function memoryStore() {
  let payload = null;
  return Object.freeze({
    schema: MEMORY_STORE_SCHEMA,
    scope: "device",
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

function deniedWindow() {
  return {
    async fetch() {
      return Object.freeze({
        ok: true,
        status: 200,
        async json() {
          return Object.freeze({
            subjectType: "account",
            subjectId: "account-a",
            key: "memory.cloud.enabled",
            decision: "denied",
            value: null,
            authority: "server",
            expiresAt: null,
          });
        },
      });
    },
  };
}

function memoryItem(id = "memory-a") {
  return Object.freeze({
    id,
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "conteúdo local protegido",
    provenance: "test",
    sourceTimestamp: "2026-09-30T12:30:00Z",
    spaceId: null,
    projectId: null,
  });
}

test("Native protected Account Memory keeps cloud transport disabled while durably owning local mutation", async () => {
  const root = rootStore();
  const registry = createSyncStateNamespaceRegistry(root);
  const memory = createMemoryRuntime({ store: memoryStore() });
  let ordinal = 0;
  const composition = createNativeAccountMemoryComposition({
    windowRef: deniedWindow(),
    identitySession: identitySession(),
    memoryPort: memory,
    syncStateRegistry: registry,
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}`;
    },
  });

  await composition.settled();
  const saved = await composition.protectedMutations.remember(memoryItem());

  assert.equal(saved.id, "memory-a");
  assert.equal(composition.getSnapshot().state, "protected-local-first");
  assert.equal(composition.getSnapshot().publicCloudMemoryEnabled, false);
  assert.equal(composition.getSnapshot().accountMutationsBlocked, false);
  assert.equal(
    memory.search({
      ownerKind: "account",
      ownerId: "account-a",
      scopes: ["account"],
      includeRestricted: true,
      limit: 20,
      offset: 0,
    }).length,
    1,
  );
  assert.doesNotMatch(root.read(), /conteúdo local protegido/);
  composition.destroy();
});

test("Native protected Account Memory blocks canonical recovery state before local mutation", async () => {
  const root = rootStore();
  const registry = createSyncStateNamespaceRegistry(root);
  registry.open("memory", { partitionKey: "account-a" }).save("{invalid-memory-sync-state");

  const memory = createMemoryRuntime({ store: memoryStore() });
  const composition = createNativeAccountMemoryComposition({
    windowRef: deniedWindow(),
    identitySession: identitySession(),
    memoryPort: memory,
    syncStateRegistry: registry,
    createIdempotencyKey: (kind) => `memory:${kind}:blocked`,
  });

  await composition.settled();
  const snapshot = composition.getSnapshot();
  assert.equal(snapshot.state, "recovery-required");
  assert.equal(snapshot.accountMutationsBlocked, true);

  await assert.rejects(
    composition.protectedMutations.remember(memoryItem("blocked-memory")),
    /coordination requires recovery/,
  );
  assert.equal(
    memory.search({
      ownerKind: "account",
      ownerId: "account-a",
      scopes: ["account"],
      includeRestricted: true,
      limit: 20,
      offset: 0,
    }).length,
    0,
  );
  composition.destroy();
});
