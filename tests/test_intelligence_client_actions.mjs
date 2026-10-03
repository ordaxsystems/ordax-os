import assert from "node:assert/strict";
import test from "node:test";

import { INTELLIGENCE_PORT_SCHEMA } from "../system/contracts/intelligence.mjs";
import {
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

function surfaceSnapshot() {
  return {
    capabilityIds: ["system.metrics", "intelligence.system", "network.https"],
    connectivity: "online",
  };
}

function metricsSnapshot() {
  return {
    uptimeSeconds: 123,
    memoryTotalBytes: 1000,
    memoryAvailableBytes: 400,
    userStorageTotalBytes: 5000,
    userStorageFreeBytes: 3000,
  };
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
  assert.match(request.prompt, /português/);
});

test("system explanation includes only bounded host and metrics observations", async () => {
  const intelligence = intelligencePort();
  await explainSystemStateWithIntelligence(intelligence, {
    surface: surfaceSnapshot(),
    metrics: metricsSnapshot(),
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
  assert.deepEqual(payload.metrics, metricsSnapshot());
  assert.equal("prompt" in payload, false);
  assert.equal("files" in payload, false);
  assert.match(request.prompt, /estado observado/);
});

test("Surface en-US makes Notes Intelligence prompt and document context English", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: { lang: "en-US" } };
  try {
    const intelligence = intelligencePort();
    const longText = "content ".repeat(2000);
    await summarizeDocumentWithIntelligence(intelligence, {
      id: "note-english",
      title: "English note",
      text: longText,
      provenance: "notes:note-english:device-local",
    });
    const request = intelligence.requests[0];
    assert.match(request.prompt, /Summarize the document in English/);
    assert.match(request.context[0].text, /^Title: English note\n\nContent:\n/);
    assert.match(request.context[0].text, /content truncated by the local context limit/);
    assert.doesNotMatch(request.prompt, /português/);
    assert.doesNotMatch(request.context[0].text, /^Título:/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("Surface en-US makes System Intelligence diagnosis prompt English", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: { lang: "en-US" } };
  try {
    const intelligence = intelligencePort();
    await explainSystemStateWithIntelligence(intelligence, {
      surface: surfaceSnapshot(),
      metrics: metricsSnapshot(),
    });
    const request = intelligence.requests[0];
    assert.match(request.prompt, /Explain the observed device state in plain English/);
    assert.doesNotMatch(request.prompt, /Explique o estado observado/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("explicit locale overrides Surface language while headless clients remain PT-BR", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: { lang: "en-US" } };
  try {
    const explicit = intelligencePort();
    await summarizeDocumentWithIntelligence(explicit, {
      id: "note-explicit",
      title: "Nota",
      text: "Texto",
      provenance: "notes:note-explicit:device-local",
      locale: "pt-BR",
    });
    assert.match(explicit.requests[0].prompt, /português/);
    assert.match(explicit.requests[0].context[0].text, /^Título:/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  const headless = intelligencePort();
  await explainSystemStateWithIntelligence(headless, { surface: surfaceSnapshot() });
  assert.match(headless.requests[0].prompt, /estado observado/);
});
