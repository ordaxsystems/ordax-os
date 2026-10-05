import {
  DEVICE_ACTION_RECEIPT_SCHEMA,
  validateDeviceActionReceipt,
} from "./device-action-envelope.mjs";

export const DEVICE_ACTION_REQUEST_V2_SCHEMA = "ordax.device-action-request/2";
export { DEVICE_ACTION_RECEIPT_SCHEMA, validateDeviceActionReceipt };

const CLIENTS = new Set(["ordax-web", "ordax-mobile", "ordax-desktop", "ordax-native", "mcp"]);
const ACTOR_KINDS = new Set(["device-owner", "account"]);
const FORBIDDEN_CAPABILITIES = new Set([
  "shell.generic",
  "disk.raw",
  "release.signing-key",
  "admin.implicit",
]);
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
]);
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const CAPABILITY_RE = /^[a-z][a-z0-9._-]{0,119}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const REQUEST_FIELDS = Object.freeze([
  "schema",
  "actionId",
  "idempotencyKey",
  "actor",
  "spaceId",
  "projectId",
  "deviceId",
  "client",
  "capability",
  "parameters",
  "requestedAt",
  "expiresAt",
  "expectedDeviceRevision",
]);

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

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} fields are incompatible`);
  }
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

export function validateDeviceActionActorV2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Device action actor must be an object");
  }
  exactKeys(value, ["kind", "subjectId"], "Device action actor");
  if (!ACTOR_KINDS.has(value.kind)) {
    throw new TypeError("Device action actor kind is invalid");
  }
  const subjectId = nullableBoundedText(value.subjectId, "Device action actor subject id", 128);
  if (value.kind === "device-owner" && subjectId !== null) {
    throw new TypeError("Device-owner action must not fabricate an account subject id");
  }
  if (value.kind === "account" && subjectId === null) {
    throw new TypeError("Account action requires a real subject id");
  }
  return Object.freeze({ kind: value.kind, subjectId });
}

export function validateDeviceActionClientV2(value) {
  if (!CLIENTS.has(value)) {
    throw new TypeError("Device action client is invalid");
  }
  return value;
}

export function validateDeviceActionDeviceIdV2(value) {
  return boundedText(value, "Device action device id", 128);
}

export function validateDeviceActionScopeIdV2(value, label) {
  return nullableBoundedText(value, label, 128);
}

export function validateDeviceActionRequestV2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Device action request v2 must be an object");
  }
  exactKeys(value, REQUEST_FIELDS, "Device action request v2");
  if (value.schema !== DEVICE_ACTION_REQUEST_V2_SCHEMA) {
    throw new TypeError("Device action request v2 schema is incompatible");
  }
  const client = validateDeviceActionClientV2(value.client);
  if (typeof value.capability !== "string" || !CAPABILITY_RE.test(value.capability)) {
    throw new TypeError("Device action capability id is invalid");
  }
  const capability = value.capability;
  if (FORBIDDEN_CAPABILITIES.has(capability)) {
    throw new TypeError("Device action capability is forbidden");
  }

  const requestedAt = safeInteger(value.requestedAt, "Device action requestedAt");
  const expiresAt = safeInteger(value.expiresAt, "Device action expiresAt");
  if (expiresAt <= requestedAt) {
    throw new TypeError("Device action expiresAt must be after requestedAt");
  }

  return Object.freeze({
    schema: DEVICE_ACTION_REQUEST_V2_SCHEMA,
    actionId: boundedText(value.actionId, "Device action id", 128),
    idempotencyKey: boundedText(value.idempotencyKey, "Device action idempotency key", 128),
    actor: validateDeviceActionActorV2(value.actor),
    spaceId: validateDeviceActionScopeIdV2(value.spaceId, "Device action Space id"),
    projectId: validateDeviceActionScopeIdV2(value.projectId, "Device action project id"),
    deviceId: validateDeviceActionDeviceIdV2(value.deviceId),
    client,
    capability,
    parameters: validateStructuredValue(value.parameters ?? {}, "Device action parameters"),
    requestedAt,
    expiresAt,
    expectedDeviceRevision: value.expectedDeviceRevision == null
      ? null
      : safeInteger(value.expectedDeviceRevision, "Device action expectedDeviceRevision"),
  });
}
