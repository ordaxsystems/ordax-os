import assert from "node:assert/strict";
import test from "node:test";

import { createWebAppDataStore } from "../system/adapters/web/app-data.mjs";
import {
  AppDataConflictError,
  createBoundAppDataPort,
} from "../system/services/app-data/runtime.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    raw() {
      return values;
    },
  };
}

function memoryLocks() {
  const tails = new Map();
  return {
    request(name, options, callback) {
      assert.equal(options?.mode, "exclusive");
      const previous = tails.get(name) ?? Promise.resolve();
      let release;
      const current = new Promise((resolve) => { release = resolve; });
      tails.set(name, current);
      return previous
        .then(() => callback())
        .finally(() => {
          release();
          if (tails.get(name) === current) tails.delete(name);
        });
    },
  };
}

function webWindow(storage = memoryStorage(), locks = memoryLocks()) {
  return { localStorage: storage, navigator: { locks } };
}

function bound(store, appId = "notes", publisherId = "ordax-official") {
  return createBoundAppDataPort({ store, appId, publisherId });
}

test("Web App Data survives adapter recreation with bytes and revision intact", async () => {
  const storage = memoryStorage();
  const locks = memoryLocks();
  const first = bound(createWebAppDataStore({ windowRef: webWindow(storage, locks) }));
  await first.put({
    key: "document",
    value: new Uint8Array([0, 1, 2, 253, 254, 255]),
    expectedRevision: 0,
  });

  const second = bound(createWebAppDataStore({ windowRef: webWindow(storage, locks) }));
  const loaded = await second.get("document");
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.found, true);
  assert.deepEqual([...loaded.value], [0, 1, 2, 253, 254, 255]);
});

test("Web App Data keeps verified identities in separate local partitions", async () => {
  const storage = memoryStorage();
  const store = createWebAppDataStore({ windowRef: webWindow(storage) });
  const notes = bound(store, "notes");
  const assistant = bound(store, "assistant");
  const foreignNotes = bound(store, "notes", "example.publisher");

  await notes.put({ key: "state", value: new Uint8Array([7]), expectedRevision: 0 });
  assert.equal((await notes.get("state")).found, true);
  assert.equal((await assistant.get("state")).found, false);
  assert.equal((await foreignNotes.get("state")).found, false);
  assert.equal(storage.raw().size, 1);
});

test("Web App Data serializes cross-context mutations and preserves CAS", async () => {
  const storage = memoryStorage();
  const locks = memoryLocks();
  const first = bound(createWebAppDataStore({ windowRef: webWindow(storage, locks) }));
  const second = bound(createWebAppDataStore({ windowRef: webWindow(storage, locks) }));

  const outcomes = await Promise.allSettled([
    first.put({ key: "a", value: new Uint8Array([1]), expectedRevision: 0 }),
    second.put({ key: "b", value: new Uint8Array([2]), expectedRevision: 0 }),
  ]);

  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = outcomes.find((item) => item.status === "rejected");
  assert.ok(rejected?.reason instanceof AppDataConflictError);
  assert.equal(rejected.reason.expectedRevision, 0);
  assert.equal(rejected.reason.actualRevision, 1);
  assert.equal((await first.list()).revision, 1);
});

test("Web App Data corruption fails closed without replacing durable bytes", async () => {
  const storage = memoryStorage();
  const app = bound(createWebAppDataStore({ windowRef: webWindow(storage) }));
  await app.put({ key: "safe", value: new Uint8Array([1, 2, 3]), expectedRevision: 0 });

  const [partitionKey] = [...storage.raw().keys()];
  const corrupt = '{"$schema":"ordax.web-app-data-partition/1","revision":1,"entries":';
  storage.setItem(partitionKey, corrupt);

  const reopened = bound(createWebAppDataStore({ windowRef: webWindow(storage) }));
  await assert.rejects(() => reopened.list(), /invalid JSON/);
  assert.equal(storage.getItem(partitionKey), corrupt);
});

test("Web App Data rejects missing durable storage and missing cross-context lock authority", () => {
  const deniedStorage = {};
  Object.defineProperty(deniedStorage, "localStorage", {
    get() {
      throw new Error("denied");
    },
  });
  assert.throws(
    () => createWebAppDataStore({ windowRef: deniedStorage }),
    /requires durable localStorage/,
  );
  assert.throws(
    () => createWebAppDataStore({ windowRef: { localStorage: memoryStorage(), navigator: {} } }),
    /requires Web Locks/,
  );
});

test("Web App Data enforces owner-configured byte and key quotas", async () => {
  const app = bound(createWebAppDataStore({
    windowRef: webWindow(),
    quotaBytes: 4,
    maxKeys: 1,
  }));

  await app.put({ key: "one", value: new Uint8Array([1, 2, 3, 4]), expectedRevision: 0 });
  await assert.rejects(
    app.put({ key: "two", value: new Uint8Array([5]), expectedRevision: 1 }),
    /key quota exceeded/,
  );
  await assert.rejects(
    app.put({ key: "one", value: new Uint8Array([1, 2, 3, 4, 5]), expectedRevision: 1 }),
    /byte quota exceeded|per-value hard bound/,
  );
});

test("Web App Data rejects persisted state above configured bounds without overwriting it", async () => {
  const storage = memoryStorage();
  const locks = memoryLocks();
  const app = bound(createWebAppDataStore({
    windowRef: webWindow(storage, locks),
    quotaBytes: 8,
    maxKeys: 2,
  }));
  await app.put({ key: "one", value: new Uint8Array([1, 2, 3, 4]), expectedRevision: 0 });
  await app.put({ key: "two", value: new Uint8Array([5, 6, 7, 8]), expectedRevision: 1 });

  const [partitionKey] = [...storage.raw().keys()];
  const original = storage.getItem(partitionKey);
  const reopened = bound(createWebAppDataStore({
    windowRef: webWindow(storage, locks),
    quotaBytes: 4,
    maxKeys: 2,
  }));
  await assert.rejects(() => reopened.list(), /exceeds byte quota/);
  assert.equal(storage.getItem(partitionKey), original);
});
