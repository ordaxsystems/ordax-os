import { validateIntelligenceAgentId } from "./intelligence-agent.mjs";
import { validateIntelligenceContext } from "./intelligence.mjs";
import { validateIntelligenceToolAuditRef } from "./intelligence-tool-authorization.mjs";
import { validateIntelligenceToolId } from "./intelligence-tool.mjs";

export const INTELLIGENCE_READ_ONLY_TOOL_EXECUTOR_SCHEMA = "ordax.intelligence-readonly-tool-executor/1";
export const INTELLIGENCE_TOOL_EXECUTION_RESULT_SCHEMA = "ordax.intelligence-tool-execution-result/1";
export const INTELLIGENCE_TOOL_EXECUTION_RECEIPT_SCHEMA = "ordax.intelligence-tool-execution-receipt/1";

const CAPABILITY_ID_RE = /^[a-z][a-z0-9.-]{0,127}$/;
const SCOPE_ID_RE = /^[a-z][a-z0-9.-]{0,63}$/;
const RECEIPT_ID_RE = /^tool-exec-receipt-[A-Za-z0-9_-]{16,160}$/;
const RECEIPT_EVENTS = new Set(["succeeded", "failed"]);
const RESULT_KEYS = new Set([
  "schema",
  "auditRef",
  "agentId",
  "toolId",
  "capabilityId",
  "targetScope",
  "context",
  "executionOccurred",
  "readOnly",
  "networkEgress",
  "mutatedState",
  "authority",
]);
const RECEIPT_KEYS = new Set([
  "schema",
  "id",
  "auditRef",
  "event",
  "agentId",
  "toolId",
  "capabilityId",
  "targetScope",
  "startedAt",
  "completedAt",
  "executionOccurred",
  "readOnly",
  "networkEgress",
  "mutatedState",
  "authority",
]);

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} field ${key} is not allowed`);
  }
}

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

function patternText(value, label, pattern, max) {
  const normalized = boundedText(value, label, max);
  if (!pattern.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function validateSafety(value, label) {
  if (
    value.executionOccurred !== true
    || value.readOnly !== true
    || value.networkEgress !== false
    || value.mutatedState !== false
    || value.authority !== "none"
  ) {
    throw new TypeError(`${label} must describe an executed read-only, offline, non-mutating operation`);
  }
}

export function validateIntelligenceToolExecutionResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence tool execution result must be an object");
  }
  rejectUnknownKeys(value, RESULT_KEYS, "Intelligence tool execution result");
  if (value.schema !== INTELLIGENCE_TOOL_EXECUTION_RESULT_SCHEMA) {
    throw new TypeError("Intelligence tool execution result schema is invalid");
  }
  validateSafety(value, "Intelligence tool execution result");
  return Object.freeze({
    schema: INTELLIGENCE_TOOL_EXECUTION_RESULT_SCHEMA,
    auditRef: validateIntelligenceToolAuditRef(value.auditRef),
    agentId: validateIntelligenceAgentId(value.agentId),
    toolId: validateIntelligenceToolId(value.toolId),
    capabilityId: patternText(
      value.capabilityId,
      "Intelligence tool execution capability id",
      CAPABILITY_ID_RE,
      128,
    ),
    targetScope: patternText(
      value.targetScope,
      "Intelligence tool execution target scope",
      SCOPE_ID_RE,
      64,
    ),
    context: validateIntelligenceContext(value.context),
    executionOccurred: true,
    readOnly: true,
    networkEgress: false,
    mutatedState: false,
    authority: "none",
  });
}

export function validateIntelligenceToolExecutionReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence tool execution receipt must be an object");
  }
  rejectUnknownKeys(value, RECEIPT_KEYS, "Intelligence tool execution receipt");
  if (value.schema !== INTELLIGENCE_TOOL_EXECUTION_RECEIPT_SCHEMA) {
    throw new TypeError("Intelligence tool execution receipt schema is invalid");
  }
  if (!RECEIPT_EVENTS.has(value.event)) {
    throw new TypeError("Intelligence tool execution receipt event is invalid");
  }
  validateSafety(value, "Intelligence tool execution receipt");
  const startedAt = timestamp(value.startedAt, "Intelligence tool execution start");
  const completedAt = timestamp(value.completedAt, "Intelligence tool execution completion");
  if (completedAt < startedAt) {
    throw new TypeError("Intelligence tool execution receipt completion precedes start");
  }
  return Object.freeze({
    schema: INTELLIGENCE_TOOL_EXECUTION_RECEIPT_SCHEMA,
    id: patternText(
      value.id,
      "Intelligence tool execution receipt id",
      RECEIPT_ID_RE,
      178,
    ),
    auditRef: validateIntelligenceToolAuditRef(value.auditRef),
    event: value.event,
    agentId: validateIntelligenceAgentId(value.agentId),
    toolId: validateIntelligenceToolId(value.toolId),
    capabilityId: patternText(
      value.capabilityId,
      "Intelligence tool execution capability id",
      CAPABILITY_ID_RE,
      128,
    ),
    targetScope: patternText(
      value.targetScope,
      "Intelligence tool execution target scope",
      SCOPE_ID_RE,
      64,
    ),
    startedAt,
    completedAt,
    executionOccurred: true,
    readOnly: true,
    networkEgress: false,
    mutatedState: false,
    authority: "none",
  });
}
