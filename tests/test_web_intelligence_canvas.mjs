import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
  assertIntelligencePort,
  validateIntelligenceSnapshot,
} from "../system/contracts/intelligence.mjs";
import { assertSpaceSelectionPort } from "../system/contracts/space-selection.mjs";
import { createUnavailableWebIntelligencePort } from "../system/adapters/web/intelligence.mjs";
import { createUnavailableWebSpaceSelection } from "../system/adapters/web/space-selection.mjs";
import { createIntelligenceClient } from "../system/surface/workspace/lib/intelligence/client.mjs";

test("Web Assistant uses canonical, explicitly unavailable Space port without a second selector", () => {
  const port = createUnavailableWebSpaceSelection();
  assert.equal(assertSpaceSelectionPort(port), port);
  assert.equal(port.getSnapshot().state, "unavailable");
  assert.equal(port.getSnapshot().subjectId, null);
  assert.equal(port.getSnapshot().selectedSpace, null);
  assert.throws(() => port.select("space-1"), /not available/);
  assert.equal(port.clear().state, "unavailable");
  const seen = [];
  const unsubscribe = port.subscribe((value) => seen.push(value.state));
  unsubscribe();
  assert.deepEqual(seen, ["unavailable"]);
});

test("Web Intelligence fallback is a canonical fail-closed port", async () => {
  const port = createUnavailableWebIntelligencePort();
  assert.doesNotThrow(() => assertIntelligencePort(port));
  const snapshot = validateIntelligenceSnapshot(port.getSnapshot());
  assert.equal(snapshot.state, "degraded");
  assert.equal(snapshot.inferenceAvailable, false);
  assert.equal(snapshot.authority, "none");
  assert.equal(snapshot.toolExecution, false);
  const seen = [];
  const release = port.subscribe(value => seen.push(value.state));
  release();
  assert.deepEqual(seen, ["degraded"]);
  await assert.rejects(port.respond({ intent: "ask", prompt: "teste", context: [] }), /transport is unavailable/);
});

test("Web Intelligence client keeps snapshot identity stable until semantic state changes", () => {
  let raw = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    state: "degraded",
    inferenceAvailable: false,
    engineId: null,
    modelId: null,
    authority: "none",
    toolExecution: false,
  };
  let emit = () => {};
  const port = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot: () => ({ ...raw }),
    subscribe(listener) { emit = listener; listener({ ...raw }); return () => {}; },
    async respond() { throw new Error("not ready"); },
  };
  const client = createIntelligenceClient(port);
  const first = client.getSnapshot();
  let notifications = 0;
  client.subscribe(() => { notifications += 1; });
  assert.equal(client.getSnapshot(), first, "Immediate equivalent source notification must retain object identity");
  assert.equal(notifications, 0, "Equivalent source state must not notify React consumers");

  raw = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    state: "ready",
    inferenceAvailable: true,
    engineId: "engine-test",
    modelId: "model-test",
    authority: "none",
    toolExecution: false,
  };
  emit({ ...raw });
  assert.equal(notifications, 1);
  assert.notEqual(client.getSnapshot(), first);
  assert.equal(client.getSnapshot().state, "ready");

  const readySnapshot = client.getSnapshot();
  emit({ ...raw });
  assert.equal(notifications, 1, "Repeated equivalent ready state must not notify again");
  assert.equal(client.getSnapshot(), readySnapshot);
});

test("Web Intelligence client consumes only the canonical port and sanitizes the response", async () => {
  let received = null;
  const port = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot: () => ({
      schema: INTELLIGENCE_PORT_SCHEMA,
      state: "ready",
      inferenceAvailable: true,
      engineId: "engine-test",
      modelId: "model-test",
      authority: "none",
      toolExecution: false,
    }),
    subscribe(listener) { listener(this.getSnapshot()); return () => {}; },
    async respond(request) {
      received = request;
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "Resposta verificada",
        engineId: "engine-test",
        modelId: "model-test",
        authority: "none",
        ignoredProviderField: "must-not-become-surface-authority",
      };
    },
  };
  const client = createIntelligenceClient(port);
  const response = await client.ask("Explique o estado atual");
  assert.equal(received.intent, "ask");
  assert.equal(received.prompt, "Explique o estado atual");
  assert.deepEqual(received.context, []);
  assert.deepEqual(response, {
    schema: INTELLIGENCE_RESPONSE_SCHEMA,
    text: "Resposta verificada",
    engineId: "engine-test",
    modelId: "model-test",
    authority: "none",
  });
});

test("Web Intelligence client rejects malformed or authority-bearing responses", async () => {
  const ready = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot: () => ({
      schema: INTELLIGENCE_PORT_SCHEMA,
      state: "ready",
      inferenceAvailable: true,
      engineId: "engine-test",
      modelId: "model-test",
      authority: "none",
      toolExecution: false,
    }),
    subscribe: () => () => {},
  };
  const authority = createIntelligenceClient({ ...ready, respond: async () => ({ schema: INTELLIGENCE_RESPONSE_SCHEMA, text: "x", engineId: "engine-test", modelId: "model-test", authority: "execute" }) });
  await assert.rejects(authority.ask("teste"), /authority is invalid/);
  const malformed = createIntelligenceClient({ ...ready, respond: async () => ({ schema: INTELLIGENCE_RESPONSE_SCHEMA, text: "", engineId: "engine-test", modelId: "model-test", authority: "none" }) });
  await assert.rejects(malformed.ask("teste"), /response text/);
});

test("Canonical Web injects Intelligence without owning provider transport or credentials", async () => {
  const source = await readFile(new URL("../system/composition/web/main.tsx", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../system/adapters/web/intelligence.mjs", import.meta.url), "utf8");
  const windowContent = await readFile(new URL("../system/surface/workspace/components/central/window-content.tsx", import.meta.url), "utf8");
  const aura = await readFile(new URL("../system/surface/workspace/components/intelligence/aura-content.tsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../system/surface/workspace/lib/intelligence/client.mjs", import.meta.url), "utf8");
  const desktop = await readFile(new URL("../system/surface/workspace/components/central/desktop.tsx", import.meta.url), "utf8");
  assert.match(source, /createUnavailableWebIntelligencePort/);
  assert.match(source, /<IntelligenceClientProvider port=\{intelligence\}>/);
  assert.match(source, /<Central key=/);
  assert.doesNotMatch(source, /WebShell/);
  assert.match(windowContent, /AuraContent/);
  assert.match(aura, /client\.ask/);
  assert.doesNotMatch(desktop, /title === 'Aura'/);
  assert.doesNotMatch(desktop, /Pergunte ao Aura/);
  for (const text of [source, adapter, aura, client]) {
    assert.doesNotMatch(text, /fetch\(|process\.env|apiKey|OPENAI|xAI|adapters\/native/);
  }
});
