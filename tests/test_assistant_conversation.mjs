import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import {
  ASSISTANT_CONVERSATION_SCHEMA,
  createAssistantConversationRuntime as createBoundConversationRuntime,
} from "../system/apps/assistant/conversation.mjs";

function observablePort(schema, initial, methods = {}) {
  let current = initial;
  const listeners = new Set();
  return {
    schema,
    getSnapshot() { return current; },
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    setSnapshot(next) {
      current = next;
      for (const listener of [...listeners]) listener(current);
    },
    ...methods,
  };
}

function selectedSpace(subjectId, id = "space-a", profilePack = "pizzaria-br") {
  return {
    schema: "ordax.space-selection/1",
    state: "selected",
    subjectId,
    selectedSpace: {
      schema: "ordax.spaces/1",
      id,
      name: "Empresa",
      kind: "professional",
      state: "active",
      ownerId: subjectId,
      profilePack,
    },
  };
}

function scopePorts(subjectId = null, spaceId = null) {
  const identity = observablePort("ordax.identity-session/1", subjectId === null
    ? { state: "signed-out" }
    : { state: "signed-in", subjectId, displayName: "Conta" });
  const spaceSelection = observablePort("ordax.space-selection/1", subjectId === null
    ? { schema: "ordax.space-selection/1", state: "unavailable" }
    : spaceId === null
      ? { schema: "ordax.space-selection/1", state: "unselected", subjectId }
      : selectedSpace(subjectId, spaceId), {
    select() {},
    clear() {},
  });
  const profileActivation = observablePort("ordax.profile-activation-state-port/1", {
    schema: "ordax.profile-activation-state/1",
    revision: 0,
    persistence: "session",
    spaces: [],
  }, { refresh() {}, dispose() {} });
  return { identity, spaceSelection, profileActivation };
}

function createAssistantConversationRuntime(options = {}) {
  const scope = scopePorts();
  return createBoundConversationRuntime({
    identitySessionPort: scope.identity,
    spaceSelectionPort: scope.spaceSelection,
    ...options,
  });
}

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


test("Assistant invokes automatic Memory capture after a successful response without owning persistence", async () => {
  const intelligence = intelligencePort({ responses: ["ok"] });
  const turns = [];
  const memoryCapture = {
    bindTurn() {
      return {
        async capture(turn) {
          turns.push(turn);
          return { status: "captured", captured: 1 };
        },
      };
    },
  };
  const conversation = createAssistantConversationRuntime({
    intelligencePort: intelligence,
    memoryCapture,
  });

  const response = await conversation.send("Prefiro respostas curtas.");
  assert.equal(response.text, "ok");
  assert.equal(turns.length, 1);
  assert.equal(turns[0].userText, "Prefiro respostas curtas.");
  assert.equal(typeof turns[0].isContextCurrent, "function");
  assert.equal(turns[0].isContextCurrent(), true);
  assert.equal(conversation.getSnapshot().memoryCaptureState, "captured");
  conversation.dispose();
});

test("Assistant response succeeds even when automatic Memory capture fails", async () => {
  const intelligence = intelligencePort({ responses: ["resposta"] });
  const conversation = createAssistantConversationRuntime({
    intelligencePort: intelligence,
    memoryCapture: {
      bindTurn() {
        return {
          async capture() {
            throw new Error("memory unavailable");
          },
        };
      },
    },
  });

  const response = await conversation.send("continue");
  assert.equal(response.text, "resposta");
  assert.equal(conversation.getSnapshot().memoryCaptureState, "error");
  assert.equal(conversation.getSnapshot().lastError, null);
  conversation.dispose();
});


test("Assistant binds Memory ownership before starting Intelligence inference", async () => {
  const events = [];
  const intelligence = intelligencePort({ responses: ["ok"] });
  const originalRespond = intelligence.respond.bind(intelligence);
  intelligence.respond = async (request) => {
    events.push("inference");
    return originalRespond(request);
  };
  const conversation = createAssistantConversationRuntime({
    intelligencePort: intelligence,
    memoryCapture: {
      bindTurn() {
        events.push("bind-memory");
        return {
          async capture() {
            events.push("capture-memory");
            return { status: "captured", captured: 1 };
          },
        };
      },
    },
  });

  await conversation.send("mensagem");
  assert.deepEqual(events, ["bind-memory", "inference", "capture-memory"]);
  conversation.dispose();
});


