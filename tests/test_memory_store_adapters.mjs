import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_MEMORY_SNAPSHOT_BYTES,
  MEMORY_SNAPSHOT_SCHEMA,
  parseMemorySnapshotPayload,
  validateMemorySnapshot,
} from "../system/contracts/memory-store.mjs";
import { createNativeMemoryStore, MEMORY_ENDPOINT } from "../system/adapters/native/memory.mjs";
import { createWebMemoryStore } from "../system/adapters/web/memory.mjs";

function memoryItem(overrides = {}) {
  return {
    id: "mem-1",
    ownerId: "user-1",
    scope: "device",
    kind: "fact",
    sensitivity: "private",
    content: "OrdaX local memory",
    provenance: "test",
    sourceTimestamp: "2026-09-24T12:00:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function snapshot(items = [memoryItem()]) {
  return { $schema: MEMORY_SNAPSHOT_SCHEMA, items };
}

test("memory snapshots share the Native 8 MiB durable ceiling", () => {
  assert.throws(
    () => parseMemorySnapshotPayload("x".repeat(MAX_MEMORY_SNAPSHOT_BYTES + 1)),
    /byte limit/,
  );

  const oversized = snapshot(Array.from({ length: 260 }, (_, index) => memoryItem({
    id: `large-${index}`,
    content: "x".repeat(32768),
  })));
  assert.throws(() => validateMemorySnapshot(oversized), /byte limit/);
});

test("Web memory store persists valid device snapshots and flushes synchronously durable state", async () => {
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
  };
  const first = createWebMemoryStore({ localStorage });
  assert.equal(first.scope, "device");
  assert.equal(first.save(snapshot()), true);
  assert.equal(await first.flush(), true);

  const second = createWebMemoryStore({ localStorage });
  assert.equal(second.load().items[0].content, "OrdaX local memory");
});

test("Web memory store does not replace its last valid snapshot when localStorage rejects a save", () => {
  const values = new Map();
  let rejectWrites = false;
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (rejectWrites) throw new Error("quota");
      values.set(key, value);
    },
  };
  const store = createWebMemoryStore({ localStorage });
  const first = snapshot([memoryItem({ id: "first" })]);
  const second = snapshot([memoryItem({ id: "second" })]);
  assert.equal(store.save(first), true);
  rejectWrites = true;
  assert.equal(store.save(second), false);
  assert.equal(store.load().items[0].id, "first");
});

test("Web memory store ignores corrupt or oversized persisted payloads", () => {
  const store = createWebMemoryStore({
    localStorage: {
      getItem() { return "x".repeat(MAX_MEMORY_SNAPSHOT_BYTES + 1); },
      setItem() {},
    },
  });
  assert.equal(store.load(), null);
});

test("Web memory store has explicit session fallback when storage is unavailable", async () => {
  const store = createWebMemoryStore({});
  assert.equal(store.scope, "session");
  const state = snapshot([memoryItem({ scope: "session" })]);
  assert.equal(store.save(state), true);
  assert.equal(store.load().items[0].scope, "session");
  assert.equal(await store.flush(), true);
});

test("device stores reject session-scoped snapshots", async () => {
  const web = createWebMemoryStore({
    localStorage: { getItem: () => null, setItem() {} },
  });
  assert.throws(
    () => web.save(snapshot([memoryItem({ scope: "session" })])),
    /session-scoped/,
  );

  const native = await createNativeMemoryStore({
    async fetch() {
      return { ok: true, async json() { return { payload: null }; } };
    },
  });
  assert.throws(
    () => native.save(snapshot([memoryItem({ scope: "session" })])),
    /session-scoped/,
  );
});

test("Native memory store loads, queues and flushes persistence through the dedicated endpoint", async () => {
  const calls = [];
  const initial = snapshot([memoryItem({ id: "initial" })]);
  const windowRef = {
    async fetch(url, options = {}) {
      calls.push({ url, options });
      if (options.method === "GET") {
        return {
          ok: true,
          async json() { return { payload: JSON.stringify(initial) }; },
        };
      }
      return { ok: true, async json() { return {}; } };
    },
  };

  const store = await createNativeMemoryStore(windowRef);
  assert.equal(store.scope, "device");
  assert.equal(store.load().items[0].id, "initial");
  store.save(snapshot([memoryItem({ id: "next" })]));
  assert.equal(await store.flush(), true);

  assert.equal(calls[0].url, MEMORY_ENDPOINT);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].url, MEMORY_ENDPOINT);
  assert.equal(calls[1].options.method, "POST");
  const body = JSON.parse(calls[1].options.body);
  assert.equal(JSON.parse(body.payload).items[0].id, "next");
  assert.equal(calls.length, 2);
});

