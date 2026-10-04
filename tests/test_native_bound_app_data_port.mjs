import assert from "node:assert/strict";
import test from "node:test";

import { APP_DATA_SCHEMA } from "../system/contracts/app-data.mjs";
import { createNativeBoundAppDataPort } from "../system/adapters/native/bound-app-data.mjs";

function nativeWindow(requests) {
  return {
    btoa(value) {
      return Buffer.from(value, "binary").toString("base64");
    },
    atob(value) {
      return Buffer.from(value, "base64").toString("binary");
    },
    async fetch(url, options) {
      requests.push({ url, options });
      const body = JSON.parse(options.body);
      let payload;
      if (body.action === "list") {
        payload = {
          revision: 0,
          keys: [],
          bytesUsed: 0,
          quotaBytes: 8 * 1024 * 1024,
          maxKeys: 1024,
        };
      } else if (body.action === "put") {
        payload = { revision: body.expectedRevision + 1, stored: true };
      } else {
        throw new Error(`unexpected test action: ${body.action}`);
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return payload;
        },
      };
    },
  };
}

const identity = Object.freeze({
  publisherId: "ordax-official",
  appId: "notes",
  ownerScope: "device",
});
const endpoint = `/__ordax/native/app-data/${"a".repeat(43)}`;

test("trusted composition closes transport binding and returns only ordax.app-data/1", async () => {
  const requests = [];
  const port = createNativeBoundAppDataPort({
    windowRef: nativeWindow(requests),
    endpoint,
    identity,
  });

  assert.equal(port.schema, APP_DATA_SCHEMA);
  assert.deepEqual(port.identity, identity);
  assert.equal(Object.isFrozen(port), true);
  assert.equal("endpoint" in port, false);
  assert.equal("store" in port, false);
  assert.deepEqual(Object.keys(port).sort(), ["delete", "get", "identity", "list", "put", "schema"]);

  const listing = await port.list();
  assert.equal(listing.revision, 0);
  assert.deepEqual(listing.keys, []);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, endpoint);
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(requests[0].options.body), { action: "list" });
});

test("app-facing mutation cannot inject or retarget identity", async () => {
  const requests = [];
  const port = createNativeBoundAppDataPort({
    windowRef: nativeWindow(requests),
    endpoint,
    identity,
  });

  const result = await port.put({
    key: "note.alpha.0",
    value: new Uint8Array([111, 110, 101]),
    expectedRevision: 0,
  });
  assert.deepEqual(result, { revision: 1, stored: true });
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    action: "put",
    key: "note.alpha.0",
    valueBase64: "b25l",
    expectedRevision: 0,
  });
  assert.equal(requests[0].options.body.includes("publisherId"), false);
  assert.equal(requests[0].options.body.includes("appId"), false);
  assert.equal(requests[0].options.body.includes("ownerScope"), false);
});

test("invalid bootstrap endpoint or identity fails before any request", () => {
  const requests = [];
  const windowRef = nativeWindow(requests);
  assert.throws(
    () => createNativeBoundAppDataPort({ windowRef, endpoint: "/__ordax/native/app-data/notes", identity }),
    TypeError,
  );
  assert.throws(
    () => createNativeBoundAppDataPort({
      windowRef,
      endpoint,
      identity: { ...identity, publisherId: "INVALID/PUBLISHER" },
    }),
    TypeError,
  );
  assert.equal(requests.length, 0);
});
