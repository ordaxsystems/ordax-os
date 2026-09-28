import { validateIntelligenceAgentId } from "./intelligence-agent.mjs";
import {
  validateIntelligenceToolAuditRef,
} from "./intelligence-tool-authorization.mjs";
import { validateIntelligenceToolId } from "./intelligence-tool.mjs";

export const INTELLIGENCE_AUDIT_JOURNAL_SCHEMA = "ordax.intelligence-audit-journal/1";
export const INTELLIGENCE_AUDIT_ENTRY_SCHEMA = "ordax.intelligence-audit-entry/1";
export const DEFAULT_INTELLIGENCE_AUDIT_LIMIT = 256;
export const MAX_INTELLIGENCE_AUDIT_LIMIT = 1024;

const ENTRY_KINDS = new Set(["authorization", "execution"]);
const AUTHORIZATION_EVENTS = new Set(["issued", "claimed", "revoked", "expired"]);
const EXECUTION_EVENTS = new Set(["succeeded", "failed"]);
const CAPABILITY_ID_RE = /^[a-z][a-z0-9.-]{0,127}$/;
const SCOPE_ID_RE = /^[a-z][a-z0-9.-]{0,63}$/;
const ALLOWED_ENTRY_KEYS = new Set([
  "schema",
  "sequence",
  "kind",
  "receiptId",
  "auditRef",
  "event",
  "agentId",
  "toolId",
  "capabilityId",
  "targetScope",
  "occurredAt",
  "executionOccurred",
  "readOnly",
  "networkEgress",
  "mutatedState",
  "authority",
]);

function boundedText(value, label, maximum) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function patternText(value, label, pattern, maximum) {
  const normalized = boundedText(value, label, maximum);
  if (!pattern.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

export function validateIntelligenceAuditLimit(value) {
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > MAX_INTELLIGENCE_AUDIT_LIMIT
  ) {
    throw new TypeError(
      `Intelligence audit journal limit must be an integer between 1 and ${MAX_INTELLIGENCE_AUDIT_LIMIT}`,
    );
  }
  return value;
}

export function validateIntelligenceAuditEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence audit entry must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_ENTRY_KEYS.has(key)) {
      throw new TypeError(`Intelligence audit entry field ${key} is not allowed`);
    }
  }
  if (value.schema !== INTELLIGENCE_AUDIT_ENTRY_SCHEMA) {
    throw new TypeError("Intelligence audit entry schema is invalid");
  }
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) {
    throw new TypeError("Intelligence audit entry sequence must be a positive safe integer");
  }
  if (!ENTRY_KINDS.has(value.kind)) {
    throw new TypeError("Intelligence audit entry kind is invalid");
  }
  const allowedEvents = value.kind === "authorization"
    ? AUTHORIZATION_EVENTS
    : EXECUTION_EVENTS;
  if (!allowedEvents.has(value.event)) {
    throw new TypeError("Intelligence audit entry event is invalid for its kind");
  }
  const executionOccurred = value.kind === "execution";
  if (
    value.executionOccurred !== executionOccurred
    || value.readOnly !== true
    || value.networkEgress !== false
    || value.mutatedState !== false
    || value.authority !== "none"
  ) {
    throw new TypeError("Intelligence audit entry violates the read-only authority boundary");
  }
  if (!Number.isSafeInteger(value.occurredAt) || value.occurredAt < 0) {
    throw new TypeError("Intelligence audit entry occurredAt must be a non-negative safe integer");
  }

  return Object.freeze({
    schema: INTELLIGENCE_AUDIT_ENTRY_SCHEMA,
    sequence: value.sequence,
    kind: value.kind,
    receiptId: boundedText(value.receiptId, "Intelligence audit receipt id", 192),
    auditRef: validateIntelligenceToolAuditRef(value.auditRef),
    event: value.event,
    agentId: validateIntelligenceAgentId(value.agentId),
    toolId: validateIntelligenceToolId(value.toolId),
    capabilityId: patternText(
      value.capabilityId,
      "Intelligence audit capability id",
      CAPABILITY_ID_RE,
      128,
    ),
    targetScope: patternText(
      value.targetScope,
      "Intelligence audit target scope",
      SCOPE_ID_RE,
      64,
    ),
    occurredAt: value.occurredAt,
    executionOccurred,
    readOnly: true,
    networkEgress: false,
    mutatedState: false,
    authority: "none",
  });
}

export function assertIntelligenceAuditJournal(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== INTELLIGENCE_AUDIT_JOURNAL_SCHEMA
  ) {
    throw new TypeError("Compatible Intelligence audit journal is required");
  }
  for (const method of [
    "recordAuthorizationReceipt",
    "recordExecutionReceipt",
    "list",
    "listByAuditRef",
  ]) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`Intelligence audit journal must implement ${method}()`);
    }
  }
  return value;
}