test("Native memory flush retries the current snapshot after a transient POST failure", async () => {
  let postCalls = 0;
  const store = await createNativeMemoryStore({
    async fetch(url, options = {}) {
      if (options.method === "GET") {
        return { ok: true, async json() { return { payload: null }; } };
      }
      postCalls += 1;
      return postCalls === 1
        ? { ok: false, status: 503 }
        : { ok: true, async json() { return {}; } };
    },
  });

  assert.equal(store.save(snapshot([memoryItem({ id: "retry-me" })])), true);
  assert.equal(await store.flush(), true);
  assert.equal(postCalls, 2);
  assert.equal(store.load().items[0].id, "retry-me");
});

test("Native memory flush still surfaces a persistent POST failure after retry", async () => {
  let postCalls = 0;
  const store = await createNativeMemoryStore({
    async fetch(url, options = {}) {
      if (options.method === "GET") {
        return { ok: true, async json() { return { payload: null }; } };
      }
      postCalls += 1;
      return { ok: false, status: 503 };
    },
  });
  assert.equal(store.save(snapshot()), true);
  await assert.rejects(() => store.flush(), /persistence failed: 503/);
  assert.equal(postCalls, 2);
});

test("synchronous Native memory bursts coalesce to the newest snapshot", async () => {
  const postedIds = [];
  const store = await createNativeMemoryStore({
    async fetch(url, options = {}) {
      if (options.method === "GET") {
        return { ok: true, async json() { return { payload: null }; } };
      }
      const body = JSON.parse(options.body);
      postedIds.push(JSON.parse(body.payload).items[0].id);
      return { ok: true, async json() { return {}; } };
    },
  });

  store.save(snapshot([memoryItem({ id: "older" })]));
  store.save(snapshot([memoryItem({ id: "middle" })]));
  store.save(snapshot([memoryItem({ id: "newer" })]));
  assert.equal(await store.flush(), true);
  assert.deepEqual(postedIds, ["newer"]);
  assert.equal(store.load().items[0].id, "newer");
});

test("Native memory flush retries only the coalesced newest snapshot after a transient failure", async () => {
  const postedIds = [];
  let postCalls = 0;
  let releaseFirst;
  const firstResponse = new Promise((resolve) => { releaseFirst = resolve; });
  const store = await createNativeMemoryStore({
    async fetch(url, options = {}) {
      if (options.method === "GET") {
        return { ok: true, async json() { return { payload: null }; } };
      }
      postCalls += 1;
      const body = JSON.parse(options.body);
      postedIds.push(JSON.parse(body.payload).items[0].id);
      if (postCalls === 1) return firstResponse;
      if (postCalls === 2) return { ok: true, async json() { return {}; } };
      return { ok: false, status: 503 };
    },
  });

  store.save(snapshot([memoryItem({ id: "older" })]));
  const flushing = store.flush();
  store.save(snapshot([memoryItem({ id: "newer" })]));
  releaseFirst({ ok: false, status: 503 });

  assert.equal(await flushing, true);
  assert.deepEqual(postedIds, ["newer", "newer"]);
  assert.equal(store.load().items[0].id, "newer");
});

test("Native memory store rejects oversized host payload before JSON parsing", async () => {
  await assert.rejects(
    () => createNativeMemoryStore({
      async fetch() {
        return {
          ok: true,
          async json() { return { payload: "x".repeat(MAX_MEMORY_SNAPSHOT_BYTES + 1) }; },
        };
      },
    }),
    /byte limit/,
  );
});

test("Native memory store fails closed when persistence endpoint is unavailable", async () => {
  await assert.rejects(
    () => createNativeMemoryStore({
      async fetch() { return { ok: false, status: 503 }; },
    }),
    /persistence unavailable/,
  );
});
