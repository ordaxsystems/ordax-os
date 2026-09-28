import { validateIntelligenceAgentId } from "./intelligence-agent.mjs";
import { validateIntelligenceToolId } from "./intelligence-tool.mjs";

export const INTELLIGENCE_TOOL_GRANT_SCHEMA = "ordax.intelligence-tool-grant/1";
export const INTELLIGENCE_TOOL_AUTHORIZATION_BROKER_SCHEMA = "ordax.intelligence-tool-authorization-broker/1";
export const INTELLIGENCE_TOOL_AUTHORIZATION_RECEIPT_SCHEMA = "ordax.intelligence-tool-authorization-receipt/1";

const CAPABILITY_ID_RE = /^[a-z][a-z0-9.-]{0,127}$/;
const SCOPE_ID_RE = /^[a-z][a-z0-9.-]{0,63}$/;
const GRANT_ID_RE = /^tool-grant-[A-Za-z0-9_-]{16,160}$/;
const AUDIT_REF_RE = /^tool-audit-[A-Za-z0-9_-]{16,160}$/;
const RECEIPT_ID_RE = /^tool-receipt-[A-Za-z0-9_-]{16,160}$/;
const RECEIPT_EVENTS = new Set(["issued", "claimed", "revoked", "expired"]);
const MAX_TTL_MS = 5 * 60 * 1000;

const REQUEST_KEYS = new Set(["agentId", "toolId", "targetScope", "targetId", "ttlMs"]);
const CLAIM_KEYS = new Set(["grantId", "agentId", "toolId", "targetScope", "targetId"]);
const GRANT_KEYS = new Set([
  "schema",
  "id",
  "auditRef",
  "agentId",
  "toolId",
  "capabilityId",
  "targetScope",
  "targetId",
  "issuedAt",
  "expiresAt",
  "oneShot",
  "readOnly",
  "networkEgress",
  "mutatesState",
  "executionEnabled",
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
  "timestamp",
  "executionOccurred",
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

function validatePattern(value, label, pattern, max) {
  const normalized = boundedText(value, label, max);
  if (!pattern.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function validateTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function validateIntelligenceToolGrantId(value) {
  return validatePattern(value, "Intelligence tool grant id", GRANT_ID_RE, 171);
}

export function validateIntelligenceToolAuditRef(value) {
  return validatePattern(value, "Intelligence tool audit ref", AUDIT_REF_RE, 171);
}

export function validateIntelligenceToolReceiptId(value) {
  return validatePattern(value, "Intelligence tool receipt id", RECEIPT_ID_RE, 175);
}

export function validateIntelligenceToolAuthorizationRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence tool authorization request must be an object");
  }
  rejectUnknownKeys(value, REQUEST_KEYS, "Intelligence tool authorization request");
  const ttlMs = value.ttlMs === undefined ? 60_000 : value.ttlMs;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
    throw new TypeError("Intelligence tool authorization ttl is invalid");
  }
  return Object.freeze({
    agentId: validateIntelligenceAgentId(value.agentId),
    toolId: validateIntelligenceToolId(value.toolId),
    targetScope: validatePattern(
      value.targetScope,
      "Intelligence tool target scope",
      SCOPE_ID_RE,
      64,
    ),
    targetId: boundedText(value.targetId, "Intelligence tool target id", 256),
    ttlMs,
  });
}

export function validateIntelligenceToolGrantClaim(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence tool grant claim must be an object");
  }
  rejectUnknownKeys(value, CLAIM_KEYS, "Intelligence tool grant claim");
  return Object.freeze({
    grantId: validateIntelligenceToolGrantId(value.grantId),
    agentId: validateIntelligenceAgentId(value.agentId),
    toolId: validateIntelligenceToolId(value.toolId),
    targetScope: validatePattern(
      value.targetScope,
      "Intelligence tool target scope",
      SCOPE_ID_RE,
      64,
    ),
    targetId: boundedText(value.targetId, "Intelligence tool target id", 256),
  });
}

