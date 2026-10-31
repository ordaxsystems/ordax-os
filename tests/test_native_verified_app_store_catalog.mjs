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
      repository: "ordaxsystems/ordax-apps",
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
          componentEnvelope: artifact("notes.runtime-component-envelope.json", "6"),
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
  assert.equal(calls.length, 1);
  const [{ url, options }] = calls;
  const { signal, ...requestOptions } = options;
  assert.equal(url, "/__ordax/native/store-catalog");
  assert.equal(signal instanceof AbortSignal, true);
  assert.equal(signal.aborted, false);
  assert.deepEqual(requestOptions, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
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
  assert.deepEqual(seen, ["unavailable", "unavailable"]);

  unsubscribe();
  runtime.destroy();
});

test("Native refresh revokes old candidates before an asynchronous verifier read settles", async () => {
  let reads = 0;
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  const runtime = await createNativeVerifiedAppStoreCatalog({
    async fetch() {
      reads += 1;
      if (reads === 1) return response(ready(4));
      if (reads === 2) return slow;
      return response(ready(6));
    },
  });
  const seen = [];
  runtime.port.subscribe((next) => seen.push({
    state: next.state, sequence: next.sequence, reason: next.reason,
  }));

  const pendingOld = runtime.refresh();
  const revoked = runtime.port.getSnapshot();
  assert.equal(revoked.state, "unavailable");
  assert.equal(revoked.reason, "native-store-catalog-refreshing");
  assert.equal(revoked.sequence, null);
  assert.deepEqual(revoked.entries, []);

  // A second verification supersedes the unfinished first read. Out-of-order
  // completion cannot resurrect its old signed inventory.
  const pendingNew = runtime.refresh();
  await pendingNew;
  assert.equal(runtime.port.getSnapshot().state, "ready");
  assert.equal(runtime.port.getSnapshot().sequence, 6);
  releaseSlow(response(ready(5)));
  await pendingOld;
  assert.equal(runtime.port.getSnapshot().sequence, 6);
  assert.deepEqual(seen.map((item) => item.state), ["unavailable", "ready"]);
  runtime.destroy();
  assert.equal(runtime.port.getSnapshot().state, "unavailable");
  assert.equal(runtime.port.getSnapshot().reason, "native-store-catalog-disposed");
  assert.deepEqual(runtime.port.getSnapshot().entries, []);
  assert.equal(seen.at(-1).state, "unavailable");

  const before = reads;
  await runtime.refresh();
  assert.equal(reads, before, "disposed verifier must not make another Native request");
  assert.equal(runtime.port.getSnapshot().state, "unavailable");
});

test("destroy during outstanding Native read leaves no usable catalog", async () => {
  let resolveDelayed;
  const delayed = new Promise((resolve) => { resolveDelayed = resolve; });
  let reads = 0;
  const runtime = await createNativeVerifiedAppStoreCatalog({
    async fetch() {
      reads += 1;
      return reads === 1 ? response(ready(4)) : delayed;
    },
  });
  const pending = runtime.refresh();
  assert.equal(runtime.port.getSnapshot().state, "unavailable");
  runtime.destroy();
  resolveDelayed(response(ready(8)));
  await pending;
  assert.equal(runtime.port.getSnapshot().state, "unavailable");
  assert.equal(runtime.port.getSnapshot().reason, "native-store-catalog-disposed");
  assert.deepEqual(runtime.port.getSnapshot().entries, []);
});

test("an uncooperative Native catalog read has a bounded deadline and cannot expose stale candidates", async () => {
  let abortedSignal = null;
  const runtime = await createNativeVerifiedAppStoreCatalog({
    fetch(_url, options) {
      abortedSignal = options.signal;
      return new Promise(() => {}); // Host transport ignores AbortSignal.
    },
  }, { timeoutMs: 15 });
  const snapshot = runtime.port.getSnapshot();
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.reason, "native-store-catalog-unavailable");
  assert.deepEqual(snapshot.entries, []);
  assert.equal(abortedSignal.aborted, true);
  runtime.destroy();
});

