import {
  DEVICE_ACTION_RECEIPT_SCHEMA,
  validateDeviceActionReceipt,
} from "./device-action-envelope.mjs";
import {
  validateDeviceActionActorV2,
  validateDeviceActionClientV2,
  validateDeviceActionDeviceIdV2,
  validateDeviceActionScopeIdV2,
} from "./device-action-envelope-v2.mjs";

export const DEVICE_ACTION_RESULT_SCHEMA = "ordax.device-action-result/1";

const KEY_CONTROL_RE = /[\u0000-\u001f\u007f]/;
const TEXT_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const FORBIDDEN_RESULT_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
]);
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_RESULT_DEPTH = 6;
const MAX_ARRAY_ITEMS = 1024;
const MAX_OBJECT_FIELDS = 256;
const MAX_KEY_LENGTH = 128;
const MAX_STRING_BYTES = 512 * 1024;
const ACTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const encoder = new TextEncoder();

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

function validateKey(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_KEY_LENGTH
    || KEY_CONTROL_RE.test(value)
  ) {
    throw new TypeError(`${label} contains an invalid field name`);
  }
  if (FORBIDDEN_RESULT_KEYS.has(value.toLowerCase())) {
    throw new TypeError(`${label} cannot contain credential-like field ${value}`);
  }
  return value;
}

function validateResultValue(value, label, depth = 0) {
  if (depth > MAX_RESULT_DEPTH) {
    throw new TypeError(`${label} exceeds maximum nesting depth`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    if (TEXT_CONTROL_RE.test(value) || encoder.encode(value).byteLength > MAX_STRING_BYTES) {
      throw new TypeError(`${label} contains invalid or oversized text`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new TypeError(`${label} has too many items`);
    }
    return Object.freeze(
      value.map((item, index) => validateResultValue(item, `${label}[${index}]`, depth + 1)),
    );
  }
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label} must contain JSON-safe values`);
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_OBJECT_FIELDS) {
    throw new TypeError(`${label} has too many fields`);
  }
  const out = {};
  for (const [rawKey, rawValue] of entries) {
    const key = validateKey(rawKey, label);
    out[key] = validateResultValue(rawValue, `${label}.${key}`, depth + 1);
  }
  return Object.freeze(out);
}

export function validateDeviceActionResultBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Device action result binding must be an object");
  }
  exactKeys(
    value,
    ["actionId", "actor", "spaceId", "projectId", "deviceId", "client"],
    "Device action result binding",
  );
  if (typeof value.actionId !== "string" || !ACTION_ID_RE.test(value.actionId)) {
    throw new TypeError("Device action result binding action id is invalid");
  }
  return Object.freeze({
    actionId: value.actionId,
    actor: validateDeviceActionActorV2(value.actor),
    spaceId: validateDeviceActionScopeIdV2(value.spaceId, "Device action result Space id"),
    projectId: validateDeviceActionScopeIdV2(value.projectId, "Device action result project id"),
    deviceId: validateDeviceActionDeviceIdV2(value.deviceId),
    client: validateDeviceActionClientV2(value.client),
  });
}

export function validateDeviceActionResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Device action result must be an object");
  }
  exactKeys(value, ["schema", "binding", "receipt", "output"], "Device action result");
  if (value.schema !== DEVICE_ACTION_RESULT_SCHEMA) {
    throw new TypeError("Device action result schema is incompatible");
  }

  const binding = validateDeviceActionResultBinding(value.binding);
  const receipt = validateDeviceActionReceipt(value.receipt);
  if (receipt.actionId !== binding.actionId || receipt.deviceId !== binding.deviceId) {
    throw new TypeError("Device action result receipt does not match its binding");
  }

  const output = value.output == null
    ? null
    : validateResultValue(value.output, "Device action result output");
  if (receipt.state !== "succeeded" && output !== null) {
    throw new TypeError("Non-succeeded device action result must not expose output");
  }

  const normalized = Object.freeze({
    schema: DEVICE_ACTION_RESULT_SCHEMA,
    binding,
    receipt,
    output,
  });
  if (encoder.encode(JSON.stringify(normalized)).byteLength > MAX_RESULT_BYTES) {
    throw new TypeError("Device action result exceeds byte budget");
  }
  return normalized;
}

export { DEVICE_ACTION_RECEIPT_SCHEMA };
