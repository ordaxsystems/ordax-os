import assert from "node:assert/strict";
import test from "node:test";

import { MEMORY_STORE_SCHEMA } from "../system/contracts/memory-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createDurableMemoryMutations } from "../system/services/memory/mutations.mjs";

function item(overrides = {}) {
  return {
    id: "memory-a",
    ownerKind: "device",
    ownerId: null,
    scope: "device",
    kind: "fact",
    sensitivity: "private",
    content: "conteúdo",
    provenance: "test",
    sourceTimestamp: "2026-09-30T03:40:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function deviceStore({ failFlush = false } = {}) {
  let snapshot = null;
  let flushes = 0;
  return {
    schema: MEMORY_STORE_SCHEMA,
    scope: "device",
    load: () => snapshot,
    save(value) {
      snapshot = value;
      return true;
    },
    async flush() {
      flushes += 1;
      if (failFlush) throw new Error("device flush failed");
      return true;
    },
    flushCount: () => flushes,
  };
}

test("durable Memory mutations persist device-owned items locally before success", async () => {
  const store = deviceStore();
  const memory = createMemoryRuntime({ store });
  const mutations = createDurableMemoryMutations({ memoryPort: memory });

  const saved = await mutations.remember(item());

  assert.equal(saved.id, "memory-a");
  assert.equal(store.flushCount(), 1);
  assert.equal(memory.search({
    ownerKind: "device",
    ownerId: null,
    scopes: ["device"],
    includeRestricted: true,
    limit: 8,
    offset: 0,
  }).length, 1);
});

test("durable Memory mutations fail closed for account owner without protected account mutations", async () => {
  const memory = createMemoryRuntime({ store: deviceStore() });
  const mutations = createDurableMemoryMutations({ memoryPort: memory });

  await assert.rejects(
    mutations.remember(item({
      ownerKind: "account",
      ownerId: "account-a",
      scope: "account",
    })),
    /account Memory durable mutation boundary is unavailable/i,
  );
});

test("account-owned durable Memory delegates to the protected account mutation boundary", async () => {
  const memory = createMemoryRuntime({ store: deviceStore() });
  const calls = [];
  const mutations = createDurableMemoryMutations({
    memoryPort: memory,
    accountMutations: {
      async remember(value) {
        calls.push({ kind: "remember", value });
        return value;
      },
      async forget(value) {
        calls.push({ kind: "forget", value });
        return true;
      },
    },
  });
  const accountItem = item({
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
  });

  const saved = await mutations.remember(accountItem);
  const removed = await mutations.forget({
    id: accountItem.id,
    ownerKind: "account",
    ownerId: "account-a",
  });

  assert.equal(saved.ownerId, "account-a");
  assert.equal(removed, true);
  assert.deepEqual(calls.map((entry) => entry.kind), ["remember", "forget"]);
  assert.equal(memory.search({
    ownerKind: "account",
    ownerId: "account-a",
    scopes: ["account"],
    includeRestricted: true,
    limit: 8,
    offset: 0,
  }).length, 0, "router must not bypass protected account mutations");
});

test("device durability failure is surfaced after the local mutation and never reported as success", async () => {
  const memory = createMemoryRuntime({ store: deviceStore({ failFlush: true }) });
  const mutations = createDurableMemoryMutations({ memoryPort: memory });

  await assert.rejects(mutations.remember(item()), /device flush failed/);
});

test("device forget flushes only when an item was actually removed", async () => {
  const store = deviceStore();
  const memory = createMemoryRuntime({ store });
  const mutations = createDurableMemoryMutations({ memoryPort: memory });
  await mutations.remember(item());
  const baseline = store.flushCount();

  assert.equal(await mutations.forget({
    id: "missing",
    ownerKind: "device",
    ownerId: null,
  }), false);
  assert.equal(store.flushCount(), baseline);

  assert.equal(await mutations.forget({
    id: "memory-a",
    ownerKind: "device",
    ownerId: null,
  }), true);
  assert.equal(store.flushCount(), baseline + 1);
});

test("protected account mutation cannot rewrite the authorized Memory item", async () => {
  const memory = createMemoryRuntime({ store: deviceStore() });
  const mutations = createDurableMemoryMutations({
    memoryPort: memory,
    accountMutations: {
      async remember(value) {
        return { ...value, content: "alterado" };
      },
      async forget() {
        return false;
      },
    },
  });

  await assert.rejects(
    mutations.remember(item({
      ownerKind: "account",
      ownerId: "account-a",
      scope: "account",
    })),
    /changed the authorized item/,
  );
});
