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

function bound(store, appId = "notes", publisherId = "ordax-official") {
  return createBoundAppDataPort({ store, appId, publisherId });
}

test("Web App Data survives adapter recreation with bytes and revision intact", async () => {
  const storage = memoryStorage();
  const firstStore = createWebAppDataStore({ windowRef: { localStorage: storage } });
  const first = bound(firstStore);

  const stored = await first.put({
    key: "document",
    value: new Uint8Array([0, 1, 2, 253, 254, 255]),
    expectedRevision: 0,
  });
  assert.equal(stored.revision, 1);

  const secondStore = createWebAppDataStore({ windowRef: { localStorage: storage } });
  const second = bound(secondStore);
  const loaded = await second.get("document");

  assert.equal(loaded.revision, 1);
  assert.equal(loaded.found, true);
  assert.deepEqual([...loaded.value], [0, 1, 2, 253, 254, 255]);
});

test("Web App Data keeps verified identities in separate local partitions", async () => {
  const storage = memoryStorage();
  const store = createWebAppDataStore({ windowRef: { localStorage: storage } });
  const notes = bound(store, "notes");
  const assistant = bound(store, "assistant");
  const foreignNotes = bound(store, "notes", "example.publisher");

  await notes.put({
    key: "state",
    value: new Uint8Array([7]),
    expectedRevision: 0,
  });

  assert.equal((await notes.get("state")).found, true);
  assert.equal((await assistant.get("state")).found, false);
  assert.equal((await foreignNotes.get("state")).found, false);
  assert.equal(storage.raw().size, 1);
});

test("Web App Data preserves CAS semantics across independently created ports", async () => {
  const storage = memoryStorage();
  const first = bound(createWebAppDataStore({ windowRef: { localStorage: storage } }));
  const second = bound(createWebAppDataStore({ windowRef: { localStorage: storage } }));

  await first.put({
    key: "a",
    value: new Uint8Array([1]),
    expectedRevision: 0,
  });

  await assert.rejects(
    second.put({
      key: "b",
      value: new Uint8Array([2]),
      expectedRevision: 0,
    }),
    (error) => error instanceof AppDataConflictError
      && error.expectedRevision === 0
      && error.actualRevision === 1,
  );
});

test("Web App Data corruption fails closed without replacing durable bytes", async () => {
  const storage = memoryStorage();
  const store = createWebAppDataStore({ windowRef: { localStorage: storage } });
  const app = bound(store);
  await app.put({
    key: "safe",
    value: new Uint8Array([1, 2, 3]),
    expectedRevision: 0,
  });

  const [partitionKey] = [...storage.raw().keys()];
  const corrupt = '{"$schema":"ordax.web-app-data-partition/1","revision":1,"entries":';
  storage.setItem(partitionKey, corrupt);

  const reopened = bound(createWebAppDataStore({ windowRef: { localStorage: storage } }));
  await assert.rejects(() => reopened.list(), /invalid JSON/);
  assert.equal(storage.getItem(partitionKey), corrupt);
});

test("Web App Data does not silently degrade to session memory when durable storage is denied", () => {
  const denied = {};
  Object.defineProperty(denied, "localStorage", {
    get() {
      throw new Error("denied");
    },
  });
  assert.throws(
    () => createWebAppDataStore({ windowRef: denied }),
    /requires durable localStorage/,
  );
});

test("Web App Data enforces owner-configured byte and key quotas", async () => {
  const storage = memoryStorage();
  const app = bound(createWebAppDataStore({
    windowRef: { localStorage: storage },
    quotaBytes: 4,
    maxKeys: 1,
  }));

  await app.put({
    key: "one",
    value: new Uint8Array([1, 2, 3, 4]),
    expectedRevision: 0,
  });

  await assert.rejects(
    app.put({
      key: "two",
      value: new Uint8Array([5]),
      expectedRevision: 1,
    }),
    /key quota exceeded/,
  );
  await assert.rejects(
    app.put({
      key: "one",
      value: new Uint8Array([1, 2, 3, 4, 5]),
      expectedRevision: 1,
    }),
    /byte quota exceeded|per-value hard bound/,
  );
});