export function validateIntelligenceToolGrant(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence tool grant must be an object");
  }
  rejectUnknownKeys(value, GRANT_KEYS, "Intelligence tool grant");
  if (value.schema !== INTELLIGENCE_TOOL_GRANT_SCHEMA) {
    throw new TypeError("Intelligence tool grant schema is invalid");
  }
  const issuedAt = validateTimestamp(value.issuedAt, "Intelligence tool grant issued time");
  const expiresAt = validateTimestamp(value.expiresAt, "Intelligence tool grant expiry");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TTL_MS) {
    throw new TypeError("Intelligence tool grant expiry window is invalid");
  }
  if (
    value.oneShot !== true
    || value.readOnly !== true
    || value.networkEgress !== false
    || value.mutatesState !== false
    || value.executionEnabled !== false
    || value.authority !== "none"
  ) {
    throw new TypeError("Intelligence tool grant must remain one-shot, read-only and non-executable");
  }
  return Object.freeze({
    schema: INTELLIGENCE_TOOL_GRANT_SCHEMA,
    id: validateIntelligenceToolGrantId(value.id),
    auditRef: validateIntelligenceToolAuditRef(value.auditRef),
    agentId: validateIntelligenceAgentId(value.agentId),
    toolId: validateIntelligenceToolId(value.toolId),
    capabilityId: validatePattern(
      value.capabilityId,
      "Intelligence tool capability id",
      CAPABILITY_ID_RE,
      128,
    ),
    targetScope: validatePattern(
      value.targetScope,
      "Intelligence tool target scope",
      SCOPE_ID_RE,
      64,
    ),
    targetId: boundedText(value.targetId, "Intelligence tool target id", 256),
    issuedAt,
    expiresAt,
    oneShot: true,
    readOnly: true,
    networkEgress: false,
    mutatesState: false,
    executionEnabled: false,
    authority: "none",
  });
}

export function validateIntelligenceToolAuthorizationReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence tool authorization receipt must be an object");
  }
  rejectUnknownKeys(value, RECEIPT_KEYS, "Intelligence tool authorization receipt");
  if (value.schema !== INTELLIGENCE_TOOL_AUTHORIZATION_RECEIPT_SCHEMA) {
    throw new TypeError("Intelligence tool authorization receipt schema is invalid");
  }
  if (!RECEIPT_EVENTS.has(value.event)) {
    throw new TypeError("Intelligence tool authorization receipt event is invalid");
  }
  if (value.executionOccurred !== false) {
    throw new TypeError("Authorization receipt cannot claim tool execution");
  }
  return Object.freeze({
    schema: INTELLIGENCE_TOOL_AUTHORIZATION_RECEIPT_SCHEMA,
    id: validateIntelligenceToolReceiptId(value.id),
    auditRef: validateIntelligenceToolAuditRef(value.auditRef),
    event: value.event,
    agentId: validateIntelligenceAgentId(value.agentId),
    toolId: validateIntelligenceToolId(value.toolId),
    capabilityId: validatePattern(
      value.capabilityId,
      "Intelligence tool capability id",
      CAPABILITY_ID_RE,
      128,
    ),
    targetScope: validatePattern(
      value.targetScope,
      "Intelligence tool target scope",
      SCOPE_ID_RE,
      64,
    ),
    timestamp: validateTimestamp(value.timestamp, "Intelligence tool authorization receipt time"),
    executionOccurred: false,
  });
}

export function assertIntelligenceToolAuthorizationBroker(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== INTELLIGENCE_TOOL_AUTHORIZATION_BROKER_SCHEMA
  ) {
    throw new TypeError("Compatible Intelligence tool authorization broker is required");
  }
  for (const method of ["issue", "describe", "claim", "revoke", "listReceipts", "dispose"]) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`Intelligence tool authorization broker must implement ${method}()`);
    }
  }
  return value;
}
