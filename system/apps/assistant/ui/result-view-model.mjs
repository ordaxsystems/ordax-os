import { ASSISTANT_CONVERSATION_SCHEMA } from "../conversation.mjs";

// A view of the existing conversation session, not a second result authority.
// Only model responses committed by the Assistant runtime may become a canvas
// block. In-flight text, prompts and proposals are never receipts or actions.
export const ASSISTANT_RESULT_CANVAS_SCHEMA = "ordax.assistant-result-canvas/1";
const MAX_MESSAGES = 24;
const MAX_TEXT_CHARS = 65536;

function safeMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)
    || !["user", "assistant"].includes(message.role)
    || typeof message.id !== "string" || !/^assistant-message-[1-9]\d*$/.test(message.id)
    || typeof message.text !== "string" || !message.text.trim()
    || message.text.length > MAX_TEXT_CHARS || message.text.includes("\0")) {
    throw new TypeError("Assistant result canvas requires a valid session message");
  }
  if (message.role === "assistant" && (
    typeof message.engineId !== "string" || !message.engineId.trim()
    || message.engineId.length > 80 || message.engineId.includes("\0")
    || typeof message.modelId !== "string" || !message.modelId.trim()
    || message.modelId.length > 160 || message.modelId.includes("\0")
  )) {
    throw new TypeError("Assistant response requires verified model provenance");
  }
  return message;
}

export function projectAssistantResultCanvas(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || snapshot.schema !== ASSISTANT_CONVERSATION_SCHEMA
    || !["ready", "busy", "error", "unavailable"].includes(snapshot.state)
    || snapshot.authority !== "none" || snapshot.toolExecution !== false
    || snapshot.persistence !== "session"
    || !Array.isArray(snapshot.messages) || snapshot.messages.length > MAX_MESSAGES) {
    throw new TypeError("Assistant result canvas requires a consultative session snapshot");
  }
  const messages = snapshot.messages.map(safeMessage);
  if (new Set(messages.map((item) => item.id)).size !== messages.length) {
    throw new TypeError("Assistant conversation message ids must be unique");
  }
  const last = messages.at(-1) ?? null;
  // A model response is renderable only when the existing runtime has already
  // committed it to the scoped conversation history (never provisional deltas).
  const latestResult = last?.role === "assistant" ? last : null;
  let state;
  if (snapshot.state === "unavailable") state = "unavailable";
  else if (snapshot.lastError) state = "failed";
  else if (snapshot.inferencePending === true) state = "working";
  else if (latestResult) state = "result";
  else if (messages.length === 0) state = snapshot.state === "error" ? "failed" : "idle";
  else state = snapshot.state === "error" ? "failed" : "unavailable";

  const shown = state === "result" ? latestResult : null;
  return Object.freeze({
    schema: ASSISTANT_RESULT_CANVAS_SCHEMA,
    state,
    resultMessageId: shown?.id ?? null,
    blocks: Object.freeze(shown ? [Object.freeze({
      kind: "text",
      text: shown.text,
      provenance: Object.freeze({ engineId: shown.engineId, modelId: shown.modelId }),
    })] : []),
    // Messages come from the *same* session runtime. Never persist or fork them.
    history: Object.freeze(messages.map(({ id, role, text }) => Object.freeze({ id, role, text }))),
    steps: Object.freeze([]), // Inference progress does not imply Work activity.
    completionPercent: null,
    authority: "none",
    toolExecution: false,
  });
}
