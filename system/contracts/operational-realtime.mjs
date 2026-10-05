import { validateDeviceCapabilityGrant } from "./device-agent.mjs";
import {
  DEVICE_ACTION_RECEIPT_SCHEMA,
  DEVICE_ACTION_REQUEST_SCHEMA,
  validateDeviceActionReceipt,
  validateDeviceActionRequest,
} from "./device-action-envelope.mjs";

export {
  DEVICE_ACTION_RECEIPT_SCHEMA,
  DEVICE_ACTION_REQUEST_SCHEMA,
  validateDeviceActionReceipt,
  validateDeviceActionRequest,
} from "./device-action-envelope.mjs";

export const OPERATIONAL_EVENT_SCHEMA = "ordax.operational-event/1";
export const OPERATIONAL_SUBSCRIPTION_SCHEMA = "ordax.operational-subscription/1";

const SOURCE_KINDS = new Set(["server", "client", "device"]);
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
]);
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const DOMAIN_RE = /^[a-z][a-z0-9.-]{0,95}$/;
const TYPE_RE = /^[a-z][a-z0-9._-]{0,95}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function boundedText(value, label, max = 160) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > max
    || CONTROL_RE.test(value)
  ) {
    throw new TypeError(`${label} must be bounded printable text`);
  }
  return value;
}

function nullableBoundedText(value, label, max = 160) {
  if (value === null || value === undefined) return null;
  return boundedText(value, label, max);
}

function safeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function validateStructuredValue(value, label, depth = 0) {
  if (depth > 4) {
    throw new TypeError(`${label} exceeds maximum nesting depth`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return boundedText(value, label, 512);
  if (Array.isArray(value)) {
    if (value.length > 32) throw new TypeError(`${label} has too many items`);
    return Object.freeze(
      value.map((item, index) => validateStructuredValue(item, `${label}[${index}]`, depth + 1)),
    );
  }
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label} must contain JSON-safe values`);
  }
  const entries = Object.entries(value);
  if (entries.length > 32) throw new TypeError(`${label} has too many fields`);
  const out = {};
  for (const [key, raw] of entries) {
    boundedText(key, `${label} key`, 64);
    const normalizedKey = key.toLowerCase();
    if (FORBIDDEN_PAYLOAD_KEYS.has(normalizedKey)) {
      throw new TypeError(`${label} cannot contain credential-like field ${key}`);
    }
    if (FORBIDDEN_OBJECT_KEYS.has(normalizedKey)) {
      throw new TypeError(`${label} cannot contain prototype-control field ${key}`);
    }
    out[key] = validateStructuredValue(raw, `${label}.${key}`, depth + 1);
  }
  return Object.freeze(out);
}

function validateDomain(value) {
  if (typeof value !== "string" || !DOMAIN_RE.test(value)) {
    throw new TypeError("Operational domain is invalid");
  }
  return value;
}

function validateType(value, label) {
  if (typeof value !== "string" || !TYPE_RE.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function validateOperationalEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Operational event must be an object");
  }
  if (value.schema !== OPERATIONAL_EVENT_SCHEMA) {
    throw new TypeError("Operational event schema is incompatible");
  }
  if (!SOURCE_KINDS.has(value.sourceKind)) {
    throw new TypeError("Operational event sourceKind is invalid");
  }

  return Object.freeze({
    schema: OPERATIONAL_EVENT_SCHEMA,
    eventId: boundedText(value.eventId, "Operational event id", 128),
    accountId: boundedText(value.accountId, "Operational account id", 128),
    spaceId: boundedText(value.spaceId, "Operational Space id", 128),
    projectId: nullableBoundedText(value.projectId, "Operational project id", 128),
    domain: validateDomain(value.domain),
    aggregateType: validateType(value.aggregateType, "Operational aggregateType"),
    aggregateId: boundedText(value.aggregateId, "Operational aggregate id", 128),
    eventType: validateType(value.eventType, "Operational eventType"),
    sequence: safeInteger(value.sequence, "Operational sequence", 1),
    revision: safeInteger(value.revision, "Operational revision", 1),
    occurredAt: safeInteger(value.occurredAt, "Operational occurredAt"),
    sourceKind: value.sourceKind,
    sourceId: boundedText(value.sourceId, "Operational source id", 128),
    payload: validateStructuredValue(value.payload ?? {}, "Operational payload"),
  });
}

export function validateOperationalSubscription(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Operational subscription must be an object");
  }
  if (value.schema !== OPERATIONAL_SUBSCRIPTION_SCHEMA) {
    throw new TypeError("Operational subscription schema is incompatible");
  }
  if (!Array.isArray(value.domains) || value.domains.length < 1 || value.domains.length > 32) {
    throw new TypeError("Operational subscription domains are invalid");
  }
  const domains = value.domains.map(validateDomain).sort();
  if (new Set(domains).size !== domains.length) {
    throw new TypeError("Operational subscription domains must be unique");
  }
  const limit = safeInteger(value.limit ?? 100, "Operational subscription limit", 1);
  if (limit > 250) throw new TypeError("Operational subscription limit exceeds 250");

  return Object.freeze({
    schema: OPERATIONAL_SUBSCRIPTION_SCHEMA,
    accountId: boundedText(value.accountId, "Operational account id", 128),
    spaceId: boundedText(value.spaceId, "Operational Space id", 128),
    projectId: nullableBoundedText(value.projectId, "Operational project id", 128),
    domains: Object.freeze(domains),
    afterSequence: safeInteger(value.afterSequence ?? 0, "Operational afterSequence"),
    limit,
  });
}

export function validateAuthorizedDeviceActionRequest(value, grantValue) {
  const request = validateDeviceActionRequest(value);
  const grant = validateDeviceCapabilityGrant(grantValue);

  const exact = [
    ["accountId", request.accountId, grant.accountId],
    ["spaceId", request.spaceId, grant.spaceId],
    ["projectId", request.projectId, grant.projectId],
    ["deviceId", request.deviceId, grant.deviceId],
    ["client", request.client, grant.client],
    ["capability", request.capability, grant.capability],
  ];
  for (const [label, expected, actual] of exact) {
    if (expected !== actual) {
      throw new TypeError(`Device action ${label} does not match authorized grant`);
    }
  }
  if (grant.mode !== "write" || grant.approved !== true) {
    throw new TypeError("Device action requires an approved write grant");
  }
  return request;
}
