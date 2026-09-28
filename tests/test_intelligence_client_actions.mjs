import assert from "node:assert/strict";
import test from "node:test";

import { INTELLIGENCE_PORT_SCHEMA } from "../system/contracts/intelligence.mjs";
import {
  createDocumentIntelligenceContext,
  explainSystemStateWithIntelligence,
  summarizeDocumentWithIntelligence,
} from "../system/services/intelligence/client-actions.mjs";

function intelligencePort() {
  const requests = [];
  return Object.freeze({
    requests,
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return Object.freeze({
        schema: INTELLIGENCE_PORT_SCHEMA,
        state: "ready",
        inferenceAvailable: true,
        engineId: "test-engine",
        modelId: "test-model",
        authority: "none",
        toolExecution: false,
      });
    },
    subscribe() {
      return () => {};
    },
    async respond(request) {
      requests.push(request);
      return Object.freeze({
        schema: "ordax.intelligence-response/1",
        text: "resposta consultiva",
        engineId: "test-engine",
        modelId: "test-model",
        authority: "none",
      });
    },
  });
}

test("document summary sends bounded provenance-bearing context without mutation authority", async () => {
  const intelligence = intelligencePort();
  const longText = "conteúdo ".repeat(2000);
  const result = await summarizeDocumentWithIntelligence(intelligence, {
    id: "note-42",
    title: "Minha nota",
    text: longText,
    provenance: "notes:note-42:device-local",
  });
  assert.equal(result.text, "resposta consultiva");
  assert.equal(intelligence.requests.length, 1);
  const request = intelligence.requests[0];
  assert.equal(request.intent, "summarize");
  assert.equal(request.context.length, 1);
  assert.equal(request.context[0].scope, "document");
  assert.equal(request.context[0].provenance, "notes:note-42:device-local");
  assert.ok(request.context[0].text.length <= 8192);
  assert.match(request.context[0].text, /conteúdo truncado/);
});

test("document context accepts Notes title bounds but clips the model-facing title", () => {
  const title = "T".repeat(1024);
  const context = createDocumentIntelligenceContext({
    id: "note-long-title",
    title,
    text: "Corpo da nota",
    provenance: "ordax:notes:note-long-title:user-authorized-selection",
  });
  assert.equal(context.length, 1);
  assert.equal(context[0].scope, "document");
  assert.ok(context[0].text.length <= 8192);
  assert.match(context[0].text, /^Título: T+/);
  assert.equal(context[0].text.includes("T".repeat(513)), false);
});

test("system explanation includes only bounded host and metrics observations", async () => {
  const intelligence = intelligencePort();
  await explainSystemStateWithIntelligence(intelligence, {
    surface: {
      capabilityIds: ["system.metrics", "intelligence.system", "network.https"],
      connectivity: "online",
    },
    metrics: {
      uptimeSeconds: 123,
      memoryTotalBytes: 1000,
      memoryAvailableBytes: 400,
      userStorageTotalBytes: 5000,
      userStorageFreeBytes: 3000,
    },
  });
  const request = intelligence.requests[0];
  assert.equal(request.intent, "diagnose");
  assert.equal(request.context[0].scope, "system");
  assert.equal(request.context[0].provenance, "ordax-system-local-snapshot");
  const payload = JSON.parse(request.context[0].text);
  assert.equal(payload.connectivity, "online");
  assert.deepEqual(payload.capabilityIds, [
    "intelligence.system",
    "network.https",
    "system.metrics",
  ]);
  assert.deepEqual(payload.metrics, {
    uptimeSeconds: 123,
    memoryTotalBytes: 1000,
    memoryAvailableBytes: 400,
    userStorageTotalBytes: 5000,
    userStorageFreeBytes: 3000,
  });
  assert.equal("prompt" in payload, false);
  assert.equal("files" in payload, false);
});
