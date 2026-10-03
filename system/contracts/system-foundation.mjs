export const SYSTEM_FOUNDATION_SCHEMA = "ordax.system-foundation/1";
export const SYSTEM_CAPABILITY_STATE_SCHEMA = "ordax.system-capability-state/1";
export const SYSTEM_SERVICE_DESCRIPTOR_SCHEMA = "ordax.system-service/1";
export const SYSTEM_EVENT_SCHEMA = "ordax.system-event/1";
export const SYSTEM_POLICY_DECISION_SCHEMA = "ordax.system-policy-decision/1";

const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const POLICY_EFFECTS = new Set(["pass", "require-approval", "deny"]);
const EVENT_SENSITIVITY = new Set(["system", "private", "restricted"]);

function text(value, label, max = 160) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > max || value.includes("\0")) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function id(value, label) {
  const normalized = text(value, label, 160);
  if (!ID_RE.test(normalized)) throw new TypeError(`${label} must be a stable lowercase id`);
  return normalized;
}

function optionalText(value, label, max = 240) {
  return value === null || value === undefined ? null : text(value, label, max);
}

function uniqueIds(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const result = value.map((entry) => id(entry, `${label} entry`));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must not contain duplicates`);
  return Object.freeze(result);
}

export function validateSystemCapabilityState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("System capability state must be an object");
  }
  if (value.schema !== SYSTEM_CAPABILITY_STATE_SCHEMA) {
    throw new TypeError("System capability state schema is invalid");
  }
  if (typeof value.available !== "boolean") {
    throw new TypeError("System capability availability must be boolean");
  }
  return Object.freeze({
    schema: SYSTEM_CAPABILITY_STATE_SCHEMA,
    id: id(value.id, "System capability id"),
    available: value.available,
    source: id(value.source, "System capability source"),
    reason: optionalText(value.reason, "System capability reason", 240),
    authority: "none",
  });
}

export function validateSystemServiceDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("System service descriptor must be an object");
  }
  if (value.schema !== SYSTEM_SERVICE_DESCRIPTOR_SCHEMA) {
    throw new TypeError("System service descriptor schema is invalid");
  }
  const serviceId = id(value.id, "System service id");
  const dependencies = uniqueIds(value.dependencies ?? [], "System service dependencies");
  const optionalDependencies = uniqueIds(
    value.optionalDependencies ?? [],
    "System service optional dependencies",
  );
  if (dependencies.includes(serviceId) || optionalDependencies.includes(serviceId)) {
    throw new TypeError("System service cannot depend on itself");
  }
  const overlap = dependencies.filter((entry) => optionalDependencies.includes(entry));
  if (overlap.length > 0) throw new TypeError("System service dependency cannot be both required and optional");
  return Object.freeze({
    schema: SYSTEM_SERVICE_DESCRIPTOR_SCHEMA,
    id: serviceId,
    dependencies,
    optionalDependencies,
    capabilities: uniqueIds(value.capabilities ?? [], "System service capabilities"),
    critical: value.critical === true,
  });
}

export function validateSystemEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("System event must be an object");
  }
  if (value.schema !== SYSTEM_EVENT_SCHEMA) throw new TypeError("System event schema is invalid");
  const sequence = value.sequence;
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new TypeError("System event sequence is invalid");
  }
  const occurredAt = text(value.occurredAt, "System event timestamp", 64);
  if (Number.isNaN(Date.parse(occurredAt))) throw new TypeError("System event timestamp is invalid");
  const sensitivity = value.sensitivity ?? "system";
  if (!EVENT_SENSITIVITY.has(sensitivity)) throw new TypeError("System event sensitivity is invalid");
  return Object.freeze({
    schema: SYSTEM_EVENT_SCHEMA,
    sequence,
    type: id(value.type, "System event type"),
    source: id(value.source, "System event source"),
    occurredAt,
    correlationId: optionalText(value.correlationId, "System event correlation id", 160),
    subjectId: optionalText(value.subjectId, "System event subject id", 240),
    sensitivity,
    authority: "none",
  });
}

export function validateSystemPolicyDecision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("System policy decision must be an object");
  }
  if (value.schema !== SYSTEM_POLICY_DECISION_SCHEMA) {
    throw new TypeError("System policy decision schema is invalid");
  }
  if (!POLICY_EFFECTS.has(value.effect)) throw new TypeError("System policy effect is invalid");
  return Object.freeze({
    schema: SYSTEM_POLICY_DECISION_SCHEMA,
    effect: value.effect,
    reasonCode: id(value.reasonCode, "System policy reason code"),
    source: id(value.source, "System policy source"),
    authority: "none",
  });
}