test("Assistant binds its transcript to the account and active Space, including signed-out device", async () => {
  const scope = scopePorts("account-a", "space-a");
  const intelligence = intelligencePort();
  const conversation = createAssistantConversationRuntime({
    intelligencePort: intelligence,
    identitySessionPort: scope.identity,
    spaceSelectionPort: scope.spaceSelection,
  });

  await conversation.send("informação privada da empresa A");
  assert.equal(conversation.getSnapshot().messages.length, 2);

  scope.spaceSelection.setSnapshot(selectedSpace("account-a", "space-b"));
  assert.deepEqual(conversation.getSnapshot().messages, []);
  await conversation.send("pergunta na empresa B");
  assert.deepEqual(intelligence.requests[1].context, []);

  scope.identity.setSnapshot({ state: "signed-in", subjectId: "account-b", displayName: "Outra conta" });
  assert.deepEqual(conversation.getSnapshot().messages, []);
  assert.equal(conversation.getSnapshot().state, "unavailable");
  await assert.rejects(() => conversation.send("não pode continuar"), /context is unavailable/);

  scope.spaceSelection.setSnapshot(selectedSpace("account-b", "space-c"));
  await conversation.send("pergunta na conta B");
  assert.deepEqual(intelligence.requests[2].context, []);

  scope.identity.setSnapshot({ state: "signed-out" });
  scope.spaceSelection.setSnapshot({ schema: "ordax.space-selection/1", state: "unavailable" });
  assert.deepEqual(conversation.getSnapshot().messages, []);
  await conversation.send("conversa local no dispositivo");
  assert.deepEqual(intelligence.requests[3].context, []);
  conversation.dispose();
});

test("Assistant invalidates history when the active Profile revision changes", async () => {
  const scope = scopePorts("account-a", "space-a");
  const intelligence = intelligencePort();
  const conversation = createAssistantConversationRuntime({
    intelligencePort: intelligence,
    identitySessionPort: scope.identity,
    spaceSelectionPort: scope.spaceSelection,
    profileActivationStatePort: scope.profileActivation,
  });
  await conversation.send("contexto de perfil anterior");
  scope.profileActivation.setSnapshot({
    schema: "ordax.profile-activation-state/1",
    revision: 1,
    persistence: "session",
    spaces: [],
  });
  assert.deepEqual(conversation.getSnapshot().messages, []);
  await conversation.send("novo perfil");
  assert.deepEqual(intelligence.requests[1].context, []);
  conversation.dispose();
});

test("Assistant discards a late inference result after an account/Space switch", async () => {
  const scope = scopePorts("account-a", "space-a");
  const intelligence = intelligencePort();
  let finish;
  const originalRespond = intelligence.respond.bind(intelligence);
  intelligence.respond = async (request) => {
    if (request.prompt === "pedido antigo") {
      intelligence.requests.push(request);
      return new Promise((resolve) => {
        finish = () => resolve({
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text: "RESPOSTA PRIVADA A",
          engineId: "llama.cpp",
          modelId: "qwen-test",
          authority: "none",
        });
      });
    }
    return originalRespond(request);
  };
  const conversation = createAssistantConversationRuntime({
    intelligencePort: intelligence,
    identitySessionPort: scope.identity,
    spaceSelectionPort: scope.spaceSelection,
  });

  const pending = conversation.send("pedido antigo");
  scope.spaceSelection.setSnapshot(selectedSpace("account-a", "space-b"));
  assert.deepEqual(conversation.getSnapshot().messages, []);
  assert.equal(conversation.getSnapshot().state, "busy");
  finish();
  await assert.rejects(pending, /context changed/);
  assert.deepEqual(conversation.getSnapshot().messages, []);
  assert.equal(conversation.getSnapshot().state, "ready");

  await conversation.send("pedido novo");
  assert.deepEqual(intelligence.requests[1].context, []);
  assert.doesNotMatch(JSON.stringify(conversation.getSnapshot().messages), /RESPOSTA PRIVADA A/);
  conversation.dispose();
});

