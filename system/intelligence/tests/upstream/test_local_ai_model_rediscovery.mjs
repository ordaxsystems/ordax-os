// Regression adapted from ordax-os/tests/test_local_ai_model_rediscovery.mjs @ c65b2d1410d8837f1df6788082b987b35bc65b68
import assert from "node:assert/strict";
import test from "node:test";

import { createLocalAiRuntime } from "./runtime-adapter.mjs";

function modelResponse(id) {
  return {
    ok: true,
    async json() {
      return { data: [{ id }] };
    },
  };
}

function modelListResponse(ids) {
  return {
    ok: true,
    async json() {
      return { data: ids.map((id) => ({ id })) };
    },
  };
}

test("dynamically discovered Local AI model refreshes on each explicit probe", async () => {
  let discoveryCalls = 0;
  const requests = [];
  const runtime = createLocalAiRuntime({
    modelId: null,
    fetchImpl: async (url) => {
      requests.push(new URL(url).pathname);
      if (url.endsWith("/v1/models")) {
        discoveryCalls += 1;
        return modelResponse(discoveryCalls === 1 ? "model-a" : "model-b");
      }
      if (url.endsWith("/health")) return { ok: true };
      throw new Error("unexpected request");
    },
  });

  await runtime.probe();
  assert.equal(runtime.getSnapshot().state, "ready");
  assert.equal(runtime.getSnapshot().modelId, "model-a");

  await runtime.probe();
  assert.equal(runtime.getSnapshot().state, "ready");
  assert.equal(runtime.getSnapshot().modelId, "model-b");
  assert.deepEqual(requests, [
    "/v1/models",
    "/health",
    "/v1/models",
    "/health",
  ]);
});

test("dynamic model discovery fails closed when backend exposes multiple models", async () => {
  let healthCalls = 0;
  const runtime = createLocalAiRuntime({
    modelId: null,
    fetchImpl: async (url) => {
      if (url.endsWith("/v1/models")) {
        return modelListResponse(["model-a", "model-b"]);
      }
      if (url.endsWith("/health")) {
        healthCalls += 1;
        return { ok: true };
      }
      throw new Error("unexpected request");
    },
  });

  await runtime.probe();
  assert.equal(runtime.getSnapshot().state, "unavailable");
  assert.equal(runtime.getSnapshot().engineId, null);
  assert.equal(runtime.getSnapshot().modelId, null);
  assert.equal(healthCalls, 0);
  await assert.rejects(() => runtime.generate({ prompt: "must not pick first model" }), /not ready/);
});

test("failed generation rediscovery adopts a new dynamic model without retrying the failed prompt", async () => {
  let discoveryCalls = 0;
  let generationCalls = 0;
  const requestedModels = [];
  const runtime = createLocalAiRuntime({
    modelId: null,
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/v1/models")) {
        discoveryCalls += 1;
        return modelResponse(discoveryCalls === 1 ? "model-a" : "model-b");
      }
      if (url.endsWith("/health")) return { ok: true };
      if (url.endsWith("/v1/chat/completions")) {
        generationCalls += 1;
        requestedModels.push(JSON.parse(options.body).model);
        if (generationCalls === 1) return { ok: false, status: 404 };
        return {
          ok: true,
          async json() {
            return { choices: [{ message: { content: "second succeeds" }, finish_reason: "stop" }] };
          },
        };
      }
      throw new Error("unexpected request");
    },
  });

  await runtime.probe();
  assert.equal(runtime.getSnapshot().modelId, "model-a");

  await assert.rejects(
    () => runtime.generate({ prompt: "do not silently retry" }),
    /HTTP 404/,
  );
  assert.equal(generationCalls, 1);
  assert.equal(runtime.getSnapshot().state, "ready");
  assert.equal(runtime.getSnapshot().modelId, "model-b");

  const result = await runtime.generate({ prompt: "next user request" });
  assert.equal(result.text, "second succeeds");
  assert.equal(result.modelId, "model-b");
  assert.deepEqual(requestedModels, ["model-a", "model-b"]);
});

test("configured Local AI model remains fixed and never calls discovery", async () => {
  let discoveryCalls = 0;
  let healthCalls = 0;
  let generationCalls = 0;
  const runtime = createLocalAiRuntime({
    modelId: "configured-model",
    fetchImpl: async (url) => {
      if (url.endsWith("/v1/models")) {
        discoveryCalls += 1;
        return modelResponse("unexpected-model");
      }
      if (url.endsWith("/health")) {
        healthCalls += 1;
        return { ok: true };
      }
      if (url.endsWith("/v1/chat/completions")) {
        generationCalls += 1;
        if (generationCalls === 1) return { ok: false, status: 500 };
        return {
          ok: true,
          async json() {
            return { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };
          },
        };
      }
      throw new Error("unexpected request");
    },
  });

  await runtime.probe();
  assert.equal(runtime.getSnapshot().modelId, "configured-model");
  await assert.rejects(() => runtime.generate({ prompt: "fail once" }), /HTTP 500/);
  assert.equal(runtime.getSnapshot().state, "ready");
  assert.equal(runtime.getSnapshot().modelId, "configured-model");
  assert.equal(discoveryCalls, 0);
  assert.equal(healthCalls, 2);
});
