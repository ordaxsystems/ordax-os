import {
  DEVICE_ACTION_RECEIPT_SCHEMA,
  validateDeviceActionReceipt,
} from "./device-action-envelope.mjs";

export const DEVICE_ACTION_RESULT_SCHEMA = "ordax.device-action-result/1";

const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const FORBIDDEN_RESULT_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
]);
const MAX_RESULT_BUDGET = 1024 * 1024;
const MAX_RESULT_DEPTH = 6;
const MAX_ARRAY_ITEMS = 1024;
const MAX_OBJECT_FIELDS = 256;
const MAX_KEY_LENGTH = 128;
const MAX_STRING_LENGTH = 512 * 1024;

function consume(budget, amount, label) {
  budget.remaining -= amount;
  if (budget.remaining < 0) {
    throw new TypeError(`${label} exceeds result size budget`);
  }
}

function validateKey(value, label, budget) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_KEY_LENGTH
    || CONTROL_RE.test(value)
  ) {
    throw new TypeError(`${label} contains an invalid field name`);
  }
  if (FORBIDDEN_RESULT_KEYS.has(value.toLowerCase())) {
    throw new TypeError(`${label} cannot contain credential-like field ${value}`);
  }
  consume(budget, value.length, label);
  return value;
}

function validateResultValue(value, label, budget, depth = 0) {
  if (depth > MAX_RESULT_DEPTH) {
    throw new TypeError(`${label} exceeds maximum nesting depth`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH || CONTROL_RE.test(value)) {
      throw new TypeError(`${label} contains invalid text`);
    }
    consume(budget, value.length, label);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new TypeError(`${label} has too many items`);
    }
    consume(budget, value.length, label);
    return Object.freeze(
      value.map((item, index) =>
        validateResultValue(item, `${label}[${index}]`, budget, depth + 1)),
    );
  }
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label} must contain JSON-safe values`);
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_OBJECT_FIELDS) {
    throw new TypeError(`${label} has too many fields`);
  }
  consume(budget, entries.length, label);
  const out = {};
  for (const [rawKey, rawValue] of entries) {
    const key = validateKey(rawKey, label, budget);
    out[key] = validateResultValue(rawValue, `${label}.${key}`, budget, depth + 1);
  }
  return Object.freeze(out);
}

export function validateDeviceActionResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Device action result must be an object");
  }
  const keys = Object.keys(value).sort();
  const expected = ["output", "receipt", "schema"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError("Device action result fields are incompatible");
  }
  if (value.schema !== DEVICE_ACTION_RESULT_SCHEMA) {
    throw new TypeError("Device action result schema is incompatible");
  }
  const receipt = validateDeviceActionReceipt(value.receipt);
  const budget = { remaining: MAX_RESULT_BUDGET };
  const output = value.output == null
    ? null
    : validateResultValue(value.output, "Device action result output", budget);
  return Object.freeze({
    schema: DEVICE_ACTION_RESULT_SCHEMA,
    receipt,
    output,
  });
}

export { DEVICE_ACTION_RECEIPT_SCHEMA };
