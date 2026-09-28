import { validateIntelligenceContext } from "./intelligence.mjs";

export const INTELLIGENCE_TASK_PLAN_SCHEMA = "ordax.intelligence-task-plan/1";
export const INTELLIGENCE_TASK_PLANNER_SCHEMA = "ordax.intelligence-task-planner/1";

const TARGET_KINDS = new Set([
  "unspecified",
  "system",
  "app",
  "workspace",
  "project",
  "document",
  "device",
]);
const RISK_LEVELS = new Set(["unassessed", "low", "medium", "high"]);
const CAPABILITY_ID_RE = /^[a-z][a-z0-9.-]{0,127}$/;
const MAX_LIST_ITEMS = 32;

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function textList(value, label, maxChars = 512) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const result = value.map((entry) => boundedText(entry, label, maxChars));
  if (new Set(result).size !== result.length) {
    throw new TypeError(`${label} entries must be unique`);
  }
  return Object.freeze(result);
}

export function validateIntelligenceTaskTarget(value) {
  if (value == null) {
    return Object.freeze({ kind: "unspecified", id: null });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence task target must be an object");
  }
  const kind = value.kind ?? "unspecified";
  if (!TARGET_KINDS.has(kind)) {
    throw new TypeError("Intelligence task target kind is invalid");
  }
  const id = value.id == null ? null : boundedText(value.id, "Intelligence task target id", 256);
  if (kind !== "unspecified" && id === null) {
    throw new TypeError("Intelligence task target id is required for a concrete target");
  }
  if (kind === "unspecified" && id !== null) {
    throw new TypeError("Unspecified Intelligence task target cannot carry an id");
  }
  return Object.freeze({ kind, id });
}

export function validateIntelligenceTaskPlanningRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence planning request must be an object");
  }
  const maxTokens =
    Number.isSafeInteger(value.maxTokens)
    && value.maxTokens > 0
    && value.maxTokens <= 2048
      ? value.maxTokens
      : 1024;
  return Object.freeze({
    goal: boundedText(value.goal, "Intelligence task goal", 4000),
    target: validateIntelligenceTaskTarget(value.target),
    constraints: textList(value.constraints, "Intelligence task constraint"),
    acceptance: textList(value.acceptance, "Intelligence task acceptance criterion"),
    context: validateIntelligenceContext(value.context),
    maxTokens,
  });
}

export function validateIntelligenceTaskPlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence task plan must be an object");
  }
  if (value.schema !== INTELLIGENCE_TASK_PLAN_SCHEMA) {
    throw new TypeError("Intelligence task plan schema is invalid");
  }
  if (value.authority !== "none" || value.executable !== false || value.toolExecution !== false) {
    throw new TypeError("Intelligence task planning must remain non-executable");
  }
  if (!RISK_LEVELS.has(value.risk)) {
    throw new TypeError("Intelligence task risk is invalid");
  }
  const capabilities = textList(value.requestedCapabilities, "Intelligence requested capability", 128);
  if (capabilities.some((capability) => !CAPABILITY_ID_RE.test(capability))) {
    throw new TypeError("Intelligence requested capability id is invalid");
  }
  return Object.freeze({
    schema: INTELLIGENCE_TASK_PLAN_SCHEMA,
    goal: boundedText(value.goal, "Intelligence task goal", 4000),
    target: validateIntelligenceTaskTarget(value.target),
    risk: value.risk,
    constraints: textList(value.constraints, "Intelligence task constraint"),
    acceptance: textList(value.acceptance, "Intelligence task acceptance criterion"),
    requestedCapabilities: capabilities,
    advisory: boundedText(value.advisory, "Intelligence task advisory", 131072),
    engineId: boundedText(value.engineId, "Intelligence task engine id", 80),
    modelId: boundedText(value.modelId, "Intelligence task model id", 160),
    authority: "none",
    executable: false,
    toolExecution: false,
  });
}
