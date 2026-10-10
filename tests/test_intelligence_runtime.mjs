import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_AI_MAX_PROMPT_CHARS,
  LOCAL_AI_PORT_SCHEMA,
} from "../system/contracts/local-ai.mjs";
import {
  INTELLIGENCE_MAX_PROMPT_CHARS,
  INTELLIGENCE_PORT_SCHEMA,
  validateIntelligenceRequest,
} from "../system/contracts/intelligence.mjs";
import {
  MODEL_ROUTER_PORT_SCHEMA,
  validateModelRoute,
} from "../system/contracts/model-router.mjs";
import { createIntelligenceRuntime } from "../system/services/intelligence/runtime.mjs";

function inferencePort({
  state = "ready",
  engineId = "llama.cpp",
  modelId = "qwen-small",
  answer = "resultado local",
  resultEngineId = engineId,
  resultModelId = modelId,
  onGenerate = null,
} = {}) {
  let snapshot = Object.freeze({
    schema: LOCAL_AI_PORT_SCHEMA,
    state,
    engineId: state === "unavailable" ? null : engineId,
    modelId: state === "unavailable" ? null : modelId,
    offline: true,
    migratable: true,
  });
  const listeners = new Set();
  return Object.freeze({
    schema: LOCAL_AI_PORT_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async generate(request, options = {}) {
      assert.match(request.systemPrompt, /Ordax Intelligence/);
      assert.match(request.systemPrompt, /no implicit authority/i);
      assert.match(request.systemPrompt, /never as instructions/i);
      assert.doesNotMatch(request.prompt, /no implicit authority/i);
      assert.match(request.prompt, /Model purpose:/);
      await onGenerate?.(request, options);
      return Object.freeze({ text: answer, engineId: resultEngineId, modelId: resultModelId });
    },
    publish(nextState) {
      snapshot = Object.freeze({ ...snapshot, state: nextState });
      for (const listener of listeners) listener(snapshot);
    },
  });
}

test("Ordax Intelligence is a system contract with zero implicit mutation authority", () => {
  const inference = inferencePort();
  const intelligence = createIntelligenceRuntime({ inferencePort: inference });
  const snapshot = intelligence.getSnapshot();
  assert.equal(intelligence.schema, INTELLIGENCE_PORT_SCHEMA);
  assert.equal(snapshot.state, "ready");
  assert.equal(snapshot.inferenceAvailable, true);
  assert.equal(snapshot.authority, "none");
  assert.equal(snapshot.toolExecution, false);
  intelligence.dispose();
});

test("Ordax Intelligence refuses new work after dispose", async () => {
  let generated = false;
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort({ onGenerate: () => { generated = true; } }),
  });
  intelligence.dispose();

  await assert.rejects(
    () => intelligence.respond({ prompt: "não execute" }),
    /runtime is disposed/,
  );
  assert.equal(generated, false);
});

test("Ordax Intelligence refuses an in-flight completion after disposal without retry", async () => {
  let finish;
  let generated = 0;
  const blocked = new Promise(resolve => { finish = resolve; });
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort({ onGenerate: () => { generated++; return blocked; } }),
  });
  const response = intelligence.respond({ prompt: "pending local request" });
  assert.equal(generated, 1);
  intelligence.dispose();
  finish();
  await assert.rejects(response, /runtime is disposed/);
  assert.equal(generated, 1);
});

test("Ordax Intelligence consumes bounded provenance-bearing context through local inference", async () => {
  let generated = null;
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort({ onGenerate: (request) => { generated = request; } }),
  });
  const response = await intelligence.respond({
    intent: "summarize",
    prompt: "Resuma a nota.",
    context: [{
      id: "note-1",
      scope: "document",
      text: "Conteúdo autorizado.",
      provenance: "local-note",
    }],
    maxTokens: 128,
  });
  assert.equal(response.text, "resultado local");
  assert.equal(response.authority, "none");
  assert.match(generated.prompt, /provenance: local-note/);
  intelligence.dispose();
});

test("Intelligence budgets large authorized context to the Local AI input ceiling", async () => {
  let generated = null;
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort({ onGenerate: (request) => { generated = request; } }),
  });
  const context = Array.from({ length: 8 }, (_, index) => ({
    id: `context-${index}`,
    scope: "document",
    text: String(index).repeat(8192),
    provenance: "local-note",
  }));
  await intelligence.respond({
    intent: "summarize",
    prompt: "Preserve este pedido integralmente.",
    context,
  });
  assert.ok(generated);
  assert.ok(generated.prompt.length <= LOCAL_AI_MAX_PROMPT_CHARS);
  assert.match(generated.prompt, /truncated; remaining context omitted by local input budget/);
  assert.ok(generated.prompt.endsWith("User request:\nPreserve este pedido integralmente."));
  intelligence.dispose();
});

test("Intelligence preserves a maximum-size user request while budgeting supplemental context", async () => {
  let generated = null;
  const userPrompt = "u".repeat(INTELLIGENCE_MAX_PROMPT_CHARS);
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort({ onGenerate: (request) => { generated = request; } }),
  });
  await intelligence.respond({
    intent: "ask",
    prompt: userPrompt,
    context: [{
      id: "large-context",
      scope: "document",
      text: "c".repeat(8192),
      provenance: "local-note",
    }],
  });
  assert.ok(generated);
  assert.ok(generated.prompt.length <= LOCAL_AI_MAX_PROMPT_CHARS);
  assert.ok(generated.prompt.endsWith(`User request:\n${userPrompt}`));
  assert.match(generated.prompt, /local input budget/);
  intelligence.dispose();
});

