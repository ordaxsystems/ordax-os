export const DEVICE_ACTION_REQUEST_SCHEMA = "ordax.device-action-request/1";
export const DEVICE_ACTION_RECEIPT_SCHEMA = "ordax.device-action-receipt/1";

const CLIENTS = new Set(["ordax-web", "ordax-mobile", "ordax-desktop", "ordax-native", "mcp"]);
const ACTION_STATES = new Set([
  "accepted",
  "running",
  "succeeded",
  "failed",
  "rejected",
  "expired",
  "cancelled",
]);
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
const OPERATION_RE = /^[a-z][a-z0-9._-]{0,95}$/;
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
    if (FORBIDDEN_PAYLOAD_KEYS.has(key.toLowerCase())) {
      throw new TypeError(`${label} cannot contain credential-like field ${key}`);
    }
    out[key] = validateStructuredValue(raw, `${label}.${key}`, depth + 1);
  }
  return Object.freeze(out);
}

export function validateDeviceActionRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Device action request must be an object");
  }
  if (value.schema !== DEVICE_ACTION_REQUEST_SCHEMA) {
    throw new TypeError("Device action request schema is incompatible");
  }
  if (!CLIENTS.has(value.client)) {
    throw new TypeError("Device action client is invalid");
  }
  const capability = boundedText(value.capability, "Device action capability", 120);
  if (FORBIDDEN_CAPABILITIES.has(capability)) {
    throw new TypeError("Device action capability is forbidden");
  }
  if (typeof value.operation !== "string" || !OPERATION_RE.test(value.operation)) {
    throw new TypeError("Device action operation is invalid");
  }

  const requestedAt = safeInteger(value.requestedAt, "Device action requestedAt");
  const expiresAt = safeInteger(value.expiresAt, "Device action expiresAt");
  if (expiresAt <= requestedAt) {
    throw new TypeError("Device action expiresAt must be after requestedAt");
  }

  return Object.freeze({
    schema: DEVICE_ACTION_REQUEST_SCHEMA,
    actionId: boundedText(value.actionId, "Device action id", 128),
    idempotencyKey: boundedText(value.idempotencyKey, "Device action idempotency key", 128),
    accountId: boundedText(value.accountId, "Device action account id", 128),
    spaceId: boundedText(value.spaceId, "Device action Space id", 128),
    projectId: boundedText(value.projectId, "Device action project id", 128),
    deviceId: boundedText(value.deviceId, "Device action device id", 128),
    client: value.client,
    capability,
    operation: value.operation,
    parameters: validateStructuredValue(value.parameters ?? {}, "Device action parameters"),
    requestedAt,
    expiresAt,
    expectedDeviceRevision: value.expectedDeviceRevision == null
      ? null
      : safeInteger(value.expectedDeviceRevision, "Device action expectedDeviceRevision"),
  });
}

export function validateDeviceActionReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Device action receipt must be an object");
  }
  if (value.schema !== DEVICE_ACTION_RECEIPT_SCHEMA) {
    throw new TypeError("Device action receipt schema is incompatible");
  }
  if (!ACTION_STATES.has(value.state)) {
    throw new TypeError("Device action receipt state is invalid");
  }

  return Object.freeze({
    schema: DEVICE_ACTION_RECEIPT_SCHEMA,
    actionId: boundedText(value.actionId, "Device action receipt action id", 128),
    deviceId: boundedText(value.deviceId, "Device action receipt device id", 128),
    state: value.state,
    acceptedAt: value.acceptedAt == null
      ? null
      : safeInteger(value.acceptedAt, "Device action acceptedAt"),
    completedAt: value.completedAt == null
      ? null
      : safeInteger(value.completedAt, "Device action completedAt"),
    deviceRevision: value.deviceRevision == null
      ? null
      : safeInteger(value.deviceRevision, "Device action deviceRevision"),
    resultCode: nullableBoundedText(value.resultCode, "Device action resultCode", 96),
    message: nullableBoundedText(value.message, "Device action receipt message", 240),
  });
}
