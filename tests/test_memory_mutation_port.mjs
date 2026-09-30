import assert from "node:assert/strict";
import test from "node:test";

import { MEMORY_PORT_SCHEMA } from "../system/contracts/memory.mjs";
import { MEMORY_MUTATION_PORT_SCHEMA } from "../system/contracts/memory-mutation.mjs";
import { createMemoryMutationPort } from "../system/services/memory/mutation-port.mjs";

function memoryPort() {
  const items = new Map();
  let flushes = 0;
  return {
    schema: MEMORY_PORT_SCHEMA,
    get flushes() { return flushes; },
    search() { return Object.freeze([...items.values()]); },
    remember(item) {
      items.set(item.id, item);
      return item;
    },
    forget(request) {
      return items.delete(request.id);
    },
    async flush() {
      flushes += 1;
      return true;
    },
  };
}

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
    sourceTimestamp: "2026-09-30T04:00:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

test("mutation port gives device/local writes an explicit durable flush boundary", async () => {
  const memory = memoryPort();
  const mutations = createMemoryMutationPort({ memoryPort: memory });

  assert.equal(mutations.schema, MEMORY_MUTATION_PORT_SCHEMA);
  const saved = await mutations.remember(item());
  assert.equal(saved.id, "memory-a");
  assert.equal(memory.flushes, 1);

  assert.equal(await mutations.forget({ id: "memory-a", ownerKind: "device", ownerId: null }), true);
  assert.equal(memory.flushes, 2);
  assert.equal(mutations.getSnapshot().protectedAccountMutations, false);
  assert.equal(mutations.getSnapshot().cloudTransportOwned, false);
});

test("mutation port delegates account writes to protected mutations without local fallback writes", async () => {
  const memory = memoryPort();
  const calls = [];
  const protectedAccountMutations = {
    async remember(value) {
      calls.push(["remember", value]);
      return value;
    },
    async forget(value) {
      calls.push(["forget", value]);
      return true;
    },
  };
  const mutations = createMemoryMutationPort({
    memoryPort: memory,
    protectedAccountMutations,
  });
  const accountItem = item({
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
  });

  assert.equal((await mutations.remember(accountItem)).ownerId, "account-a");
  assert.equal(await mutations.forget({
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
  }), true);
  assert.deepEqual(calls.map(([kind]) => kind), ["remember", "forget"]);
  assert.equal(memory.flushes, 0);
  assert.equal(memory.search({}).length, 0);
  assert.equal(mutations.getSnapshot().protectedAccountMutations, true);
});

test("protected account mutation rejection never falls back to local Memory", async () => {
  const memory = memoryPort();
  const protectedAccountMutations = {
    async remember() {
      throw new Error("protected-boundary-unavailable");
    },
    async forget() {
      throw new Error("protected-boundary-unavailable");
    },
  };
  const mutations = createMemoryMutationPort({
    memoryPort: memory,
    protectedAccountMutations,
  });
  const accountItem = item({
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
  });

  await assert.rejects(
    mutations.remember(accountItem),
    /protected-boundary-unavailable/,
  );
  await assert.rejects(
    mutations.forget({
      id: "memory-a",
      ownerKind: "account",
      ownerId: "account-a",
    }),
    /protected-boundary-unavailable/,
  );

  assert.equal(memory.flushes, 0);
  assert.equal(memory.search({}).length, 0);
});

test("invalid protected account mutation provider fails closed", () => {
  assert.throws(
    () => createMemoryMutationPort({
      memoryPort: memoryPort(),
      protectedAccountMutations: { remember() {} },
    }),
    /remember\(\) and forget\(\)/,
  );
});
