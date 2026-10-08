import assert from "node:assert/strict";
import test from "node:test";

import { createLocalAiRuntime } from "../system/services/local-ai/runtime.mjs";
import { LOCAL_AI_NATIVE_ENDPOINT } from "../system/contracts/local-ai.mjs";

const create = (endpoint) => createLocalAiRuntime({
  endpoint,
  modelId: "x",
  fetchImpl: async () => ({ ok: false }),
});

test("Local AI accepts only literal 127.0.0.1 HTTP endpoints", () => {
  assert.doesNotThrow(() => create("http://127.0.0.1:17865"));
  assert.doesNotThrow(() => create(LOCAL_AI_NATIVE_ENDPOINT));
  assert.doesNotThrow(() => create("http://127.0.0.1:17865/base/path?ignored=true#fragment"));

  for (const endpoint of [
    "/__ordax/native/local-ai/",
    "/__ordax/native/local-ai?x=1",
    "/__ordax/native/local-ai/v1/models",
    "//127.0.0.1:17865",
    "http://localhost:17865",
    "http://127.0.0.2:17865",
    "https://127.0.0.1:17865",
    "https://example.com",
    "http://2130706433:17865",
    "http://127.1:17865",
    "http://0177.0.0.1:17865",
    "http://0x7f000001:17865",
    "http://user:pass@127.0.0.1:17865",
    "http://127.0.0.1.:17865",
    "HTTP://127.0.0.1:17865",
    "http://127.0.0.1:99999",
    "http://127.0.0.1:@example.com",
  ]) {
    assert.throws(
      () => create(endpoint),
      /literal 127\.0\.0\.1 HTTP/,
      endpoint,
    );
  }
});

test("Native same-origin endpoint emits only the dedicated broker paths", async () => {
  const visited = [];
  const port = createLocalAiRuntime({
    endpoint: LOCAL_AI_NATIVE_ENDPOINT,
    modelId: null,
    fetchImpl: async (url) => {
      visited.push(url);
      if (url.endsWith("/v1/models")) {
        return {
          ok: true,
          async json() { return { data: [{ id: "model-a" }] }; },
        };
      }
      if (url.endsWith("/health")) return { ok: true };
      throw new Error("unexpected Native endpoint");
    },
  });
  await port.probe();
  assert.equal(port.getSnapshot().state, "ready");
  assert.deepEqual(visited, [
    LOCAL_AI_NATIVE_ENDPOINT + "/v1/models",
    LOCAL_AI_NATIVE_ENDPOINT + "/health",
  ]);
  port.dispose();
});