test("Assistant invalidates in-flight work even if the user returns to the original Space", async () => {
  const scope = scopePorts("account-a", "space-a");
  const intelligence = intelligencePort();
  let finish;
  intelligence.respond = async (request) => {
    intelligence.requests.push(request);
    return new Promise((resolve) => {
      finish = () => resolve({
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "stale",
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      });
    });
  };
  const conversation = createAssistantConversationRuntime({
    intelligencePort: intelligence,
    identitySessionPort: scope.identity,
    spaceSelectionPort: scope.spaceSelection,
  });
  const pending = conversation.send("old");
  scope.spaceSelection.setSnapshot(selectedSpace("account-a", "space-b"));
  scope.spaceSelection.setSnapshot(selectedSpace("account-a", "space-a"));
  finish();
  await assert.rejects(pending, /context changed/);
  assert.deepEqual(conversation.getSnapshot().messages, []);
  conversation.dispose();
});

test("Assistant refuses an unsettled identity/Space boundary before sending inference", async () => {
  const scope = scopePorts("account-a", "space-a");
  const intelligence = intelligencePort();
  scope.spaceSelection.setSnapshot({ schema: "ordax.space-selection/1", state: "unavailable" });
  const conversation = createAssistantConversationRuntime({
    intelligencePort: intelligence,
    identitySessionPort: scope.identity,
    spaceSelectionPort: scope.spaceSelection,
  });
  assert.equal(conversation.getSnapshot().state, "unavailable");
  await assert.rejects(() => conversation.send("não usar memória"), /context is unavailable/);
  assert.equal(intelligence.requests.length, 0);
  conversation.dispose();
});


test("Assistant stays useful in isolated local-only mode when Account service is unavailable", async () => {
  const scope = scopePorts("account-a", "space-a");
  const intelligence = intelligencePort();
  const conversation = createAssistantConversationRuntime({
    intelligencePort: intelligence,
    identitySessionPort: scope.identity,
    spaceSelectionPort: scope.spaceSelection,
  });
  await conversation.send("informação do Space A");
  scope.identity.setSnapshot({ state: "unavailable" });
  // Until the Space owner also invalidates selection, there is no safe scope.
  assert.equal(conversation.getSnapshot().state, "unavailable");
  assert.deepEqual(conversation.getSnapshot().messages, []);
  scope.spaceSelection.setSnapshot({ schema: "ordax.space-selection/1", state: "unavailable" });
  assert.equal(conversation.getSnapshot().state, "ready");

  await conversation.send("olá offline");
  assert.deepEqual(intelligence.requests[1].context, []);
  scope.identity.setSnapshot({ state: "signed-in", subjectId: "account-a", displayName: "Conta" });
  scope.spaceSelection.setSnapshot(selectedSpace("account-a", "space-a"));
  assert.deepEqual(conversation.getSnapshot().messages, []);
  await conversation.send("voltei à conta");
  assert.deepEqual(intelligence.requests[2].context, []);
  conversation.dispose();
});