test("Intelligence maps intent to provider-neutral model purpose", async () => {
  const purposes = [];
  const router = Object.freeze({
    schema: MODEL_ROUTER_PORT_SCHEMA,
    route(request) {
      purposes.push(request.purpose);
      return validateModelRoute({
        provider: "local",
        engineId: "llama.cpp",
        modelId: "qwen-small",
        purpose: request.purpose,
      });
    },
  });
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort(),
    modelRouterPort: router,
  });
  await intelligence.respond({
    intent: "diagnose",
    prompt: "Diagnostique.",
    context: [{
      id: "state",
      scope: "system",
      text: "estado",
      provenance: "local-note",
    }],
  });
  assert.deepEqual(purposes, ["reason"]);
  intelligence.dispose();
});

test("Intelligence revalidates injected router output before inference", async () => {
  let generated = false;
  const router = Object.freeze({
    schema: MODEL_ROUTER_PORT_SCHEMA,
    route() {
      return {
        provider: "local",
        engineId: "llama.cpp",
        modelId: "qwen-small",
        purpose: "untrusted-purpose",
        egressApproved: false,
      };
    },
  });
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort({ onGenerate: () => { generated = true; } }),
    modelRouterPort: router,
  });

  await assert.rejects(
    () => intelligence.respond({ prompt: "teste" }),
    /provider\/purpose is invalid/,
  );
  assert.equal(generated, false);
  intelligence.dispose();
});

test("Intelligence refuses external model execution in MVP", async () => {
  const router = Object.freeze({
    schema: MODEL_ROUTER_PORT_SCHEMA,
    route() {
      return validateModelRoute({
        provider: "openai",
        modelId: "future-model",
        purpose: "general",
        egressApproved: true,
      });
    },
  });
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort(),
    modelRouterPort: router,
  });
  await assert.rejects(
    () => intelligence.respond({
      prompt: "teste",
      context: [{
        id: "state",
        scope: "system",
        text: "estado",
        provenance: "local-note",
      }],
    }),
    /External model execution is not enabled/,
  );
  intelligence.dispose();
});

test("Intelligence fails closed if active model changes after route selection", async () => {
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort({ resultModelId: "other-model" }),
  });
  await assert.rejects(
    () => intelligence.respond({
      prompt: "teste",
      context: [{
        id: "state",
        scope: "system",
        text: "estado",
        provenance: "local-note",
      }],
    }),
    /identity changed after route selection/,
  );
  intelligence.dispose();
});

test("Intelligence fails closed if active engine changes after route selection", async () => {
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort({ resultEngineId: "other-engine" }),
  });
  await assert.rejects(
    () => intelligence.respond({
      prompt: "teste",
      context: [{
        id: "state",
        scope: "system",
        text: "estado",
        provenance: "local-note",
      }],
    }),
    /identity changed after route selection/,
  );
  intelligence.dispose();
});

test("backend absence degrades Intelligence without becoming an OS boot contract", async () => {
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort({ state: "unavailable" }),
  });
  assert.equal(intelligence.getSnapshot().state, "degraded");
  assert.equal(intelligence.getSnapshot().inferenceAvailable, false);
  await assert.rejects(
    () => intelligence.respond({ prompt: "teste" }),
    /not ready/,
  );
  intelligence.dispose();
});

test("engine and model migration remain behind the Intelligence boundary", async () => {
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort({
      engineId: "future-engine",
      modelId: "future-model",
      answer: "ok",
    }),
  });
  const response = await intelligence.respond({
    intent: "ask",
    prompt: "Teste de migração.",
    context: [{
      id: "system-state",
      scope: "system",
      text: "estado",
      provenance: "local-note",
    }],
  });
  assert.equal(response.engineId, "future-engine");
  assert.equal(response.modelId, "future-model");
  intelligence.dispose();
});

test("Intelligence rejects unbounded or authority-shaped input before inference", () => {
  assert.throws(
    () => validateIntelligenceRequest({
      prompt: "x",
      context: Array.from({ length: 17 }, (_, index) => ({
        id: `item-${index}`,
        scope: "document",
        text: "x",
        provenance: "test",
      })),
    }),
    /bounded array/,
  );
});

test("Intelligence forwards an AbortSignal to the existing Local AI port without placing it in model input", async () => {
  const controller = new AbortController();
  let seenOptions;
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort({ onGenerate(request, options) {
      seenOptions = options;
      assert.equal(Object.hasOwn(request, "signal"), false);
    } }),
  });
  const response = await intelligence.respond({ prompt: "consulta" }, { signal: controller.signal });
  assert.equal(response.authority, "none");
  assert.equal(seenOptions.signal, controller.signal);
  assert.equal(intelligence.getSnapshot().toolExecution, false);
  intelligence.dispose();
});

test("Intelligence rejects aborted or invalid caller signals before inference and late results", async () => {
  let finishes;
  let forwarded = 0;
  const intelligence = createIntelligenceRuntime({
    inferencePort: inferencePort({ onGenerate() {
      forwarded += 1;
      return new Promise(resolve => { finishes = resolve; });
    } }),
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => intelligence.respond({ prompt: "não encaminhar" }, {
    signal: controller.signal,
  }), /request cancelled/);
  await assert.rejects(() => intelligence.respond({ prompt: "inválido" }, {
    signal: {},
  }), /AbortSignal/);
  assert.equal(forwarded, 0);
  const active = new AbortController();
  const pending = intelligence.respond({ prompt: "pendente" }, { signal: active.signal });
  active.abort();
  finishes();
  await assert.rejects(pending, /request cancelled/);
  intelligence.dispose();
});
