import { validateIntelligenceContext } from "./intelligence.mjs";
import {
  validateIntelligenceContextGrantId,
} from "./intelligence-context-grant.mjs";
import { validateIntelligenceTaskTarget } from "./intelligence-task.mjs";

export const INTELLIGENCE_CONTEXT_SHARE_PORT_SCHEMA = "ordax.intelligence-context-share/1";

const APP_ID_RE = /^[a-z][a-z0-9-]{0,95}$/;
const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

function boundedText(value, label, max = 160) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function concreteTarget(value) {
  const target = validateIntelligenceTaskTarget(value);
  if (target.kind === "unspecified") {
    throw new TypeError("Intelligence context share requires a concrete target");
  }
  return target;
}

export function validateIntelligenceContextShareSelection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence context share selection must be an object");
  }
  if (!APP_ID_RE.test(value.sourceAppId ?? "")) {
    throw new TypeError("Intelligence context share source app id is invalid");
  }
  return Object.freeze({
    sourceAppId: value.sourceAppId,
    target: concreteTarget(value.target),
  });
}

export function validateIntelligenceContextShareOffer(value) {
  const selection = validateIntelligenceContextShareSelection(value);
  if (!SOURCE_ID_RE.test(value.sourceId ?? "")) {
    throw new TypeError("Intelligence context share source id is invalid");
  }
  const context = validateIntelligenceContext(value.context);
  if (context.length === 0) {
    throw new TypeError("Intelligence context share requires non-empty context");
  }
  if (
    (value.authority !== undefined && value.authority !== "none")
    || value.executable === true
    || value.toolExecution === true
  ) {
    throw new TypeError("Intelligence context share cannot grant execution authority");
  }
  return Object.freeze({
    ...selection,
    sourceId: value.sourceId,
    displayLabel: boundedText(value.displayLabel, "Intelligence context share display label"),
    context,
    ttlMs: value.ttlMs,
    authority: "none",
    executable: false,
    toolExecution: false,
  });
}

export function validateIntelligenceContextShareAuthorization(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence context share authorization must be an object");
  }
  if (!SOURCE_ID_RE.test(value.sourceId ?? "")) {
    throw new TypeError("Intelligence context share authorization source id is invalid");
  }
  if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) {
    throw new TypeError("Intelligence context share authorization expiry is invalid");
  }
  return Object.freeze({
    sourceId: value.sourceId,
    grantId: validateIntelligenceContextGrantId(value.grantId),
    target: concreteTarget(value.target),
    displayLabel: boundedText(
      value.displayLabel,
      "Intelligence context share authorization display label",
    ),
    expiresAt: value.expiresAt,
  });
}

export function assertIntelligenceContextSharePort(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== INTELLIGENCE_CONTEXT_SHARE_PORT_SCHEMA
  ) {
    throw new TypeError("Compatible Intelligence context share port is required");
  }
  for (const method of ["offer", "take", "revoke", "dispose"]) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`Intelligence context share port must implement ${method}()`);
    }
  }
  return value;
}
