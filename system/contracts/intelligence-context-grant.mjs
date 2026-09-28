import { validateIntelligenceContext } from "./intelligence.mjs";
import { validateIntelligenceTaskTarget } from "./intelligence-task.mjs";

export const INTELLIGENCE_CONTEXT_GRANT_SCHEMA = "ordax.intelligence-context-grant/1";
export const INTELLIGENCE_CONTEXT_GRANT_BROKER_SCHEMA = "ordax.intelligence-context-grant-broker/1";

const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const GRANT_ID_RE = /^grant-[A-Za-z0-9_-]{16,160}$/;

export function validateIntelligenceContextGrantId(value) {
  if (typeof value !== "string" || !GRANT_ID_RE.test(value)) {
    throw new TypeError("Intelligence context grant id is invalid");
  }
  return value;
}

export function validateIntelligenceContextGrantDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence context grant descriptor must be an object");
  }
  if (value.schema !== INTELLIGENCE_CONTEXT_GRANT_SCHEMA) {
    throw new TypeError("Intelligence context grant schema is invalid");
  }
  if (!SOURCE_ID_RE.test(value.sourceId ?? "")) {
    throw new TypeError("Intelligence context grant source id is invalid");
  }
  const target = validateIntelligenceTaskTarget(value.target);
  if (target.kind === "unspecified") {
    throw new TypeError("Intelligence context grant requires a concrete target");
  }
  if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) {
    throw new TypeError("Intelligence context grant expiry is invalid");
  }
  if (
    value.oneShot !== true
    || value.readOnly !== true
    || value.authority !== "none"
    || value.executable !== false
    || value.toolExecution !== false
  ) {
    throw new TypeError("Intelligence context grant must remain one-shot, read-only and non-executable");
  }
  return Object.freeze({
    schema: INTELLIGENCE_CONTEXT_GRANT_SCHEMA,
    id: validateIntelligenceContextGrantId(value.id),
    sourceId: value.sourceId,
    target,
    expiresAt: value.expiresAt,
    oneShot: true,
    readOnly: true,
    authority: "none",
    executable: false,
    toolExecution: false,
  });
}

export function validateIntelligenceContextGrantPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence context grant payload must be an object");
  }
  const context = validateIntelligenceContext(value.context);
  if (context.length === 0) {
    throw new TypeError("Intelligence context grant requires non-empty authorized context");
  }
  return Object.freeze({
    sourceId: value.sourceId,
    target: validateIntelligenceTaskTarget(value.target),
    context,
  });
}

export function assertIntelligenceContextGrantBroker(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== INTELLIGENCE_CONTEXT_GRANT_BROKER_SCHEMA
  ) {
    throw new TypeError("Compatible Intelligence context grant broker is required");
  }
  for (const method of ["issue", "describe", "consume", "revoke", "dispose"]) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`Intelligence context grant broker must implement ${method}()`);
    }
  }
  return value;
}
