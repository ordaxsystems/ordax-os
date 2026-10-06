import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_NATIVE_STATE_ENDPOINT,
  createNativeProjectStateTransport,
} from "../system/adapters/native/project-state.mjs";

function state() {
  return {
    nextOrdinal: 2,
    projects: [{
      id: "project-1",
      name: "Finance App",
      path: "/Documentos/finance-app",
      createdAt: 1000,
      lastOpenedAt: 2000,
      lastFilePath: "/Documentos/finance-app/README.md",
    }],
  };
}

function responseJson(value, status = 200) {
  const body = JSON.stringify(value);
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(new TextEncoder().encode(body).byteLength),
    },
  });
}

function record(revision = 1, value = state()) {
  return {
    $schema: "ordax.native-project-store-record/1",
    revision,
    formatVersion: 1,
    state: value,
  };
}

test("Project Native transport reads one canonical device catalog", async () => {
  const requests = [];
  const transport = createNativeProjectStateTransport({
    async fetch(url, options) {
      requests.push({ url, options });
      return responseJson({ record: record() });
    },
  });

  const loaded = await transport.read();
  assert.equal(loaded.revision, 1);
  assert.deepEqual(loaded.state, state());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, PROJECT_NATIVE_STATE_ENDPOINT);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(requests[0].options.credentials, "same-origin");
});

test("Project Native CAS sends validated state and accepts only exact next revision", async () => {
  let requestBody = null;
  const transport = createNativeProjectStateTransport({
    async fetch(url, options) {
      assert.equal(url, PROJECT_NATIVE_STATE_ENDPOINT);
      requestBody = JSON.parse(options.body);
      return responseJson({ ok: true, revision: 4 });
    },
  });

  const result = await transport.compareAndSwap(3, state());
  assert.deepEqual(result, { accepted: true, revision: 4 });
  assert.deepEqual(requestBody, {
    action: "compare-and-swap",
    expectedRevision: 3,
    state: state(),
  });
});

test("Project Native CAS conflict does not guess the authoritative revision", async () => {
  const transport = createNativeProjectStateTransport({
    async fetch() {
      return new Response(null, { status: 409 });
    },
  });
  assert.deepEqual(
    await transport.compareAndSwap(2, state()),
    { accepted: false, revision: null },
  );
});

test("Project Native transport rejects incompatible records and response envelopes", async () => {
  const incompatible = createNativeProjectStateTransport({
    async fetch() {
      return responseJson({ record: { ...record(), formatVersion: 2 } });
    },
  });
  await assert.rejects(incompatible.read(), /record shape/);

  const malformed = createNativeProjectStateTransport({
    async fetch() {
      return responseJson({ record: record(), extra: true });
    },
  });
  await assert.rejects(malformed.read(), /read response shape/);
});

test("persisted terminal safe revision remains readable while another CAS is impossible", async () => {
  const terminal = createNativeProjectStateTransport({
    async fetch() {
      return responseJson({ record: record(Number.MAX_SAFE_INTEGER) });
    },
  });
  assert.equal((await terminal.read()).revision, Number.MAX_SAFE_INTEGER);

  await assert.rejects(
    terminal.compareAndSwap(Number.MAX_SAFE_INTEGER, state()),
    /expected revision is invalid/,
  );
});

test("Project Native transport delegates HTTP mechanics to the shared bounded transport", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(
    new URL("../system/adapters/native/project-state.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /createNativeBoundedJsonTransport/);
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
  assert.doesNotMatch(source, /new AbortController/);
  assert.doesNotMatch(source, /getReader\(\)/);
});
