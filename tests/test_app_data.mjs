import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_DATA_SCHEMA,
  MAX_APP_DATA_VALUE_BYTES,
  assertAppDataPort,
} from "../system/contracts/app-data.mjs";
import {
  AppDataConflictError,
  createBoundAppDataPort,
  createInMemoryAppDataStore,
} from "../system/services/app-data/runtime.mjs";

const bytes = (...values) => new Uint8Array(values);

test("bound App Data port cannot retarget another app or publisher", async () => {
  const store = createInMemoryAppDataStore();
  const notes = createBoundAppDataPort({
    store,
    appId: "notes",
    publisherId: "ordax.first-party",
  });
  const studio = createBoundAppDataPort({
    store,
    appId: "studio",
    publisherId: "ordax.first-party",
  });
  const foreignNotes = createBoundAppDataPort({
    store,
    appId: "notes",
    publisherId: "example.publisher",
  });

  assertAppDataPort(notes);
  assert.equal(notes.schema, APP_DATA_SCHEMA);
  assert.deepEqual(notes.identity, {
    appId: "notes",
    publisherId: "ordax.first-party",
    ownerScope: "device",
  });

  await notes.put({ key: "document", value: bytes(1, 2, 3), expectedRevision: 0 });
  assert.equal((await notes.get("document")).found, true);
  assert.equal((await studio.get("document")).found, false);
  assert.equal((await foreignNotes.get("document")).found, false);

  await assert.rejects(
    notes.put({
      appId: "studio",
      key: "escape",
      value: bytes(9),
      expectedRevision: 1,
    }),
    /fields are incompatible/,
  );
});

test("App Data uses partition-wide CAS and rejects stale writers", async () => {
  const store = createInMemoryAppDataStore();
  const app = createBoundAppDataPort({ store, appId: "notes", publisherId: "ordax.first-party" });

  const initial = await app.list();
  assert.equal(initial.revision, 0);

  const first = await app.put({ key: "a", value: bytes(1), expectedRevision: initial.revision });
  assert.equal(first.revision, 1);

  await assert.rejects(
    app.put({ key: "b", value: bytes(2), expectedRevision: 0 }),
    (error) => error instanceof AppDataConflictError
      && error.expectedRevision === 0
      && error.actualRevision === 1,
  );

  const second = await app.put({ key: "b", value: bytes(2), expectedRevision: 1 });
  assert.equal(second.revision, 2);
  assert.deepEqual((await app.list()).keys, ["a", "b"]);

  const removed = await app.delete({ key: "a", expectedRevision: 2 });
  assert.equal(removed.deleted, true);
  assert.equal(removed.revision, 3);
});

test("App Data copies caller bytes and returned bytes", async () => {
  const store = createInMemoryAppDataStore();
  const app = createBoundAppDataPort({ store, appId: "notes", publisherId: "ordax.first-party" });

  const source = bytes(4, 5, 6);
  await app.put({ key: "copy", value: source, expectedRevision: 0 });
  source[0] = 99;

  const firstRead = await app.get("copy");
  assert.deepEqual([...firstRead.value], [4, 5, 6]);
  firstRead.value[1] = 88;
  assert.deepEqual([...(await app.get("copy")).value], [4, 5, 6]);
});

test("App Data enforces configurable partition byte and key quotas", async () => {
  const byteStore = createInMemoryAppDataStore({ quotaBytes: 4, maxKeys: 4 });
  const byteApp = createBoundAppDataPort({ byteStore, appId: "notes", publisherId: "ordax.first-party" });
  await byteApp.put({ key: "one", value: bytes(1, 2, 3, 4), expectedRevision: 0 });
  await assert.rejects(
    byteApp.put({ key: "two", value: bytes(5), expectedRevision: 1 }),
    /byte quota exceeded/,
  );

  const keyStore = createInMemoryAppDataStore({ quotaBytes: 32, maxKeys: 1 });
  const keyApp = createBoundAppDataPort({ keyStore, appId: "notes", publisherId: "ordax.first-party" });
  await keyApp.put({ key: "one", value: bytes(1), expectedRevision: 0 });
  await assert.rejects(
    keyApp.put({ key: "two", value: bytes(2), expectedRevision: 1 }),
    /key quota exceeded/,
  );
});

test("App Data hard bounds reject oversized values and invalid logical keys", async () => {
  const store = createInMemoryAppDataStore();
  const app = createBoundAppDataPort({ store, appId: "notes", publisherId: "ordax.first-party" });

  await assert.rejects(
    app.put({
      key: "too-big",
      value: new Uint8Array(MAX_APP_DATA_VALUE_BYTES + 1),
      expectedRevision: 0,
    }),
    /per-value hard bound/,
  );
  await assert.rejects(
    app.put({ key: "../escape", value: bytes(1), expectedRevision: 0 }),
    /key is invalid/,
  );
});

test("deleting an absent key is idempotent and does not advance revision", async () => {
  const store = createInMemoryAppDataStore();
  const app = createBoundAppDataPort({ store, appId: "notes", publisherId: "ordax.first-party" });
  const result = await app.delete({ key: "missing", expectedRevision: 0 });
  assert.deepEqual(result, { revision: 0, deleted: false });
});
