import assert from "node:assert/strict";
import test from "node:test";

import { createNativeBoundedJsonTransport } from "../system/adapters/native/bounded-json-transport.mjs";

function jsonResponse(value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function transportWith(fetchImpl, overrides = {}) {
  return createNativeBoundedJsonTransport(
    { fetch: fetchImpl },
    {
      maxResponseBytes: 256,
      maxRequestBytes: 128,
      requestTimeoutMs: 1000,
      label: "Native test",
      ...overrides,
    },
  );
}

test("transport pins cache, credentials and Native same-origin endpoint boundary", async () => {
  const calls = [];
  const transport = transportWith(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ ok: true });
  });

  const result = await transport.request(
    "/__ordax/native/example?owner=1",
    { method: "GET", operation: "load" },
    async (response) => await transport.readJson(response),
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/__ordax/native/example?owner=1");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.ok(calls[0].options.signal instanceof AbortSignal);

  for (const endpoint of [
    "https://example.com/__ordax/native/example",
    "//example.com/__ordax/native/example",
    "/api/example",
    "/__ordax/native/../outside",
  ]) {
    await assert.rejects(
      transport.request(endpoint, {}, async () => null),
      /Native JSON transport endpoint/,
    );
  }
  await assert.rejects(
    transport.request("/__ordax/native/example#fragment", {}, async () => null),
    /must not contain a fragment/,
  );
});

test("transport bounds declared and streamed response bytes before JSON parsing", async () => {
  const transport = transportWith(async () => jsonResponse({ ok: true }));

  const declaredTooLarge = new Response("{}", {
    headers: { "Content-Length": "257" },
  });
  await assert.rejects(
    transport.readJson(declaredTooLarge),
    /response exceeds its byte limit/,
  );

  const streamedTooLarge = new Response("x".repeat(257));
  await assert.rejects(
    transport.readJson(streamedTooLarge),
    /response exceeds its byte limit/,
  );
});

test("transport uses fatal UTF-8 decoding and strict JSON parsing", async () => {
  const transport = transportWith(async () => jsonResponse({ ok: true }));

  await assert.rejects(
    transport.readJson(new Response(new Uint8Array([0xff]))),
    /not valid UTF-8/,
  );
  await assert.rejects(
    transport.readJson(new Response("not-json")),
    /not valid JSON/,
  );
});

test("transport enforces bounded serialized request bodies before fetch", async () => {
  let calls = 0;
  const transport = transportWith(async () => {
    calls += 1;
    return jsonResponse({ ok: true });
  }, { maxRequestBytes: 16 });

  await assert.rejects(
    transport.request(
      "/__ordax/native/example",
      { method: "POST", operation: "mutation", body: "x".repeat(17) },
      async () => null,
    ),
    /mutation exceeds its byte limit/,
  );
  assert.equal(calls, 0);

  await assert.rejects(
    transport.request(
      "/__ordax/native/example",
      { method: "GET", body: "{}" },
      async () => null,
    ),
    /GET request cannot carry a body/,
  );
  assert.equal(calls, 0);
});

test("transport permits only GET and POST and validates timeout at construction", async () => {
  const transport = transportWith(async () => jsonResponse({ ok: true }));
  await assert.rejects(
    transport.request(
      "/__ordax/native/example",
      { method: "DELETE" },
      async () => null,
    ),
    /method is invalid/,
  );

  assert.throws(() => createNativeBoundedJsonTransport(
    { fetch: async () => jsonResponse({ ok: true }) },
    {
      maxResponseBytes: 128,
      maxRequestBytes: 128,
      requestTimeoutMs: 99,
      label: "Native test",
    },
  ), /request timeout/);
});

test("transport aborts a request that exceeds its bounded timeout", async () => {
  let observedSignal = null;
  const transport = transportWith((_, options) => {
    observedSignal = options.signal;
    return new Promise(() => {});
  }, { requestTimeoutMs: 100 });

  await assert.rejects(
    transport.request(
      "/__ordax/native/example",
      { operation: "slow load" },
      async () => null,
    ),
    /slow load timed out after 100ms/,
  );
  assert.equal(observedSignal.aborted, true);
});
