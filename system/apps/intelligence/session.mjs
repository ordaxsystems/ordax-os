import {
  INTELLIGENCE_MAX_PROMPT_CHARS,
  assertIntelligencePort,
  validateIntelligenceSnapshot,
} from "../../contracts/intelligence.mjs";
import { assertIntelligenceContextRegistry } from "../../contracts/intelligence-context.mjs";

export const INTELLIGENCE_CHAT_SESSION_SCHEMA = "ordax.intelligence-chat-session/1";
export const INTELLIGENCE_CHAT_MAX_MESSAGES = 48;

const EMPTY_CONTEXT_SOURCES = Object.freeze([]);

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

function explicitContextSourceIds(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError("Intelligence chat explicit context sources must be a bounded array");
  }
  const ids = value.map((id) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new TypeError("Intelligence chat explicit context source id is invalid");
    }
    return id.trim();
  });
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Intelligence chat explicit context source ids must be unique");
  }
  return Object.freeze(ids);
}

function freezeSnapshot({ intelligence, messages, pending, failed, contextSources }) {
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
    contextSources,
  });
}

export function createIntelligenceChatSession(
  intelligenceValue,
  {
    maxTokens = 768,
    contextRegistry: contextRegistryValue = null,
    includeExplicitContextSourceIds = [],
  } = {},
) {
  const intelligence = assertIntelligencePort(intelligenceValue);
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > 2048) {
    throw new TypeError("Intelligence chat maxTokens must be between 1 and 2048");
  }
  const contextRegistry = contextRegistryValue === null
    ? null
    : assertIntelligenceContextRegistry(contextRegistryValue);
  const explicitSources = explicitContextSourceIds(includeExplicitContextSourceIds);
  const contextSources = contextRegistry?.listSources() ?? EMPTY_CONTEXT_SOURCES;

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
    contextSources,
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
        const context = contextRegistry === null
          ? []
          : await contextRegistry.collect({
            intent: "ask",
            prompt,
            includeExplicitSourceIds: explicitSources,
          });
        const response = await intelligence.respond({
          intent: "ask",
          prompt,
          context,
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