test("Assistant discards a late inference result without claiming backend cancellation or writing Memory", async () => {
  const intelligence = intelligencePort();
  let settle;
  intelligence.respond = (request) => {
    intelligence.requests.push(request);
    return new Promise((resolve) => {
      settle = () => resolve({
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "resposta descartada",
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      });
    });
  };
  let captures = 0;
  const conversation = createAssistantConversationRuntime({
    intelligencePort: intelligence,
    memoryCapture: {
      bindTurn() {
        return { async capture() { captures += 1; return { status: "captured" }; } };
      },
    },
  });

  const pending = conversation.send("pedido que será descartado");
  const before = conversation.getSnapshot();
  assert.equal(before.inferencePending, true);
  assert.equal(before.canDiscardPending, true);
  assert.equal(before.providerCapabilities.provider, "local");
  assert.equal(before.providerCapabilities.streamingSupported, false);
  assert.equal(before.providerCapabilities.backendCancellationSupported, false);

  assert.equal(conversation.discardPendingResponse(), true);
  assert.equal(conversation.discardPendingResponse(), false);
  assert.equal(conversation.getSnapshot().discardRequested, true);
  assert.equal(conversation.getSnapshot().state, "busy");
  await assert.rejects(() => conversation.send("não reenvie enquanto pendente"), /already processing/);
  settle();
  await assert.rejects(pending, /discarded/);
  const after = conversation.getSnapshot();
  assert.equal(after.state, "ready");
  assert.equal(after.inferencePending, false);
  assert.equal(after.canDiscardPending, false);
  assert.equal(after.lastError, "response-discarded");
  assert.deepEqual(after.messages, []);
  assert.equal(captures, 0);

  intelligence.respond = async (request) => {
    intelligence.requests.push(request);
    return {
      schema: INTELLIGENCE_RESPONSE_SCHEMA,
      text: "nova resposta",
      engineId: "llama.cpp",
      modelId: "qwen-test",
      authority: "none",
    };
  };
  await conversation.send("novo pedido");
  assert.deepEqual(intelligence.requests.at(-1).context, []);
  conversation.dispose();
});

test("Assistant does not offer discard after inference finishes and Memory capture begins", async () => {
  const intelligence = intelligencePort({ responses: ["ok"] });
  let finishCapture;
  let startedCapture;
  const captureStarted = new Promise((resolve) => { startedCapture = resolve; });
  const conversation = createAssistantConversationRuntime({
    intelligencePort: intelligence,
    memoryCapture: {
      bindTurn() {
        return {
          capture() {
            startedCapture();
            return new Promise((resolve) => {
              finishCapture = () => resolve({ status: "complete" });
            });
          },
        };
      },
    },
  });
  const pending = conversation.send("guardar preferência");
  await captureStarted;
  assert.equal(conversation.getSnapshot().inferencePending, false);
  assert.equal(conversation.discardPendingResponse(), false);
  finishCapture();
  await pending;
  assert.equal(conversation.getSnapshot().messages.at(-1).text, "ok");
  conversation.dispose();
});

test("Assistant discard sends AbortSignal and suppresses inference output and Memory", async () => {
  const intelligence = intelligencePort();
  let signal;
  intelligence.respond = (request, options) => {
    intelligence.requests.push(request);
    signal = options.signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("transport aborted")), { once: true });
    });
  };
  let captures = 0;
  const conversation = createAssistantConversationRuntime({
    intelligencePort: intelligence,
    memoryCapture: {
      bindTurn() { return { async capture() { captures += 1; } }; },
    },
  });
  const pending = conversation.send("cancelar geração");
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
  assert.equal(conversation.discardPendingResponse(), true);
  await assert.rejects(pending, /discarded/);
  assert.equal(signal.aborted, true);
  assert.equal(captures, 0);
  assert.deepEqual(conversation.getSnapshot().messages, []);
  assert.equal(conversation.getSnapshot().state, "ready");
  conversation.dispose();
});

test("Assistant aborts old request on Space change without leaking its content into the next owner", async () => {
  const scope = scopePorts("account-a", "space-a");
  const intelligence = intelligencePort();
  let signal;
  intelligence.respond = (request, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("old scope aborted")), { once: true });
    });
  };
  const conversation = createBoundConversationRuntime({
    intelligencePort: intelligence,
    identitySessionPort: scope.identity,
    spaceSelectionPort: scope.spaceSelection,
  });
  const pending = conversation.send("segredo de A");
  scope.spaceSelection.setSnapshot(selectedSpace("account-a", "space-b"));
  assert.equal(signal.aborted, true);
  await assert.rejects(pending, /context changed/);
  assert.deepEqual(conversation.getSnapshot().messages, []);
  conversation.dispose();
});