test("superseding or destroying a noncooperative catalog read settles its pending refresh", async () => {
  let fetchCount = 0;
  let abandonedSignal = null;
  const runtime = await createNativeVerifiedAppStoreCatalog({
    async fetch(_url, options) {
      fetchCount += 1;
      if (fetchCount === 2) {
        abandonedSignal = options.signal;
        return new Promise(() => {});
      }
      return response(ready(fetchCount + 3));
    },
  }, { timeoutMs: 2_000 });

  const abandoned = runtime.refresh();
  assert.equal(runtime.port.getSnapshot().state, "unavailable");
  const newer = runtime.refresh();
  await newer;
  await abandoned;
  assert.equal(abandonedSignal.aborted, true);
  assert.equal(runtime.port.getSnapshot().state, "ready");
  assert.equal(runtime.port.getSnapshot().sequence, 6);

  const originalFetch = runtime.port.getSnapshot();
  // Disposal never exposes the last ready catalog to retained readers.
  assert.equal(originalFetch.state, "ready");
  runtime.destroy();
  assert.equal(runtime.port.getSnapshot().state, "unavailable");
  assert.equal(fetchCount, 3);
});

test("catalog deadline setting fails closed for invalid and unbounded values", async () => {
  for (const invalid of [0, -1, 30_001, 2.5, Infinity, "5000", NaN]) {
    await assert.rejects(createNativeVerifiedAppStoreCatalog({
      async fetch() { throw new Error("must never fetch"); },
    }, { timeoutMs: invalid }), /bounded positive integer/);
  }
});

test("disposing during a noncooperative Native fetch settles without awaiting host response", async () => {
  let requestedSignal;
  let fetchCount = 0;
  const runtime = await createNativeVerifiedAppStoreCatalog({
    fetch(_url, options) {
      fetchCount += 1;
      if (fetchCount === 1) return Promise.resolve(response(ready()));
      requestedSignal = options.signal;
      return new Promise(() => {});
    },
  }, { timeoutMs: 2_000 });
  const pending = runtime.refresh();
  assert.equal(runtime.port.getSnapshot().state, "unavailable");
  runtime.destroy();
  await pending;
  assert.equal(requestedSignal.aborted, true);
  assert.equal(runtime.port.getSnapshot().state, "unavailable");
  assert.equal(runtime.port.getSnapshot().reason, "native-store-catalog-disposed");
  assert.deepEqual(runtime.port.getSnapshot().entries, []);
});

test("timed-out revalidation cannot resurrect signed install candidates, but a later verified read can recover", async () => {
  let count = 0;
  let stalledSignal;
  const runtime = await createNativeVerifiedAppStoreCatalog({
    async fetch(_url, options) {
      count += 1;
      if (count === 2) {
        stalledSignal = options.signal;
        // Even after fetch returns, a noncooperative JSON body can hang.
        return {
          ok: true, status: 200,
          json() { return new Promise(() => {}); },
        };
      }
      return response(ready(count + 3));
    },
  }, { timeoutMs: 15 });
  assert.equal(runtime.port.getSnapshot().state, "ready");
  const pending = runtime.refresh();
  assert.equal(runtime.port.getSnapshot().state, "unavailable");
  assert.deepEqual(runtime.port.getSnapshot().entries, []);
  await pending;
  assert.equal(stalledSignal.aborted, true);
  assert.equal(runtime.port.getSnapshot().state, "unavailable");
  assert.equal(runtime.port.getSnapshot().reason, "native-store-catalog-unavailable");
  await runtime.refresh();
  assert.equal(runtime.port.getSnapshot().state, "ready");
  assert.equal(runtime.port.getSnapshot().sequence, 6);
  runtime.destroy();
});
