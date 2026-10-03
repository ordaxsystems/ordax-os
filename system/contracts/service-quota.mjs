export const SERVICE_QUOTA_POLICY_SCHEMA = "ordax.service-quota-policy/1";
export const SERVICE_QUOTA_USAGE_SCHEMA = "ordax.service-quota-usage/1";
export const SERVICE_QUOTA_DECISION_SCHEMA = "ordax.service-quota-decision/1";

const SUBJECT_TYPES = new Set(["account", "space"]);
const AUTHORITIES = new Set(["server", "local-default"]);
const UNITS = new Set(["bytes", "items", "operations", "compute-units", "days"]);
const KEY_RE = /^[a-z][a-z0-9.-]{2,95}$/;

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

function key(value) {
  const normalized = boundedText(value, "Quota key", 96);
  if (!KEY_RE.test(normalized)) throw new TypeError("Quota key is invalid");
  return normalized;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function canonicalTimestamp(value, label) {
  const text = boundedText(value, label, 64);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} is invalid`);
  return new Date(parsed).toISOString();
}

function subject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  if (!SUBJECT_TYPES.has(value.subjectType)) {
    throw new TypeError(`${label} subject type is invalid`);
  }
  return Object.freeze({
    subjectType: value.subjectType,
    subjectId: boundedText(value.subjectId, `${label} subject id`, 160),
  });
}

export function validateServiceQuotaPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Service quota policy must be an object");
  }
  if (value.schema !== SERVICE_QUOTA_POLICY_SCHEMA) {
    throw new TypeError("Service quota policy schema is invalid");
  }
  const normalizedSubject = subject(value, "Service quota policy");
  if (!UNITS.has(value.unit)) throw new TypeError("Service quota policy unit is invalid");
  if (!AUTHORITIES.has(value.authority)) {
    throw new TypeError("Service quota policy authority is invalid");
  }
  const limit = value.limit === null ? null : nonNegativeInteger(value.limit, "Service quota limit");
  return Object.freeze({
    schema: SERVICE_QUOTA_POLICY_SCHEMA,
    ...normalizedSubject,
    key: key(value.key),
    unit: value.unit,
    limit,
    authority: value.authority,
    expiresAt: value.expiresAt == null ? null : canonicalTimestamp(value.expiresAt, "Service quota expiry"),
  });
}

export function validateServiceQuotaUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Service quota usage must be an object");
  }
  if (value.schema !== SERVICE_QUOTA_USAGE_SCHEMA) {
    throw new TypeError("Service quota usage schema is invalid");
  }
  const normalizedSubject = subject(value, "Service quota usage");
  if (!UNITS.has(value.unit)) throw new TypeError("Service quota usage unit is invalid");
  if (value.authority !== "server") {
    throw new TypeError("Remote service quota usage must be server-authoritative");
  }
  return Object.freeze({
    schema: SERVICE_QUOTA_USAGE_SCHEMA,
    ...normalizedSubject,
    key: key(value.key),
    unit: value.unit,
    used: nonNegativeInteger(value.used, "Service quota used units"),
    reserved: nonNegativeInteger(value.reserved ?? 0, "Service quota reserved units"),
    authority: "server",
    measuredAt: canonicalTimestamp(value.measuredAt, "Service quota measurement timestamp"),
  });
}

export function validateServiceQuotaAdmissionRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Service quota admission request must be an object");
  }
  const normalizedSubject = subject(value, "Service quota admission request");
  if (!UNITS.has(value.unit)) throw new TypeError("Service quota admission request unit is invalid");
  return Object.freeze({
    ...normalizedSubject,
    key: key(value.key),
    unit: value.unit,
    requested: nonNegativeInteger(value.requested ?? 0, "Requested quota units"),
  });
}
