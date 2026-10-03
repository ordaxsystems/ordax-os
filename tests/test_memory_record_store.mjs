import assert from "node:assert/strict";
import test from "node:test";

import { MEMORY_RECORD_STORE_SCHEMA } from "../system/contracts/memory-record-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";

function item({
  id,
  ownerKind = "account",
  ownerId = "owner-a",
  scope = "account",
  sensitivity = "private",
  content = "conteúdo histórico",
  sourceTimestamp = "2026-10-03T00:00:00.000Z",
  spaceId = null,
  projectId = null,
} = {}) {
  return {
    id,
    ownerKind,
    ownerId,
    scope,
    kind: "fact",
    sensitivity,
    content,
    provenance: "record-store-test",
    sourceTimestamp,
    spaceId,
    projectId,
  };
}

function identity(value) {
  return `${value.ownerKind}\0${value.ownerId ?? ""}\0${value.id}`;
}

function recordStore({ scope = "device", queryOverride = null } = {}) {
  const records = new Map();
  const puts = [];
  const store = {
    schema: MEMORY_RECORD_STORE_SCHEMA,
    scope,
    query(request) {
      if (queryOverride) return queryOverride(request, records);
      return [...records.values()]
        .filter((entry) => entry.ownerKind === request.ownerKind && entry.ownerId === request.ownerId)
        .filter((entry) => request.scopes.includes(entry.scope))
        .filter((entry) => request.includeRestricted || entry.sensitivity !== "restricted")
        .slice(0, request.maxCandidates);
    },
    put(value) {
      puts.push(value);
      records.set(identity(value), value);
      return true;
    },
    remove(request) {
      return records.delete(identity({ ...request, id: request.id }));
    },
    async flush() { return true; },
    records,
    puts,
  };
  return store;
}

test("record-backed memory can grow beyond the legacy 2048-item snapshot ceiling", () => {
  const store = recordStore();
  const memory = createMemoryRuntime({ store });
  for (let index = 0; index < 2500; index += 1) {
    memory.remember(item({
      id: `history-${String(index).padStart(4, "0")}`,
      content: index === 2499 ? "marcador histórico especial" : `registro histórico ${index}`,
      sourceTimestamp: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    }));
  }

  assert.equal(store.records.size, 2500);
  const results = memory.search({
    ownerId: "owner-a",
    scopes: ["account"],
    query: "marcador especial",
  });
  assert.deepEqual(results.map((entry) => entry.id), ["history-2499"]);
});

test("record-backed memory revalidates adapter candidates and preserves owner boundary", () => {
  const store = recordStore({
    queryOverride() {
      return [item({ id: "foreign", ownerId: "owner-b", content: "segredo de outro owner" })];
    },
  });
  const memory = createMemoryRuntime({ store });
  assert.deepEqual(memory.search({
    ownerId: "owner-a",
    scopes: ["account"],
    query: "segredo",
  }), []);
});

test("device record store keeps session memory volatile and never writes it durably", () => {
  const store = recordStore();
  const memory = createMemoryRuntime({ store });
  memory.remember(item({
    id: "session-one",
    ownerKind: "device",
    ownerId: null,
    scope: "session",
    content: "contexto efêmero",
  }));

  assert.equal(store.puts.length, 0);
  assert.deepEqual(memory.search({
    ownerKind: "device",
    scopes: ["session"],
  }).map((entry) => entry.id), ["session-one"]);
  assert.equal(memory.getPersistenceSnapshot().scope, "device");
  assert.equal(memory.getPersistenceSnapshot().durable, true);
});

test("session record store refuses durable scopes", () => {
  const memory = createMemoryRuntime({ store: recordStore({ scope: "session" }) });
  assert.throws(
    () => memory.remember(item({ id: "durable" })),
    /cannot accept durable memory scopes/,
  );
});
