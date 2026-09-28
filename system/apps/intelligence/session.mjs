import {
  INTELLIGENCE_MAX_PROMPT_CHARS,
  assertIntelligencePort,
  validateIntelligenceSnapshot,
} from "../../contracts/intelligence.mjs";
import { assertIntelligenceContextRegistry } from "../../contracts/intelligence-context.mjs";
import { validateIntelligenceTaskPlanningRequest } from "../../contracts/intelligence-task.mjs";
import { createIntelligenceContextCapsuleBuilder } from "../../services/intelligence/context-capsule.mjs";
import { createIntelligenceTaskPlanner } from "../../services/intelligence/task-planner.mjs";

export const INTELLIGENCE_CHAT_SESSION_SCHEMA = "ordax.intelligence-chat-session/1";
export const INTELLIGENCE_CHAT_MAX_MESSAGES = 48;

const EMPTY_CONTEXT_SOURCES = Object.freeze([]);
const MESSAGE_KINDS = new Set(["chat", "plan"]);

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

function freezeMessage(role, text, kind = "chat") {
  if (!MESSAGE_KINDS.has(kind)) {
    throw new TypeError("Intelligence chat message kind is invalid");
  }
  return Object.freeze({ role, text, kind });
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

function planningInput(value, fallbackMaxTokens) {
  if (typeof value === "string") {
    return validateIntelligenceTaskPlanningRequest({
      goal: promptText(value),
      context: [],
      maxTokens: fallbackMaxTokens,
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence planning input must be text or an object");
  }
  return validateIntelligenceTaskPlanningRequest({
    goal: promptText(value.goal),
    target: value.target,
    constraints: value.constraints,
    acceptance: value.acceptance,
    context: [],
    maxTokens: value.maxTokens ?? fallbackMaxTokens,
  });
}

function freezeSnapshot({
  intelligence,
  messages,
  pending,
  failed,
  contextSources,
  lastContextCapsule,
  lastPlan,
}) {
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
    lastContextCapsule,
    lastPlan,
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
  const planner = createIntelligenceTaskPlanner(intelligence);
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > 2048) {
    throw new TypeError("Intelligence chat maxTokens must be between 1 and 2048");
  }
  const contextRegistry = contextRegistryValue === null
    ? null
    : assertIntelligenceContextRegistry(contextRegistryValue);
  const capsuleBuilder = contextRegistry === null
    ? null
    : createIntelligenceContextCapsuleBuilder(contextRegistry);
  const explicitSources = explicitContextSourceIds(includeExplicitContextSourceIds);
  const contextSources = capsuleBuilder?.listSources() ?? EMPTY_CONTEXT_SOURCES;

  let messages = [];
  let pending = false;
  let failed = false;
  let lastContextCapsule = null;
  let lastPlan = null;
  let intelligenceSnapshot = validateIntelligenceSnapshot(intelligence.getSnapshot());
  let destroyed = false;
  const listeners = new Set();

  const snapshot = () => freezeSnapshot({
    intelligence: intelligenceSnapshot,
    messages,
    pending,
    failed,
    contextSources,
    lastContextCapsule,
    lastPlan,
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

  const begin = (prompt, kind = "chat") => {
    if (destroyed) throw new Error("Intelligence chat session is disposed");
    if (pending) throw new Error("Intelligence chat already has a request in flight");
    intelligenceSnapshot = validateIntelligenceSnapshot(intelligence.getSnapshot());
    if (intelligenceSnapshot.state !== "ready") {
      throw new Error("Ordax Intelligence is not ready for conversation");
    }
    messages = [...messages, freezeMessage("user", prompt, kind)]
      .slice(-INTELLIGENCE_CHAT_MAX_MESSAGES);
    pending = true;
    failed = false;
    publish();
  };

  const collectCapsule = async (intent, prompt, target = null) => (
    capsuleBuilder === null
      ? null
      : capsuleBuilder.build({
        intent,
        prompt,
        target,
        includeExplicitSourceIds: explicitSources,
      })
  );

  const finish = () => {
    pending = false;
    intelligenceSnapshot = validateIntelligenceSnapshot(intelligence.getSnapshot());
    publish();
  };

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
      lastContextCapsule = null;
      lastPlan = null;
      publish();
    },
    async send(value) {
      const prompt = promptText(value);
      begin(prompt, "chat");
      lastPlan = null;
      try {
        lastContextCapsule = await collectCapsule("ask", prompt);
        const response = await intelligence.respond({
          intent: "ask",
          prompt,
          context: lastContextCapsule?.context ?? [],
          maxTokens,
        });
        messages = [...messages, freezeMessage("assistant", response.text, "chat")]
          .slice(-INTELLIGENCE_CHAT_MAX_MESSAGES);
        return response;
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        finish();
      }
    },
    async plan(value) {
      const request = planningInput(value, Math.max(maxTokens, 1024));
      begin(request.goal, "plan");
      try {
        lastContextCapsule = await collectCapsule("plan", request.goal, request.target);
        const plan = await planner.plan({
          goal: request.goal,
          target: request.target,
          constraints: request.constraints,
          acceptance: request.acceptance,
          context: lastContextCapsule?.context ?? [],
          maxTokens: request.maxTokens,
        });
        lastPlan = plan;
        messages = [...messages, freezeMessage("assistant", plan.advisory, "plan")]
          .slice(-INTELLIGENCE_CHAT_MAX_MESSAGES);
        return plan;
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        finish();
      }
    },
    dispose() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeIntelligence();
      listeners.clear();
      messages = [];
      lastContextCapsule = null;
      lastPlan = null;
    },
  });
}
