import { validateIntelligenceAgentId } from "./intelligence-agent.mjs";
import { validateIntelligenceTaskTarget } from "./intelligence-task.mjs";
import { validateIntelligenceToolId } from "./intelligence-tool.mjs";

export const INTELLIGENCE_TOOL_RECEIPT_SCHEMA = "ordax.intelligence-tool-receipt/1";

const RECEIPT_ID_RE = /^tool-receipt-[a-z0-9]{16,96}$/;
const CAPABILITY_ID_RE = /^[a-z][a-z0-9.-]{0,127}$/;
const EVENTS = new Set(["issued", "consumed", "revoked", "expired"]);
const ALLOWED_KEYS = new Set([
  "schema",
  "id",
  "event",
  "agentId",
  "toolId",
  "capabilityId",
  "target",
  "timestamp",
  "authority",
  "executionOccurred",
  "mutatedState",
  "networkEgress",
]);

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

export function validateIntelligenceToolReceiptId(value) {
  const id = boundedText(value, "Intelligence tool receipt id", 112);
  if (!RECEIPT_ID_RE.test(id)) {
    throw new TypeError("Intelligence tool receipt id is invalid");
  }
  return id;
}

export function validateIntelligenceToolReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence tool receipt must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new TypeError(`Intelligence tool receipt field ${key} is not allowed`);
    }
  }
  if (value.schema !== INTELLIGENCE_TOOL_RECEIPT_SCHEMA) {
    throw new TypeError("Intelligence tool receipt schema is invalid");
  }
  if (!EVENTS.has(value.event)) {
    throw new TypeError("Intelligence tool receipt event is invalid");
  }
  if (
    value.authority !== "none"
    || value.executionOccurred !== false
    || value.mutatedState !== false
    || value.networkEgress !== false
  ) {
    throw new TypeError("Intelligence tool authorization receipt cannot claim execution or authority");
  }
  if (!Number.isSafeInteger(value.timestamp) || value.timestamp < 0) {
    throw new TypeError("Intelligence tool receipt timestamp is invalid");
  }
  const capabilityId = boundedText(value.capabilityId, "Intelligence tool receipt capability id", 128);
  if (!CAPABILITY_ID_RE.test(capabilityId)) {
    throw new TypeError("Intelligence tool receipt capability id is invalid");
  }
  const target = validateIntelligenceTaskTarget(value.target);
  if (target.kind === "unspecified") {
    throw new TypeError("Intelligence tool receipt requires a concrete target");
  }

  return Object.freeze({
    schema: INTELLIGENCE_TOOL_RECEIPT_SCHEMA,
    id: validateIntelligenceToolReceiptId(value.id),
    event: value.event,
    agentId: validateIntelligenceAgentId(value.agentId),
    toolId: validateIntelligenceToolId(value.toolId),
    capabilityId,
    target,
    timestamp: value.timestamp,
    authority: "none",
    executionOccurred: false,
    mutatedState: false,
    networkEgress: false,
  });
}
