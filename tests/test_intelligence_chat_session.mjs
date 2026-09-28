import assert from "node:assert/strict";
import test from "node:test";

import { INTELLIGENCE_PORT_SCHEMA } from "../system/contracts/intelligence.mjs";
import {
  INTELLIGENCE_CHAT_MAX_MESSAGES,
  createIntelligenceChatSession,
} from "../system/apps/intelligence/session.mjs";

function createFakeIntelligence() {
  let snapshot = Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    state: "ready",
    inferenceAvailable: true,
    engineId: "llama.cpp",
    modelId: "qwen-test",
    authority: "none",
    toolExecution: false,
  });
  const listeners = new Set();
  const requests = [];

  return {
    schema: INTELLIGENCE_PORT_SCHEMA,
    requests,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async respond(request) {
      requests.push(request);
      return Object.freeze({
        schema: "ordax.intelligence-response/1",
        text: `eco:${request.prompt}`,
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      });
    },
    setState(state) {
      snapshot = Object.freeze({
        ...snapshot,
        state,
        inferenceAvailable: state === "ready" || state === "busy",
        engineId: state === "ready" || state === "busy" ? "llama.cpp" : null,
        modelId: state === "ready" || state === "busy" ? "qwen-test" : null,
      });
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

test("chat session sends only a local consultative Intelligence request", async () => {
  const intelligence = createFakeIntelligence();
  const session = createIntelligenceChatSession(intelligence, { maxTokens: 640 });

  const response = await session.send("Explique este sistema");
  assert.equal(response.text, "eco:Explique este sistema");
  assert.equal(intelligence.requests.length, 1);
  assert.deepEqual(intelligence.requests[0], {
    intent: "ask",
    prompt: "Explique este sistema",
    context: [],
    maxTokens: 640,
  });

  const snapshot = session.getSnapshot();
  assert.equal(snapshot.history, "session-only");
  assert.equal(snapshot.webGrounding, false);
  assert.equal(snapshot.externalProvider, false);
  assert.equal(snapshot.toolExecution, false);
  assert.deepEqual(snapshot.messages.map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "Explique este sistema" },
    { role: "assistant", text: "eco:Explique este sistema" },
  ]);
  session.dispose();
});

test("chat session fails closed while local Intelligence is unavailable", async () => {
  const intelligence = createFakeIntelligence();
  const session = createIntelligenceChatSession(intelligence);
  intelligence.setState("degraded");

  await assert.rejects(() => session.send("Olá"), /not ready/);
  assert.equal(intelligence.requests.length, 0);
  assert.equal(session.getSnapshot().messages.length, 0);
  session.dispose();
});

test("chat session keeps bounded session-only transcript and explicit clear", async () => {
  const intelligence = createFakeIntelligence();
  const session = createIntelligenceChatSession(intelligence);

  for (let index = 0; index < INTELLIGENCE_CHAT_MAX_MESSAGES; index += 1) {
    await session.send(`mensagem-${index}`);
  }
  const bounded = session.getSnapshot();
  assert.equal(bounded.messages.length, INTELLIGENCE_CHAT_MAX_MESSAGES);
  assert.equal(bounded.messages.at(-1).text, `eco:mensagem-${INTELLIGENCE_CHAT_MAX_MESSAGES - 1}`);

  session.clear();
  assert.equal(session.getSnapshot().messages.length, 0);
  session.dispose();
});
