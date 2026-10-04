import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_APP_DATA_PARTITION_BYTES,
  MAX_APP_DATA_PARTITION_KEYS,
} from "../system/contracts/app-data.mjs";
import { createNativeAppDataStore } from "../system/adapters/native/app-data.mjs";
import { createBoundAppDataPort } from "../system/services/app-data/runtime.mjs";

const identity = Object.freeze({
  publisherId: "ordax.first-party",
  appId: "notes",
  ownerScope: "device",
});
const endpoint = "/__ordax/native/app-data/abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-";

function jsonResponse(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return payload; },
  };
}

function fakeNative() {
  let revision = 0;
  const values = new Map();
  const calls = [];
  return {
    calls,
    windowRef: {
      btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
      atob(value) { return Buffer.from(value, "base64").toString("binary"); },
      async fetch(url, options) {
        calls.push({ url, options });
        assert.equal(url, endpoint);
        assert.equal(options.method, "POST");
        assert.equal(options.credentials, "same-origin");
        assert.equal(options.cache, "no-store");
        const body = JSON.parse(options.body);
        for (const forbidden of ["appId", "publisherId", "ownerScope", "identity"]) {
          assert.equal(Object.hasOwn(body, forbidden), false, `${forbidden} must not cross the app transport`);
        }
        if (body.action === "get") {
          const value = values.get(body.key);
          return jsonResponse(200, {
            revision,
            found: value !== undefined,
            key: body.key,
            valueBase64: value === undefined ? null : Buffer.from(value).toString("base64"),
          });
        }
        if (body.action === "list") {
          const keys = [...values.keys()].sort();
          const bytesUsed = [...values.values()].reduce((total, value) => total + value.length, 0);
          return jsonResponse(200, { revision, keys, bytesUsed, quotaBytes: 8388608, maxKeys: 1024 });
        }
        if (body.expectedRevision !== revision) {
          return jsonResponse(409, { actualRevision: revision, error: "conflict" });
        }
        if (body.action === "put") {
          values.set(body.key, Buffer.from(body.valueBase64, "base64"));
          revision += 1;
          return jsonResponse(200, { revision, stored: true });
        }
        if (body.action === "delete") {
          const deleted = values.delete(body.key);
          if (deleted) revision += 1;
          return jsonResponse(200, { revision, deleted });
        }
        return jsonResponse(400, { error: "invalid" });
      },
    },
  };
}

test("native App Data adapter keeps verified identity out of request bodies", async () => {
  const native = fakeNative();
  const store = createNativeAppDataStore({ windowRef: native.windowRef, endpoint, identity });
  const port = createBoundAppDataPort({
    store,
    appId: identity.appId,
    publisherId: identity.publisherId,
  });

  const empty = await port.list();
  assert.equal(empty.revision, 0);
  assert.deepEqual(empty.keys, []);

  const stored = await port.put({
    key: "document.main",
    value: new Uint8Array([0, 1, 2, 250, 255]),
    expectedRevision: 0,
  });
  assert.equal(stored.revision, 1);

  const result = await port.get("document.main");
  assert.equal(result.found, true);
  assert.deepEqual([...result.value], [0, 1, 2, 250, 255]);

  const deleted = await port.delete({ key: "document.main", expectedRevision: 1 });
  assert.deepEqual(deleted, { revision: 2, deleted: true });

  assert.ok(native.calls.length >= 4);
});

test("native App Data store cannot be retargeted after runtime binding", async () => {
  const native = fakeNative();
  const store = createNativeAppDataStore({ windowRef: native.windowRef, endpoint, identity });
  await assert.rejects(
    () => store.list({ ...identity, appId: "studio" }),
    /cannot retarget its bound identity/,
  );
  assert.equal(native.calls.length, 0);
});

test("native App Data adapter surfaces partition CAS conflicts", async () => {
  const native = fakeNative();
  const store = createNativeAppDataStore({ windowRef: native.windowRef, endpoint, identity });
  const port = createBoundAppDataPort({ store, appId: identity.appId, publisherId: identity.publisherId });
  await port.put({ key: "state", value: new Uint8Array([1]), expectedRevision: 0 });
  await assert.rejects(
    () => port.put({ key: "other", value: new Uint8Array([2]), expectedRevision: 0 }),
    (error) => error?.name === "AppDataConflictError" && error.actualRevision === 1,
  );
});

test("native App Data adapter rejects malformed bindings and response payloads", async () => {
  const native = fakeNative();
  assert.throws(
    () => createNativeAppDataStore({ windowRef: native.windowRef, endpoint: "/__ordax/native/app-data/notes", identity }),
    /endpoint binding is invalid/,
  );

  const badWindow = {
    btoa: native.windowRef.btoa,
    atob: native.windowRef.atob,
    async fetch() {
      return jsonResponse(200, { revision: 0, found: true, key: "state", valueBase64: null });
    },
  };
  const store = createNativeAppDataStore({ windowRef: badWindow, endpoint, identity });
  await assert.rejects(() => store.get(identity, "state"), /missing value/);
});

test("native App Data adapter rejects non-canonical Base64 responses", async () => {
  const native = fakeNative();
  const windowRef = {
    btoa: native.windowRef.btoa,
    atob: native.windowRef.atob,
    async fetch() {
      return jsonResponse(200, { revision: 1, found: true, key: "state", valueBase64: "AQ" });
    },
  };
  const store = createNativeAppDataStore({ windowRef, endpoint, identity });
  await assert.rejects(() => store.get(identity, "state"), /not canonical/);
});

test("native App Data adapter rejects list metadata beyond hard bounds", async () => {
  const native = fakeNative();

  const tooManyKeys = createNativeAppDataStore({
    endpoint,
    identity,
    windowRef: {
      btoa: native.windowRef.btoa,
      atob: native.windowRef.atob,
      async fetch() {
        return jsonResponse(200, {
          revision: 0,
          keys: ["a", "b"],
          bytesUsed: 0,
          quotaBytes: 1024,
          maxKeys: 1,
        });
      },
    },
  });
  await assert.rejects(() => tooManyKeys.list(identity), /exceeds maxKeys/);

  const excessiveQuota = createNativeAppDataStore({
    endpoint,
    identity,
    windowRef: {
      btoa: native.windowRef.btoa,
      atob: native.windowRef.atob,
      async fetch() {
        return jsonResponse(200, {
          revision: 0,
          keys: [],
          bytesUsed: 0,
          quotaBytes: MAX_APP_DATA_PARTITION_BYTES + 1,
          maxKeys: 1,
        });
      },
    },
  });
  await assert.rejects(() => excessiveQuota.list(identity), /quotaBytes is invalid/);

  const excessiveKeyLimit = createNativeAppDataStore({
    endpoint,
    identity,
    windowRef: {
      btoa: native.windowRef.btoa,
      atob: native.windowRef.atob,
      async fetch() {
        return jsonResponse(200, {
          revision: 0,
          keys: [],
          bytesUsed: 0,
          quotaBytes: 1024,
          maxKeys: MAX_APP_DATA_PARTITION_KEYS + 1,
        });
      },
    },
  });
  await assert.rejects(() => excessiveKeyLimit.list(identity), /maxKeys is invalid/);
});
