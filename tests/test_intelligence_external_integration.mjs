// Regression proof: verified external Intelligence source + canonical OS validators.
// No test doubles for public contracts; fetch response simulates a local backend.
// No inference engine, model, signature, physical device, or lifecycle is asserted.
import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import * as intelligenceContracts from "../system/contracts/intelligence.mjs";
import * as localAiContracts from "../system/contracts/local-ai.mjs";
import * as modelRouterContracts from "../system/contracts/model-router.mjs";
import * as hardwareContracts from "../system/contracts/hardware-inventory.mjs";
import * as metricsContracts from "../system/contracts/system-metrics.mjs";
import { BUNDLED_LOCAL_AI_MODEL_CANDIDATE } from "../system/services/local-ai/model-candidate.generated.mjs";

const stage = process.env.ORDAX_INTELLIGENCE_STAGE ?? null;
const skip = stage === null ? "External verified Intelligence stage not provided" : false;
const base = stage === null ? null : resolve(stage, "system/intelligence-source/src/index.mjs");
let bound;
const fetchExternal = async () => {
  const { bindIntelligenceContracts, bindLocalAiContracts, bindModelRouterContracts, bindModelCompatibilityContracts } =
    await import(pathToFileURL(base).href);
  return {
    ...bindIntelligenceContracts({
      intelligence: intelligenceContracts, localAi: localAiContracts, modelRouter: modelRouterContracts,
    }),
    ...bindLocalAiContracts(localAiContracts),
    ...bindModelRouterContracts({ localAi: localAiContracts, modelRouter: modelRouterContracts }),
    ...bindModelCompatibilityContracts({
      hardware: hardwareContracts, systemMetrics: metricsContracts, candidate: BUNDLED_LOCAL_AI_MODEL_CANDIDATE,
    }),
  };
};

test("OS contract schemas bind to source-only Intelligence and prevent implicit authority", { skip }, async () => {
  const expected = JSON.parse(readFileSync(join(stage, "intelligence-source-receipt.json"), "utf8"));
  assert.equal(expected.source_repository, "ordaxsystems/ordax-intelligence");
  assert.equal(expected.activation_authorized, false);
  assert.equal(expected.engine_included, false);
  assert.equal(expected.model_included, false);
  const { createIntelligenceRuntime, createLocalAiRuntime } = await fetchExternal();
  const requests = [];
  const local = createLocalAiRuntime({
    modelId: "reviewed-test-model",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith("/health")) return new Response("", { status: 200 });
      if (url.endsWith("/v1/chat/completions"))
        return new Response(JSON.stringify({
          model: "reviewed-test-model",
          choices: [{
            index: 0,
            message: { role: "assistant", content: "resultado verificado" },
            finish_reason: "stop",
          }],
        }), { status: 200 });
      throw new Error("Unexpected endpoint");
    },
  });
  await local.probe();
  const runtime = createIntelligenceRuntime({ inferencePort: local });
  assert.equal(runtime.schema, "ordax.intelligence/1");
  assert.equal(runtime.getSnapshot().authority, "none");
  assert.equal(runtime.getSnapshot().toolExecution, false);
  const response = await runtime.respond({ intent: "explain", prompt: "Interpretar dados sem executar ações." });
  assert.equal(response.text, "resultado verificado");
  assert.equal(response.authority, "none");
  assert.equal(requests.length, 2);
  const request = JSON.parse(requests[1].options.body);
  assert.equal(request.model, "reviewed-test-model");
  assert.equal(request.messages[0].role, "system");
  assert.equal(request.messages[1].role, "user");
  runtime.dispose();
  local.dispose();
});
test("absent inference remains degraded and cannot block Intelligence composition", { skip }, async () => {
  const { createIntelligenceRuntime, createLocalAiRuntime } = await fetchExternal();
  const local = createLocalAiRuntime({ modelId: null, fetchImpl: async () => { throw new Error("backend offline"); } });
  const runtime = createIntelligenceRuntime({ inferencePort: local });
  await local.probe();
  assert.equal(runtime.getSnapshot().state, "degraded");
  await assert.rejects(runtime.respond({ prompt: "Do not replay me" }), /not ready/);
  runtime.dispose();
  local.dispose();
});
test("model router refuses cloud execution and compatibility preview cannot grant installation", { skip }, async () => {
  const { createModelRouterRuntime, createLocalAiRuntime, assessBundledLocalAiModel } = await fetchExternal();
  const local = createLocalAiRuntime({ modelId: "test", fetchImpl: async () => new Response("",{status:200}) });
  await local.probe();
  const router = createModelRouterRuntime({ localPort: local });
  assert.throws(() => router.route({ provider: "openai", egressApproved: true }), /not enabled/);
  const preview = assessBundledLocalAiModel();
  assert.equal(preview.status, "device-not-assessed");
  assert.equal(preview.installedOrUpdateVerified, false);
  assert.equal(preview.independentInstallAvailable, false);
  local.dispose();
});
test("SSE remains provisional and final validated text is returned through the OS Intelligence port", { skip }, async () => {
  const { createIntelligenceRuntime, createLocalAiRuntime } = await fetchExternal();
  const frames = [
    { model: "test-model", choices: [{ index: 0, delta: { content: "Olá" }, finish_reason: null }] },
    { model: "test-model", choices: [{ index: 0, delta: { content: " mundo" }, finish_reason: "stop" }] },
  ];
  const body = frames.map(frame=>"data: "+JSON.stringify(frame)+"\n\n").join("")+"data: [DONE]\n\n";
  const local = createLocalAiRuntime({
    modelId: "test-model",
    fetchImpl: async (url) => url.endsWith("/health")
      ? new Response("", { status:200 })
      : new Response(body, { status:200,headers:{"content-type":"text/event-stream"} }),
  });
  await local.probe();
  const runtime = createIntelligenceRuntime({ inferencePort: local });
  const deltas=[];
  const response = await runtime.respond({ prompt: "responda" }, { onDelta: part => { deltas.push(part); } });
  assert.deepEqual(deltas, ["Olá"," mundo"]);
  assert.equal(response.text, "Olá mundo");
  assert.equal(response.authority, "none");
  runtime.dispose();
  local.dispose();
});
