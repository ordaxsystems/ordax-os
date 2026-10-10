import assert from "node:assert/strict";
import test from "node:test";
import {
  INTELLIGENCE_CONVERSATION_CAPABILITIES_SCHEMA,
  projectIntelligenceConversationCapabilities,
} from "../system/contracts/intelligence-conversation-capabilities.mjs";

const ready = Object.freeze({
  schema: "ordax.intelligence/1",
  state: "ready",
  inferenceAvailable: true,
  engineId: "llama.cpp",
  modelId: "qwen-verified",
  authority: "none",
  toolExecution: false,
});

test("Conversation provider projection reuses the Intelligence snapshot without granting new authority", () => {
  const projected = projectIntelligenceConversationCapabilities(ready);
  assert.equal(projected.schema, INTELLIGENCE_CONVERSATION_CAPABILITIES_SCHEMA);
  assert.equal(projected.provider, "local");
  assert.equal(projected.engineId, "llama.cpp");
  assert.equal(projected.modelId, "qwen-verified");
  assert.equal(projected.streamingSupported, false);
  assert.equal(projected.backendCancellationSupported, false);
  assert.equal(projected.resultDiscardSupported, true);
  assert.equal(projected.authority, "none");
  assert.equal(projected.toolExecution, false);
  assert.equal(Object.isFrozen(projected), true);
});

test("Absent or degraded Intelligence never invents a model or external provider", () => {
  for (const input of [null, {
    ...ready,
    state: "degraded",
    inferenceAvailable: false,
    engineId: null,
    modelId: null,
  }]) {
    const projected = projectIntelligenceConversationCapabilities(input);
    assert.equal(projected.provider, "unavailable");
    assert.equal(projected.engineId, null);
    assert.equal(projected.modelId, null);
  }
});

test("Invalid or authority-shaped Intelligence snapshots fail closed", () => {
  assert.throws(() => projectIntelligenceConversationCapabilities({
    ...ready, authority: "execute",
  }), /consultative/);
  assert.throws(() => projectIntelligenceConversationCapabilities({
    ...ready, state: "error",
  }), /availability/);
});
