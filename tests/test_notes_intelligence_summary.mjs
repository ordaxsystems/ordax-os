import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS,
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { summarizeNoteWithIntelligence } from "../system/apps/notes/platform/intelligence-summary.mjs";

function createPort() {
  const requests = [];
  const snapshot = Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    state: "ready",
    inferenceAvailable: true,
    engineId: "test-engine",
    modelId: "test-model",
    authority: "none",
    toolExecution: false,
  });

  return {
    requests,
    port: {
      schema: INTELLIGENCE_PORT_SCHEMA,
      getSnapshot() {
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
      async respond(request) {
        requests.push(request);
        return Object.freeze({
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text: "summary",
          engineId: "test-engine",
          modelId: "test-model",
          authority: "none",
        });
      },
    },
  };
}

test("Notes summary uses only the public Intelligence port with bounded document context", async () => {
  const { port, requests } = createPort();
  const response = await summarizeNoteWithIntelligence(port, {
    id: "note-42",
    title: "Planejamento",
    text: "Conteúdo principal da nota.",
    provenance: "notes:note-42:device-local",
    locale: "pt-BR",
  });

  assert.equal(response.authority, "none");
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.intent, "summarize");
  assert.equal(request.maxTokens, 384);
  assert.match(request.prompt, /Resuma o documento em português/);
  assert.equal(request.context.length, 1);
  assert.equal(request.context[0].id, "note-42");
  assert.equal(request.context[0].scope, "document");
  assert.equal(request.context[0].provenance, "notes:note-42:device-local");
  assert.match(request.context[0].text, /^Título: Planejamento\n\nConteúdo:/);
  assert.ok(request.context[0].text.length <= INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS);
});

test("Notes summary keeps locale behavior app-owned and provider-neutral", async () => {
  const { port, requests } = createPort();
  await summarizeNoteWithIntelligence(port, {
    id: "note-en",
    title: "Plan",
    text: "Main content.",
    provenance: "notes:note-en:device-local",
    locale: "en-US",
  });

  assert.match(requests[0].prompt, /Summarize the document in English/);
  assert.match(requests[0].context[0].text, /^Title: Plan\n\nContent:/);
  const serialized = JSON.stringify(requests[0]).toLowerCase();
  assert.doesNotMatch(serialized, /qwen|llama|openai|anthropic|gemini/);
});

test("Notes summary truncates oversized source text inside the public contract bound", async () => {
  const { port, requests } = createPort();
  await summarizeNoteWithIntelligence(port, {
    id: "note-long",
    title: "Long note",
    text: "conteúdo ".repeat(7000),
    provenance: "notes:note-long:device-local",
  });

  const context = requests[0].context[0].text;
  assert.ok(context.length <= INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS);
  assert.match(context, /conteúdo truncado pelo limite de contexto local/);
});

test("Notes summary fails closed on invalid app-owned context metadata", async () => {
  const { port } = createPort();
  await assert.rejects(
    () => summarizeNoteWithIntelligence(port, {
      id: "",
      title: "Title",
      text: "Body",
      provenance: "notes:bad:device-local",
    }),
    /Notes Intelligence id is outside its allowed bounds/,
  );
  await assert.rejects(
    () => summarizeNoteWithIntelligence(port, {
      id: "note-bad",
      title: "Title",
      text: "Body",
      provenance: "x".repeat(513),
    }),
    /Notes Intelligence provenance is outside its allowed bounds/,
  );
});
