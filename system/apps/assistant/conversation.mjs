import {
  INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS,
  INTELLIGENCE_MAX_PROMPT_CHARS,
  INTELLIGENCE_PORT_SCHEMA,
  assertIntelligencePort,
  validateIntelligenceResponse,
  validateIntelligenceSnapshot,
} from "../../contracts/intelligence.mjs";

import { assertIdentitySessionPort, validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
import { assertSpaceSelectionPort, validateSpaceSelectionSnapshot } from "../../contracts/space-selection.mjs";
import { assertProfileActivationStatePort, validateProfileActivationState } from "../../contracts/profile-activation-state.mjs";

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

// Conversation history is session-only and must never outlive its trusted scope.
// These snapshots are read from the existing Identity, Space and Profile owners;
// they confer no permissions and are never shown to the model as authority.
function readConversationScope(identity, selection, profileActivation) {
  try {
    const account = validateIdentitySessionSnapshot(identity.getSnapshot());
    const space = validateSpaceSelectionSnapshot(selection.getSnapshot());
    if (account.state === "signed-out") {
      return space.state === "unavailable" ? "device:signed-out" : null;
    }
    if (account.state !== "signed-in"
      || space.state === "unavailable"
      || space.subjectId !== account.subjectId) {
      return null;
    }
    if (space.state === "unselected") {
      return JSON.stringify(["account", account.subjectId, null]);
    }
    // The global Assistant currently receives no project-scoped input.
    // A future project consumer must include the authorized project identity here.
    const selected = space.selectedSpace;
    const profileRevision = profileActivation === null
      ? null
      : validateProfileActivationState(profileActivation.getSnapshot()).revision;
    return JSON.stringify([
      "account",
      account.subjectId,
      selected.id,
      selected.kind,
      selected.profilePack,
      profileRevision,
    ]);
  } catch {
    // Malformed, stale or inaccessible authorization state is never a valid scope.
    return null;
  }
}

export function createAssistantConversationRuntime({
  intelligencePort = null,
  memoryCapture = null,
  identitySessionPort,
  spaceSelectionPort,
  profileActivationStatePort = null,
} = {}) {
  const intelligence = intelligencePort === null ? null : assertIntelligencePort(intelligencePort);
  if (
    memoryCapture !== null
    && (
      typeof memoryCapture !== "object"
      || typeof memoryCapture.bindTurn !== "function"
    )
  ) {
    throw new TypeError("Assistant memoryCapture must implement bindTurn()");
  }
  const identity = assertIdentitySessionPort(identitySessionPort);
  const selection = assertSpaceSelectionPort(spaceSelectionPort);
  const activation = profileActivationStatePort === null
    ? null
    : assertProfileActivationStatePort(profileActivationStatePort);
  if (activation !== null && typeof activation.subscribe !== "function") {
    throw new TypeError("Assistant Profile activation scope requires subscribe()");
  }
  let scopeKey = readConversationScope(identity, selection, activation);
  let scopeGeneration = 0;
  let requestInFlight = false;
  let messages = Object.freeze([]);
  let state = scopeKey === null
    ? "unavailable"
    : runtimeState(intelligence === null ? null : validateIntelligenceSnapshot(intelligence.getSnapshot()));
  let lastError = null;
  let memoryCaptureState = memoryCapture === null ? "unavailable" : "idle";
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
    memoryCaptureState,
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

  const reconcileScope = () => {
    if (disposed) return;
    const next = readConversationScope(identity, selection, activation);
    if (scopeKey === next) return;
    scopeKey = next;
    scopeGeneration += 1;
    messages = Object.freeze([]);
    lastError = null;
    memoryCaptureState = memoryCapture === null ? "unavailable" : "idle";
    state = scopeKey === null ? "unavailable" : (
      requestInFlight ? "busy" : runtimeState(
        intelligence === null ? null : validateIntelligenceSnapshot(intelligence.getSnapshot()),
      )
    );
    publish();
  };

  const unsubscribeIdentity = identity.subscribe(reconcileScope);
  const unsubscribeSelection = selection.subscribe(reconcileScope);
  const unsubscribeActivation = activation?.subscribe(reconcileScope) ?? null;
  const unsubscribe = intelligence?.subscribe((next) => {
    if (disposed) return;
    reconcileScope();
    if (scopeKey === null || requestInFlight) return;
    state = runtimeState(validateIntelligenceSnapshot(next));
    publish();
  }) ?? null;

  return Object.freeze({
    schema: ASSISTANT_CONVERSATION_SCHEMA,
    getSnapshot() {
      reconcileScope();
      return snapshot();
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Assistant conversation listener must be a function");
      }
      if (disposed) return () => {};
      reconcileScope();
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    async send(value) {
      assertAlive();
      reconcileScope();
      if (scopeKey === null) {
        throw new Error("Assistant conversation context is unavailable");
      }
      const generationAtStart = scopeGeneration;
      const prompt = boundedPrompt(value);
      if (intelligence === null) {
        throw new Error("Ordax Intelligence is unavailable in this composition");
      }
      if (requestInFlight) {
        throw new Error("Assistant conversation is already processing a request");
      }
      const intelligenceSnapshot = validateIntelligenceSnapshot(intelligence.getSnapshot());
      if (intelligenceSnapshot.state !== "ready") {
        state = runtimeState(intelligenceSnapshot);
        publish();
        throw new Error("Ordax Intelligence is not ready");
      }

      const priorContext = sessionContext(messages);
      let boundMemoryTurn = null;
      if (memoryCapture !== null) {
        try {
          boundMemoryTurn = memoryCapture.bindTurn();
        } catch {
          memoryCaptureState = "error";
        }
      }
      append("user", prompt);
      requestInFlight = true;
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
        reconcileScope();
        if (disposed || scopeGeneration !== generationAtStart) {
          throw new Error("Assistant conversation context changed");
        }
        append("assistant", response.text, {
          engineId: response.engineId,
          modelId: response.modelId,
        });
        state = runtimeState(validateIntelligenceSnapshot(intelligence.getSnapshot()));
        lastError = null;
        publish();

        if (boundMemoryTurn !== null) {
          reconcileScope();
          if (scopeGeneration !== generationAtStart) {
            throw new Error("Assistant conversation context changed");
          }
          memoryCaptureState = "pending";
          publish();
          try {
            const captureResult = await boundMemoryTurn.capture({
              userText: prompt,
            });
            reconcileScope();
            if (scopeGeneration !== generationAtStart) {
              throw new Error("Assistant conversation context changed");
            }
            memoryCaptureState = captureResult?.status ?? "complete";
          } catch {
            reconcileScope();
            if (scopeGeneration !== generationAtStart) {
              throw new Error("Assistant conversation context changed");
            }
            memoryCaptureState = "error";
          }
          publish();
        }
        return response;
      } catch {
        if (disposed) throw new Error("Assistant response failed");
        reconcileScope();
        if (scopeGeneration !== generationAtStart) {
          throw new Error("Assistant conversation context changed");
        }
        state = runtimeState(validateIntelligenceSnapshot(intelligence.getSnapshot()));
        if (state === "ready") state = "error";
        lastError = "response-failed";
        publish();
        throw new Error("Assistant response failed");
      } finally {
        requestInFlight = false;
        if (!disposed && scopeGeneration !== generationAtStart) {
          state = scopeKey === null
            ? "unavailable"
            : runtimeState(validateIntelligenceSnapshot(intelligence.getSnapshot()));
          publish();
        }
      }
    },
    clear() {
      assertAlive();
      reconcileScope();
      if (requestInFlight) {
        throw new Error("Assistant conversation cannot be cleared while a response is pending");
      }
      messages = Object.freeze([]);
      lastError = null;
      memoryCaptureState = memoryCapture === null ? "unavailable" : "idle";
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
      unsubscribeActivation?.();
      unsubscribeSelection();
      unsubscribeIdentity();
      listeners.clear();
      messages = Object.freeze([]);
    },
  });
}
