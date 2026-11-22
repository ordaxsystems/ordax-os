import test from "node:test";
import assert from "node:assert/strict";
import { bindIntelligenceContracts, bindModelRouterContracts, bindLocalAiContracts, bindLocalAiStreamContracts } from "../src/index.mjs";
test("production modules refuse missing canonical OS contracts", () => {
  assert.throws(() => bindIntelligenceContracts({}), /Canonical intelligence contracts/);
  assert.throws(() => bindModelRouterContracts({}), /Canonical localAi contracts/);
  assert.throws(() => bindLocalAiContracts(), /Canonical localAi contracts/);
  assert.throws(() => bindLocalAiStreamContracts(), /Canonical localAi contracts/);
});
test("incompatible versions cannot be injected as valid public ports", () => {
  assert.throws(() => bindLocalAiContracts({ LOCAL_AI_PORT_SCHEMA: "ordax.local-ai/0" }), /ordax.local-ai\/1/);
});
