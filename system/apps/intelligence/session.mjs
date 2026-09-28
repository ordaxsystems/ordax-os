import {
  INTELLIGENCE_MAX_PROMPT_CHARS,
  assertIntelligencePort,
  validateIntelligenceSnapshot,
} from "../../contracts/intelligence.mjs";

export const INTELLIGENCE_CHAT_SESSION_SCHEMA = "ordax.intelligence-chat-session/1";
export const INTELLIGENCE_CHAT_MAX_MESSAGES = 48;

function promptText(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Intelligence chat prompt must be text");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > INTELLIGENCE_MAX_PROMPT_CHARS) {
    throw new TypeError("Intelligence chat prompt is outside its allowed bounds");
  }
  return normalized;
}

function freezeMessage(role, text) {
  return Object.freeze({ role, text });
}

function boundedMessages(messages) {
  return Object.freeze(messages.slice(-INTELLIGENCE_CHAT_MAX_MESSAGES));
}

function freezeSnapshot({ intelligence, messages, pending, failed }) {
  return Object.freeze({
    schema: INTELLIGENCE_CHAT_SESSION_SCHEMA,
    intelligence: validateIntelligenceSnapshot(intelligence),
    messages: boundedMessages(messages),
    pending: pending === true,
    failed: failed === true,
    history: "session-only",
    webGrounding: false,
    externalProvider: false,
    toolExecution: false,
  });
}

export function createIntelligenceChatSession(intelligenceValue, { maxTokens = 768 } = {}) {
  const intelligence = assertIntelligencePort(intelligenceValue);
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > 2048) {
    throw new TypeError("Intelligence chat maxTokens must be between 1 and 2048");
  }

  let messages = [];
  let pending = false;
  let failed = false;
  let intelligenceSnapshot = validateIntelligenceSnapshot(intelligence.getSnapshot());
  let destroyed = false;
  const listeners = new Set();

  const snapshot = () => freezeSnapshot({
    intelligence: intelligenceSnapshot,
    messages,
    pending,
    failed,
  });

  const publish = () => {
    if (destroyed) return;
    const next = snapshot();
    for (const listener of [...listeners]) listener(next);
  };

  const unsubscribeIntelligence = intelligence.subscribe((next) => {
    intelligenceSnapshot = validateIntelligenceSnapshot(next);
    publish();
  });

  return Object.freeze({
    schema: INTELLIGENCE_CHAT_SESSION_SCHEMA,
    getSnapshot() {
      return snapshot();
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Intelligence chat listener must be a function");
      }
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      if (destroyed) return;
      messages = [];
      failed = false;
      publish();
    },
    async send(value) {
      if (destroyed) throw new Error("Intelligence chat session is disposed");
      const prompt = promptText(value);
      if (pending) throw new Error("Intelligence chat already has a request in flight");
      intelligenceSnapshot = validateIntelligenceSnapshot(intelligence.getSnapshot());
      if (intelligenceSnapshot.state !== "ready") {
        throw new Error("Ordax Intelligence is not ready for conversation");
      }

      messages = [...messages, freezeMessage("user", prompt)].slice(-INTELLIGENCE_CHAT_MAX_MESSAGES);
      pending = true;
      failed = false;
      publish();

      try {
        const response = await intelligence.respond({
          intent: "ask",
          prompt,
          context: [],
          maxTokens,
        });
        messages = [
          ...messages,
          freezeMessage("assistant", response.text),
        ].slice(-INTELLIGENCE_CHAT_MAX_MESSAGES);
        return response;
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        pending = false;
        intelligenceSnapshot = validateIntelligenceSnapshot(intelligence.getSnapshot());
        publish();
      }
    },
    dispose() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeIntelligence();
      listeners.clear();
      messages = [];
    },
  });
}
