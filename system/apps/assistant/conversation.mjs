import {
  INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS,
  INTELLIGENCE_MAX_PROMPT_CHARS,
  INTELLIGENCE_PORT_SCHEMA,
  assertIntelligencePort,
  validateIntelligenceResponse,
  validateIntelligenceSnapshot,
} from "../../contracts/intelligence.mjs";

export const ASSISTANT_CONVERSATION_SCHEMA = "ordax.assistant-conversation/1";
const MAX_MESSAGES = 24;
const MAX_CONTEXT_MESSAGES = 8;
const MAX_CONTEXT_MESSAGE_CHARS = 1500;

function boundedPrompt(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Assistant prompt must be text");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > INTELLIGENCE_MAX_PROMPT_CHARS) {
    throw new TypeError("Assistant prompt is outside its allowed bounds");
  }
  return normalized;
}

function clipContextText(value) {
  return value.length <= MAX_CONTEXT_MESSAGE_CHARS
    ? value
    : `${value.slice(0, MAX_CONTEXT_MESSAGE_CHARS - 1).trimEnd()}…`;
}

function sessionContext(messages) {
  const selected = messages.slice(-MAX_CONTEXT_MESSAGES);
  if (selected.length === 0) return Object.freeze([]);

  const parts = [];
  let remaining = INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS;
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const message = selected[index];
    const rendered = `${message.role}: ${clipContextText(message.text)}`;
    const cost = rendered.length + (parts.length === 0 ? 0 : 2);
    if (cost > remaining) {
      if (remaining > 16) {
        const clipped = rendered.slice(Math.max(0, rendered.length - remaining + 1));
        parts.unshift(`…${clipped}`);
      }
      break;
    }
    parts.unshift(rendered);
    remaining -= cost;
  }

  const text = parts.join("\n\n");
  if (!text) return Object.freeze([]);
  return Object.freeze([Object.freeze({
    id: "assistant-session",
    scope: "user",
    text,
    provenance: "ordax-assistant-session",
  })]);
}

function runtimeState(snapshot) {
  if (!snapshot) return "unavailable";
  if (snapshot.state === "ready") return "ready";
  if (snapshot.state === "busy") return "busy";
  if (snapshot.state === "error") return "error";
  return "unavailable";
}

export function createAssistantConversationRuntime({ intelligencePort = null } = {}) {
  const intelligence = intelligencePort === null ? null : assertIntelligencePort(intelligencePort);
  let messages = Object.freeze([]);
  let state = runtimeState(
    intelligence === null ? null : validateIntelligenceSnapshot(intelligence.getSnapshot()),
  );
  let lastError = null;
  let ordinal = 0;
  let disposed = false;
  const listeners = new Set();

  const assertAlive = () => {
    if (disposed) throw new Error("Assistant conversation runtime is disposed");
  };

  const snapshot = () => Object.freeze({
    schema: ASSISTANT_CONVERSATION_SCHEMA,
    state,
    messages,
    lastError,
    authority: "none",
    toolExecution: false,
    persistence: "session",
  });

  const publish = () => {
    if (disposed) return;
    const current = snapshot();
    for (const listener of [...listeners]) listener(current);
  };

  const append = (role, text, metadata = {}) => {
    ordinal += 1;
    const next = Object.freeze({
      id: `assistant-message-${ordinal}`,
      role,
      text,
      engineId: metadata.engineId ?? null,
      modelId: metadata.modelId ?? null,
    });
    messages = Object.freeze([...messages, next].slice(-MAX_MESSAGES));
    return next;
  };

  const unsubscribe = intelligence?.subscribe((next) => {
    if (disposed || state === "busy") return;
    state = runtimeState(validateIntelligenceSnapshot(next));
    publish();
  }) ?? null;

  return Object.freeze({
    schema: ASSISTANT_CONVERSATION_SCHEMA,
    getSnapshot() {
      return snapshot();
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Assistant conversation listener must be a function");
      }
      if (disposed) return () => {};
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    async send(value) {
      assertAlive();
      const prompt = boundedPrompt(value);
      if (intelligence === null) {
        throw new Error("Ordax Intelligence is unavailable in this composition");
      }
      if (state === "busy") {
        throw new Error("Assistant conversation is already processing a request");
      }
      const intelligenceSnapshot = validateIntelligenceSnapshot(intelligence.getSnapshot());
      if (intelligenceSnapshot.state !== "ready") {
        state = runtimeState(intelligenceSnapshot);
        publish();
        throw new Error("Ordax Intelligence is not ready");
      }

      const priorContext = sessionContext(messages);
      append("user", prompt);
      state = "busy";
      lastError = null;
      publish();

      try {
        const response = validateIntelligenceResponse(await intelligence.respond({
          intent: "ask",
          prompt,
          context: priorContext,
          maxTokens: 512,
        }));
        if (disposed) return response;
        append("assistant", response.text, {
          engineId: response.engineId,
          modelId: response.modelId,
        });
        state = runtimeState(validateIntelligenceSnapshot(intelligence.getSnapshot()));
        lastError = null;
        publish();
        return response;
      } catch {
        if (disposed) throw new Error("Assistant response failed");
        state = runtimeState(validateIntelligenceSnapshot(intelligence.getSnapshot()));
        if (state === "ready") state = "error";
        lastError = "response-failed";
        publish();
        throw new Error("Assistant response failed");
      }
    },
    clear() {
      assertAlive();
      if (state === "busy") {
        throw new Error("Assistant conversation cannot be cleared while a response is pending");
      }
      messages = Object.freeze([]);
      lastError = null;
      state = runtimeState(
        intelligence === null ? null : validateIntelligenceSnapshot(intelligence.getSnapshot()),
      );
      publish();
      return snapshot();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      listeners.clear();
      messages = Object.freeze([]);
    },
  });
}
