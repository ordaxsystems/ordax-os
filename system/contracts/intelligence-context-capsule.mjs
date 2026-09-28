import { validateIntelligenceContext } from "./intelligence.mjs";
import { validateIntelligenceTaskTarget } from "./intelligence-task.mjs";

export const INTELLIGENCE_CONTEXT_CAPSULE_SCHEMA = "ordax.intelligence-context-capsule/1";
export const INTELLIGENCE_CONTEXT_CAPSULE_BUILDER_SCHEMA = "ordax.intelligence-context-capsule-builder/1";

const INTENTS = new Set(["ask", "explain", "summarize", "diagnose", "plan"]);
const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,95}$/;
const MAX_SOURCE_IDS = 64;

function sourceIds(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_SOURCE_IDS) {
    throw new TypeError("Intelligence context capsule sourceIds must be a bounded array");
  }
  const ids = value.map((id) => {
    if (typeof id !== "string" || !SOURCE_ID_RE.test(id)) {
      throw new TypeError("Intelligence context capsule source id is invalid");
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Intelligence context capsule source ids must be unique");
  }
  return Object.freeze(ids);
}

export function validateIntelligenceContextCapsule(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence context capsule must be an object");
  }
  if (value.schema !== INTELLIGENCE_CONTEXT_CAPSULE_SCHEMA) {
    throw new TypeError("Intelligence context capsule schema is invalid");
  }
  const intent = value.intent ?? "ask";
  if (!INTENTS.has(intent)) {
    throw new TypeError("Intelligence context capsule intent is invalid");
  }
  if (value.authority !== "none" || value.executable !== false || value.toolExecution !== false) {
    throw new TypeError("Intelligence context capsule must remain data-only and non-executable");
  }
  return Object.freeze({
    schema: INTELLIGENCE_CONTEXT_CAPSULE_SCHEMA,
    intent,
    target: validateIntelligenceTaskTarget(value.target),
    sourceIds: sourceIds(value.sourceIds),
    context: validateIntelligenceContext(value.context),
    authority: "none",
    executable: false,
    toolExecution: false,
  });
}
