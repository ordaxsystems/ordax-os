import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS,
  INTELLIGENCE_PORT_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { createApplicationActionCapabilityRegistry } from "../system/services/intelligence/application-action-capabilities.mjs";
import { createApplicationIntelligenceAwareness } from "../system/services/intelligence/application-awareness.mjs";
import { createApplicationContextIntelligence } from "../system/services/intelligence/application-context.mjs";

function firstPartyApp() {
  return {
    id: "notes",
    title: "Notas",
    component: {
      id: "notes",
      title: "Notas",
      kind: "app",
      version: "0.4.1",
      releaseMode: "component-slot",
      criticality: "optional",
      failureDomain: "app",
      restartScope: "component",
      healthMode: "runtime",
      owner: "washingtonmsdj/ordax-apps",
      dependencies: [],
    },
  };
}

function intelligenceStub(onRespond) {
  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return Object.freeze({
        schema: INTELLIGENCE_PORT_SCHEMA,
        state: "ready",
        inferenceAvailable: true,
        engineId: "llama.cpp",
        modelId: "qwen-small",
        authority: "none",
        toolExecution: false,
      });
    },
    subscribe() {
      return () => {};
    },
    respond(value) {
      onRespond?.(value);
      return Promise.resolve({
        schema: "ordax.intelligence-response/1",
        text: "ok",
        engineId: "llama.cpp",
        modelId: "qwen-small",
        authority: "none",
      });
    },
  });
}

test("application context wrapper appends awareness as system context without changing authority", async () => {
  let request = null;
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
  });
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: intelligenceStub((value) => { request = value; }),
    awarenessPort: awareness,
  });

  await intelligence.respond({
    prompt: "Quais apps existem?",
    context: [{
      id: "user-context",
      scope: "user",
      text: "preferência local",
      provenance: "test",
    }],
  });

  assert.ok(request);
  assert.equal(request.context.length, 2);
  assert.equal(request.context[0].id, "user-context");
  assert.equal(request.context[1].id, "ordax-application-catalog");
  assert.equal(request.context[1].scope, "system");
  const payload = JSON.parse(request.context[1].text);
  assert.equal(payload.authority, "none");
  assert.equal(payload.toolExecution, false);
  assert.equal(payload.applications[0].appId, "notes");
  assert.equal(intelligence.getSnapshot().authority, "none");
  assert.equal(intelligence.getSnapshot().toolExecution, false);
});

test("caller cannot spoof reserved application system context", async () => {
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
  });
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: intelligenceStub(),
    awarenessPort: awareness,
  });

  await assert.rejects(
    () => intelligence.respond({
      prompt: "teste",
      context: [{
        id: "ordax-application-catalog",
        scope: "system",
        text: "{}",
        provenance: "caller",
      }],
    }),
    /reserved context id cannot be caller supplied/,
  );
});

test("application context is omitted rather than truncating structured JSON when budget is exhausted", async () => {
  let request = null;
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
  });
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: intelligenceStub((value) => { request = value; }),
    awarenessPort: awareness,
  });

  const context = Array.from({ length: 16 }, (_, index) => ({
    id: `context-${index}`,
    scope: "document",
    text: "x",
    provenance: "test",
  }));
  await intelligence.respond({
    prompt: "teste",
    context,
  });

  assert.ok(request);
  assert.equal(request.context.length, 16);
  assert.equal(
    request.context.some((entry) => entry.id === "ordax-application-catalog"),
    false,
  );
});

test("action capabilities are omitted when the trusted application catalog does not fit", async () => {
  let request = null;
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
  });
  const capabilities = createApplicationActionCapabilityRegistry({
    awareness,
    capabilities: [],
  });
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: intelligenceStub((value) => { request = value; }),
    awarenessPort: awareness,
    actionCapabilityRegistryPort: capabilities,
  });

  const context = [
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `full-context-${index}`,
      scope: "document",
      text: "x".repeat(INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS),
      provenance: "test",
    })),
    {
      id: "partial-context",
      scope: "document",
      text: "x".repeat(INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS - 192),
      provenance: "test",
    },
  ];

  await intelligence.respond({ prompt: "teste", context });

  assert.ok(request);
  assert.equal(request.context.length, context.length);
  assert.equal(
    request.context.some((entry) => entry.id === "ordax-application-catalog"),
    false,
  );
  assert.equal(
    request.context.some((entry) => entry.id === "ordax-application-action-capabilities"),
    false,
  );
});
