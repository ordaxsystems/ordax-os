import assert from "node:assert/strict";
import test from "node:test";

import {
  VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
} from "../system/contracts/verified-app-store-catalog.mjs";
import {
  createNativeVerifiedAppStoreCatalog,
} from "../system/adapters/native/verified-app-store-catalog.mjs";

const COMMIT = "a".repeat(40);

function artifact(name, char) {
  return { name, sha256: char.repeat(64), size: 123 };
}

function ready(sequence = 4) {
  return {
    schema: "ordax.verified-app-store-catalog/1",
    state: "ready",
    sequence,
    catalogSha256: "f".repeat(64),
    source: {
      repository: "washingtonmsdj/ordax-apps",
      commit: COMMIT,
    },
    trust: {
      domain: "runtime-components",
      keyId: "ordax-runtime-components-v1",
    },
    entries: [
      {
        appId: "notes",
        title: "Notas",
        version: "0.4.3",
        releaseMode: "component-slot",
        sourceCommit: COMMIT,
        artifacts: {
          package: artifact("notes.zip", "b"),
          release: artifact("notes.release.json", "c"),
          compatibility: artifact("notes.compatibility.json", "d"),
        },
      },
    ],
    reason: null,
    authority: "none",
  };
}

function response(value, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return value;
    },
  };
}

test("Native verified Store adapter exposes only authority-free snapshot port", async () => {
  const calls = [];
  const runtime = await createNativeVerifiedAppStoreCatalog({
    async fetch(url, options) {
      calls.push({ url, options });
      return response(ready());
    },
  });

  assert.equal(runtime.port.schema, VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA);
  assert.equal(runtime.port.authority, "none");
  assert.equal(runtime.port.getSnapshot().state, "ready");
  assert.equal(runtime.port.getSnapshot().entries[0].appId, "notes");
  for (const forbidden of [
    "install", "update", "remove", "uninstall", "stage", "promote",
    "rollback", "execute", "invoke", "run", "writeFile", "grant", "authorize",
  ]) {
    assert.equal(runtime.port[forbidden], undefined);
  }
  assert.deepEqual(calls, [{
    url: "/__ordax/native/store-catalog",
    options: {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    },
  }]);
  runtime.destroy();
});

test("Native verified Store adapter fails closed on transport or HTTP failure", async () => {
  for (const fetchImpl of [
    async () => { throw new Error("offline"); },
    async () => response({}, { ok: false, status: 503 }),
  ]) {
    const runtime = await createNativeVerifiedAppStoreCatalog({ fetch: fetchImpl });
    const snapshot = runtime.port.getSnapshot();
    assert.equal(snapshot.state, "unavailable");
    assert.equal(snapshot.reason, "native-store-catalog-unavailable");
    assert.deepEqual(snapshot.entries, []);
    runtime.destroy();
  }
});

test("Native verified Store adapter refreshes subscribers without retaining stale ready state", async () => {
  let current = ready(4);
  const runtime = await createNativeVerifiedAppStoreCatalog({
    async fetch() {
      return response(current);
    },
  });
  const seen = [];
  const unsubscribe = runtime.port.subscribe((snapshot) => {
    seen.push(snapshot.state);
  });

  current = {
    schema: "ordax.verified-app-store-catalog/1",
    state: "unavailable",
    sequence: null,
    catalogSha256: null,
    source: null,
    trust: null,
    entries: [],
    reason: "catalog-envelope-unavailable",
    authority: "none",
  };
  await runtime.refresh();
  assert.equal(runtime.port.getSnapshot().state, "unavailable");
  assert.deepEqual(runtime.port.getSnapshot().entries, []);
  assert.deepEqual(seen, ["unavailable"]);

  unsubscribe();
  runtime.destroy();
});
