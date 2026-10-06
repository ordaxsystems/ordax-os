import assert from "node:assert/strict";
import test from "node:test";

import {
  PERSONAL_ORDAX_NATIVE_STATE_ENDPOINT,
  createNativePersonalOrdaxStateTransport,
} from "../system/adapters/native/personal-ordax-state.mjs";

function state(ownerKind = "account", ownerId = "user-1") {
  return {
    schema: "ordax.personal-work-store-state/1",
    ownerKind,
    ownerId: ownerKind === "device" ? null : ownerId,
    nextOrdinal: 1,
    workItems: [],
    activities: [],
    results: [],
    approvals: [],
    decisions: [],
    attempts: [],
  };
}

function responseJson(value, status = 200) {
  const body = JSON.stringify(value);
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json", "Content-Length": String(new TextEncoder().encode(body).byteLength) },
  });
}

function record(ownerKind = "account", ownerId = "user-1", revision = 1) {
  return {
    $schema: "ordax.native-personal-ordax-record/1",
    revision,
    ownerKind,
    ownerId: ownerKind === "device" ? null : ownerId,
    payload: JSON.stringify(state(ownerKind, ownerId)),
  };
}

test("transport reads one exact owner partition without local mirrored state", async () => {
  const requests = [];
  const windowRef = {
    async fetch(url, options) {
      requests.push({ url, options });
      return responseJson({ record: record() });
    },
  };
  const transport = createNativePersonalOrdaxStateTransport(windowRef);
  const loaded = await transport.read({ ownerKind: "account", ownerId: "user-1" });

  assert.equal(loaded.revision, 1);
  assert.equal(loaded.state.ownerId, "user-1");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, new RegExp(`^${PERSONAL_ORDAX_NATIVE_STATE_ENDPOINT}\\?`));
  assert.match(requests[0].url, /ownerKind=account/);
  assert.match(requests[0].url, /ownerId=user-1/);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(requests[0].options.credentials, "same-origin");
});

test("device owner request never invents an account owner id", async () => {
  let requestedUrl = null;
  const transport = createNativePersonalOrdaxStateTransport({
    async fetch(url) {
      requestedUrl = url;
      return responseJson({ record: record("device", null) });
    },
  });
  const loaded = await transport.read({ ownerKind: "device", ownerId: null });
  assert.equal(loaded.state.ownerKind, "device");
  assert.equal(loaded.state.ownerId, null);
  assert.match(requestedUrl, /ownerKind=device/);
  assert.doesNotMatch(requestedUrl, /ownerId=/);
});

test("CAS sends validated owner-bound state and accepts exact next revision", async () => {
  let requestBody = null;
  const transport = createNativePersonalOrdaxStateTransport({
    async fetch(url, options) {
      assert.equal(url, PERSONAL_ORDAX_NATIVE_STATE_ENDPOINT);
      requestBody = JSON.parse(options.body);
      return responseJson({ ok: true, revision: 4 });
    },
  });
  const result = await transport.compareAndSwap(
    { ownerKind: "account", ownerId: "user-1" },
    3,
    state(),
  );
  assert.deepEqual(result, { accepted: true, revision: 4 });
  assert.equal(requestBody.action, "compare-and-swap");
  assert.equal(requestBody.ownerKind, "account");
  assert.equal(requestBody.ownerId, "user-1");
  assert.equal(requestBody.expectedRevision, 3);
  assert.equal(JSON.parse(requestBody.payload).ownerId, "user-1");
});

test("CAS conflict keeps the authoritative revision unknown until explicit readback", async () => {
  const transport = createNativePersonalOrdaxStateTransport({
    async fetch() {
      return new Response(null, { status: 409 });
    },
  });
  const result = await transport.compareAndSwap(
    { ownerKind: "account", ownerId: "user-1" },
    2,
    state(),
  );
  assert.deepEqual(result, { accepted: false, revision: null });
});

test("transport rejects foreign owner record and malformed response", async () => {
  const foreign = createNativePersonalOrdaxStateTransport({
    async fetch() {
      return responseJson({ record: record("account", "other-user") });
    },
  });
  await assert.rejects(
    foreign.read({ ownerKind: "account", ownerId: "user-1" }),
    /record shape/,
  );

  const malformed = createNativePersonalOrdaxStateTransport({
    async fetch() {
      return responseJson({ record: null, extra: true });
    },
  });
  await assert.rejects(
    malformed.read({ ownerKind: "account", ownerId: "user-1" }),
    /read response shape/,
  );
});

test("Personal OrdaX adapter delegates transport mechanics to the shared bounded Native owner", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(
    new URL("../system/adapters/native/personal-ordax-state.mjs", import.meta.url),
    "utf8",
  );
  const shared = await fs.readFile(
    new URL("../system/adapters/native/bounded-json-transport.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
  assert.match(source, /createNativeBoundedJsonTransport/);
  assert.doesNotMatch(source, /new AbortController/);
  assert.doesNotMatch(source, /getReader\(\)/);

  assert.doesNotMatch(shared, /localStorage/);
  assert.doesNotMatch(shared, /XMLHttpRequest/);
  assert.match(shared, /windowRef\.fetch/);
  assert.match(shared, /new AbortController/);
  assert.match(shared, /getReader\(\)/);
  assert.match(shared, /credentials:\s*"same-origin"/);
});
