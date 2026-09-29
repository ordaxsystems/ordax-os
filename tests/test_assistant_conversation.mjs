import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import {
  ASSISTANT_CONVERSATION_SCHEMA,
  createAssistantConversationRuntime,
} from "../system/apps/assistant/conversation.mjs";

function intelligencePort({ state = "ready", responses = [] } = {}) {
  let snapshot = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    state,
    inferenceAvailable: state === "ready" || state === "busy",
    engineId: state === "ready" || state === "busy" ? "llama.cpp" : null,
    modelId: state === "ready" || state === "busy" ? "qwen-test" : null,
    authority: "none",
    toolExecution: false,
  };
  const requests = [];
  const listeners = new Set();
  let responseOrdinal = 0;
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
    setState(nextState) {
      snapshot = {
        ...snapshot,
        state: nextState,
        inferenceAvailable: nextState === "ready" || nextState === "busy",
        engineId: nextState === "ready" || nextState === "busy" ? "llama.cpp" : null,
        modelId: nextState === "ready" || nextState === "busy" ? "qwen-test" : null,
      };
      for (const listener of [...listeners]) listener(snapshot);
    },
    async respond(request) {
      requests.push(request);
      const text = responses[responseOrdinal] ?? `resposta-${responseOrdinal + 1}`;
      responseOrdinal += 1;
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text,
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      };
    },
  };
}

test("Assistant mounts honestly unavailable without an Intelligence port", async () => {
  const conversation = createAssistantConversationRuntime();
  const snapshot = conversation.getSnapshot();
  assert.equal(conversation.schema, ASSISTANT_CONVERSATION_SCHEMA);
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.authority, "none");
  assert.equal(snapshot.toolExecution, false);
  assert.equal(snapshot.persistence, "session");
  assert.deepEqual(snapshot.messages, []);
  await assert.rejects(
    () => conversation.send("Olá"),
    /unavailable/,
  );
  conversation.dispose();
});

test("Assistant sends through ordax.intelligence and carries only bounded session context", async () => {
  const intelligence = intelligencePort({
    responses: ["Olá, posso ajudar.", "Você disse que prefere respostas curtas."],
  });
  const conversation = createAssistantConversationRuntime({ intelligencePort: intelligence });

  await conversation.send("Prefiro respostas curtas.");
  assert.equal(intelligence.requests.length, 1);
  assert.equal(intelligence.requests[0].intent, "ask");
  assert.deepEqual(intelligence.requests[0].context, []);

  await conversation.send("O que eu disse antes?");
  assert.equal(intelligence.requests.length, 2);
  assert.equal(intelligence.requests[1].context.length, 1);
  const context = intelligence.requests[1].context[0];
  assert.equal(context.id, "assistant-session");
  assert.equal(context.scope, "user");
  assert.equal(context.provenance, "ordax-assistant-session");
  assert.match(context.text, /user: Prefiro respostas curtas\./);
  assert.match(context.text, /assistant: Olá, posso ajudar\./);
  assert.ok(context.text.length <= 8192);

  const snapshot = conversation.getSnapshot();
  assert.equal(snapshot.messages.length, 4);
  assert.equal(snapshot.messages[0].role, "user");
  assert.equal(snapshot.messages[1].role, "assistant");
  assert.equal(snapshot.messages[3].text, "Você disse que prefere respostas curtas.");
  assert.equal(snapshot.persistence, "session");
  assert.equal(snapshot.authority, "none");
  assert.equal(snapshot.toolExecution, false);
  conversation.dispose();
});

test("Assistant conversation history is bounded and clear is non-persistent", async () => {
  const intelligence = intelligencePort();
  const conversation = createAssistantConversationRuntime({ intelligencePort: intelligence });

  for (let index = 0; index < 13; index += 1) {
    await conversation.send(`mensagem-${index}`);
  }
  const snapshot = conversation.getSnapshot();
  assert.equal(snapshot.messages.length, 24);
  assert.equal(snapshot.messages[0].id, "assistant-message-3");
  assert.equal(snapshot.messages.at(-1).id, "assistant-message-26");

  const cleared = conversation.clear();
  assert.deepEqual(cleared.messages, []);
  assert.equal(cleared.persistence, "session");
  conversation.dispose();
});

test("Assistant refuses clear while a response is pending", async () => {
  let resolveResponse;
  const intelligence = intelligencePort();
  intelligence.respond = async (request) => {
    intelligence.requests.push(request);
    return new Promise((resolve) => {
      resolveResponse = () => resolve({
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "ok",
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      });
    });
  };
  const conversation = createAssistantConversationRuntime({ intelligencePort: intelligence });
  const pending = conversation.send("aguarde");
  assert.equal(conversation.getSnapshot().state, "busy");
  assert.throws(
    () => conversation.clear(),
    /cannot be cleared/,
  );
  resolveResponse();
  await pending;
  assert.equal(conversation.getSnapshot().messages.length, 2);
  conversation.dispose();
});

test("Assistant fails closed when Intelligence is not ready", async () => {
  const intelligence = intelligencePort({ state: "degraded" });
  const conversation = createAssistantConversationRuntime({ intelligencePort: intelligence });
  assert.equal(conversation.getSnapshot().state, "unavailable");
  await assert.rejects(
    () => conversation.send("teste"),
    /not ready/,
  );
  assert.equal(intelligence.requests.length, 0);

  intelligence.setState("ready");
  assert.equal(conversation.getSnapshot().state, "ready");
  await conversation.send("agora funciona");
  assert.equal(intelligence.requests.length, 1);
  conversation.dispose();
});
