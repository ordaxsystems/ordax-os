import assert from "node:assert/strict";
import test from "node:test";

import {
  createApplicationAwareIntelligence,
} from "../system/services/intelligence/application-context.mjs";

function baseIntelligence() {
  let lastRequest = null;
  const snapshot = {
    schema: "ordax.intelligence/1",
    state: "ready",
    inferenceAvailable: true,
    engineId: "local",
    modelId: "test",
    authority: "none",
    toolExecution: false,
  };
  return {
    port: {
      schema: "ordax.intelligence/1",
      getSnapshot() { return snapshot; },
      subscribe() { return () => {}; },
      async respond(value) {
        lastRequest = value;
        return {
          schema: "ordax.intelligence-response/1",
          text: "ok",
          engineId: "local",
          modelId: "test",
          authority: "none",
        };
      },
    },
    request() { return lastRequest; },
  };
}

function awareness(text = '{"applications":[{"appId":"notes"}],"authority":"none","toolExecution":false}') {
  return {
    schema: "ordax.application-intelligence-awareness-port/1",
    list() { return []; },
    get() { return null; },
    resolveExact() { return null; },
    contextItem() {
      return Object.freeze({
        id: "application-awareness",
        scope: "system",
        text,
        provenance: "ordax:application-awareness",
      });
    },
  };
}

test("application awareness is appended as consultative system context", async () => {
  const base = baseIntelligence();
  const intelligence = createApplicationAwareIntelligence({
    intelligencePort: base.port,
    applicationAwarenessPort: awareness(),
  });

  await intelligence.respond({
    intent: "ask",
    prompt: "O que o Notes pode fazer?",
    context: [],
  });

  const request = base.request();
  assert.equal(request.context.length, 1);
  assert.equal(request.context[0].id, "application-awareness");
  assert.equal(request.context[0].scope, "system");
  assert.match(request.context[0].text, /"appId":"notes"/);
  assert.equal(intelligence.getSnapshot().toolExecution, false);
});

test("application awareness never displaces caller context when item budget is full", async () => {
  const base = baseIntelligence();
  const intelligence = createApplicationAwareIntelligence({
    intelligencePort: base.port,
    applicationAwarenessPort: awareness(),
  });
  const context = Array.from({ length: 16 }, (_, index) => ({
    id: `item-${index}`,
    scope: "user",
    text: "x",
    provenance: "test",
  }));

  await intelligence.respond({ prompt: "teste", context });

  assert.equal(base.request().context.length, 16);
  assert.equal(base.request().context.some((item) => item.id === "application-awareness"), false);
});

test("application awareness never exposes execution authority", () => {
  const base = baseIntelligence();
  const intelligence = createApplicationAwareIntelligence({
    intelligencePort: base.port,
    applicationAwarenessPort: awareness(),
  });

  assert.equal(typeof intelligence.execute, "undefined");
  assert.equal(typeof intelligence.run, "undefined");
  assert.equal(typeof intelligence.invoke, "undefined");
  assert.equal(intelligence.getSnapshot().authority, "none");
  assert.equal(intelligence.getSnapshot().toolExecution, false);
});
