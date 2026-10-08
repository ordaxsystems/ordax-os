import assert from "node:assert/strict";
import test from "node:test";

import { LOCAL_AI_PORT_SCHEMA } from "../system/contracts/local-ai.mjs";
import { MODEL_ROUTER_PORT_SCHEMA } from "../system/contracts/model-router.mjs";
import { createModelRouterRuntime } from "../system/services/intelligence/model-router.mjs";

function localPort({ state = "ready", engineId = "llama.cpp", modelId = "qwen-small" } = {}) {
  return Object.freeze({
    schema: LOCAL_AI_PORT_SCHEMA,
    getSnapshot() {
      return Object.freeze({
        schema: LOCAL_AI_PORT_SCHEMA,
        state,
        engineId: state === "unavailable" ? null : engineId,
        modelId: state === "unavailable" ? null : modelId,
        offline: true,
        migratable: true,
      });
    },
    subscribe() {
      return () => {};
    },
    async generate() {
      return { text: "ok", engineId, modelId };
    },
  });
}

test("model router selects the active local engine and model without egress", () => {
  const router = createModelRouterRuntime({ localPort: localPort() });
  const route = router.route({ purpose: "reason" });
  assert.equal(router.schema, MODEL_ROUTER_PORT_SCHEMA);
  assert.equal(route.provider, "local");
  assert.equal(route.engineId, "llama.cpp");
  assert.equal(route.modelId, "qwen-small");
  assert.equal(route.purpose, "reason");
  assert.equal(route.egressApproved, false);
  assert.equal(route.memoryOwner, "ordax");
});

test("model router fails closed when local inference is unavailable or busy", () => {
  for (const state of ["unavailable", "stopped", "busy", "error"]) {
    const router = createModelRouterRuntime({
      localPort: localPort({ state, modelId: state === "unavailable" ? null : "qwen-small" }),
    });
    assert.throws(
      () => router.route({ purpose: "general" }),
      /No ready local model/,
    );
  }
});

test("local model router rejects an invalid engine identity at its port boundary", () => {
  assert.throws(
    () => createModelRouterRuntime({ localPort: localPort({ engineId: "" }) }),
    /engineId is outside its allowed bounds/,
  );
});

test("external providers remain disabled even when egress approval is supplied", () => {
  const router = createModelRouterRuntime({ localPort: localPort() });
  assert.throws(
    () => router.route({
      provider: "openai",
      purpose: "general",
      egressApproved: true,
    }),
    /not enabled/,
  );
  assert.throws(
    () => router.route({
      provider: "openai",
      purpose: "general",
      egressApproved: false,
    }),
    /explicit egress approval/,
  );
});

test("model router refuses embeddings until a real local embedding backend exists", () => {
  const router = createModelRouterRuntime({ localPort: localPort() });
  assert.throws(
    () => router.route({ provider: "local", purpose: "embedding" }),
    /embedding route is unavailable/,
  );
  // Rejecting embeddings must not disable supported text inference purposes.
  for (const purpose of ["general", "reason", "summarize", "code"]) {
    assert.equal(router.route({ purpose }).purpose, purpose);
  }
});
