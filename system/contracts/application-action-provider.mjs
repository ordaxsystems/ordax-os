import { validateComponentId } from "./component-manifest.mjs";

export const APPLICATION_ACTION_PROVIDER_SCHEMA = "ordax.application-action-provider/1";
export const APPLICATION_ACTION_PROVIDER_INVOCATION_SCHEMA = "ordax.application-action-provider-invocation/1";
export const APPLICATION_ACTION_PROVIDER_RESULT_SCHEMA = "ordax.application-action-provider-result/1";

const ACTION_ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const ADAPTER_ID_RE = /^[a-z][a-z0-9-]{0,127}$/;
const PARAMETER_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const RESOURCE_REF_RE = /^application-action:[a-z][a-z0-9._-]{0,159}$/;
const ARTIFACT_REF_RE = /^[a-z][a-z0-9.-]{0,63}:[a-z0-9][a-z0-9._-]{0,174}$/;
const STATUSES = new Set(["succeeded", "failed"]);
const FORBIDDEN_PARAMETER_IDS = new Set([
  "path",
  "raw-path",
  "host-path",
  "command",
  "shell",
  "executable",
  "executable-path",
  "wineprefix",
  "argv",
  "environment",
  "env",
  "working-directory",
]);
const SENSITIVE_KEY_FRAGMENTS = Object.freeze([
  "authorization",
  "bearer",
  "cookie",
  "password",
  "secret",
  "token",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "credential",
  "grant",
  "approval",
  "sessionid",
  "csrf",
]);
const FORBIDDEN_RESULT_EXACT_KEYS = new Set([
  "proto",
  "constructor",
  "prototype",
]);
const MAX_ACTIONS = 64;
const MAX_ARGUMENTS = 32;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_OUTPUT_DEPTH = 6;
const MAX_OUTPUT_ARRAY_ITEMS = 512;
const MAX_OUTPUT_OBJECT_FIELDS = 128;
const MAX_OUTPUT_STRING_BYTES = 128 * 1024;
const encoder = new TextEncoder();

function exactFields(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

function boundedText(value, label, max) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > max
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function actionId(value, appId, label) {
  const id = boundedText(value, label, 128);
  if (!ACTION_ID_RE.test(id) || !id.startsWith(`${appId}.`)) {
    throw new TypeError(`${label} must be namespaced to ${appId}`);
  }
  return id;
}

function normalizedSecurityKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasSensitiveKeyFragment(value) {
  const normalized = normalizedSecurityKey(value);
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function validateArgumentValue(value, label) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string"
    && value.length <= 8192
    && !/[\u0000-\u001f\u007f]/.test(value)
  ) {
    return value;
  }
  throw new TypeError(`${label} must be a bounded scalar semantic value`);
}

function validateArguments(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || (
      Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null
    )
  ) {
    throw new TypeError("Application Action provider arguments must be a plain object");
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_ARGUMENTS) {
    throw new TypeError("Application Action provider arguments exceed the bounded field count");
  }
  const normalized = {};
  for (const [key, raw] of entries) {
    if (
      !PARAMETER_ID_RE.test(key)
      || FORBIDDEN_PARAMETER_IDS.has(key)
      || hasSensitiveKeyFragment(key)
    ) {
      throw new TypeError("Application Action provider argument id is invalid or exposes raw authority or credentials");
    }
    normalized[key] = validateArgumentValue(
      raw,
      `Application Action provider argument ${key}`,
    );
  }
  return Object.freeze(normalized);
}

function outputKey(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 128
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${label} contains an invalid field name`);
  }
  const normalized = normalizedSecurityKey(value);
  if (FORBIDDEN_RESULT_EXACT_KEYS.has(normalized) || hasSensitiveKeyFragment(value)) {
    throw new TypeError(`${label} cannot expose authority or credential field ${value}`);
  }
  return value;
}

function validateOutputValue(value, label, depth = 0) {
  if (depth > MAX_OUTPUT_DEPTH) {
    throw new TypeError(`${label} exceeds maximum nesting depth`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    if (
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
      || encoder.encode(value).byteLength > MAX_OUTPUT_STRING_BYTES
    ) {
      throw new TypeError(`${label} contains invalid or oversized text`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_OUTPUT_ARRAY_ITEMS) {
      throw new TypeError(`${label} has too many items`);
    }
    return Object.freeze(
      value.map((entry, index) =>
        validateOutputValue(entry, `${label}[${index}]`, depth + 1)),
    );
  }
  if (
    !value
    || typeof value !== "object"
    || (
      Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null
    )
  ) {
    throw new TypeError(`${label} must contain JSON-safe values`);
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_OUTPUT_OBJECT_FIELDS) {
    throw new TypeError(`${label} has too many fields`);
  }
  const normalized = Object.create(null);
  for (const [rawKey, rawValue] of entries) {
    const key = outputKey(rawKey, label);
    normalized[key] = validateOutputValue(
      rawValue,
      `${label}.${key}`,
      depth + 1,
    );
  }
  return Object.freeze(normalized);
}

export function validateApplicationActionProvider(value) {
  exactFields(
    value,
    ["schema", "appId", "adapterId", "revision", "actions", "invoke"],
    "Application Action provider",
  );
  if (value.schema !== APPLICATION_ACTION_PROVIDER_SCHEMA) {
    throw new TypeError("Application Action provider schema is incompatible");
  }
  const appId = validateComponentId(value.appId);
  if (typeof value.adapterId !== "string" || !ADAPTER_ID_RE.test(value.adapterId)) {
    throw new TypeError("Application Action provider adapter id is invalid");
  }
  const revision = boundedText(
    value.revision,
    "Application Action provider revision",
    160,
  );
  if (!Array.isArray(value.actions) || value.actions.length === 0 || value.actions.length > MAX_ACTIONS) {
    throw new TypeError("Application Action provider actions are outside bounds");
  }
  const actions = value.actions.map((id) =>
    actionId(id, appId, "Application Action provider action id"));
  if (new Set(actions).size !== actions.length) {
    throw new TypeError("Application Action provider actions must be unique");
  }
  if (typeof value.invoke !== "function") {
    throw new TypeError("Application Action provider must implement invoke()");
  }
  return Object.freeze({
    schema: APPLICATION_ACTION_PROVIDER_SCHEMA,
    appId,
    adapterId: value.adapterId,
    revision,
    actions: Object.freeze(actions),
    invoke: value.invoke,
  });
}

export function assertApplicationActionProvider(value) {
  return validateApplicationActionProvider(value);
}

export function validateApplicationActionProviderInvocation(value, {
  appId: expectedAppId = null,
  actionIds = null,
} = {}) {
  exactFields(
    value,
    ["schema", "workItemId", "resourceRef", "appId", "actionId", "arguments"],
    "Application Action provider invocation",
  );
  if (value.schema !== APPLICATION_ACTION_PROVIDER_INVOCATION_SCHEMA) {
    throw new TypeError("Application Action provider invocation schema is incompatible");
  }
  const appId = validateComponentId(value.appId);
  if (expectedAppId !== null && appId !== validateComponentId(expectedAppId)) {
    throw new TypeError("Application Action provider invocation app identity mismatch");
  }
  const id = actionId(
    value.actionId,
    appId,
    "Application Action provider invocation action id",
  );
  if (actionIds !== null) {
    if (!Array.isArray(actionIds) || !actionIds.includes(id)) {
      throw new TypeError("Application Action provider invocation action is not declared by provider");
    }
  }
  const resourceRef = boundedText(
    value.resourceRef,
    "Application Action provider invocation resource ref",
    192,
  );
  if (!RESOURCE_REF_RE.test(resourceRef)) {
    throw new TypeError("Application Action provider invocation resource ref is invalid");
  }
  return Object.freeze({
    schema: APPLICATION_ACTION_PROVIDER_INVOCATION_SCHEMA,
    workItemId: boundedText(
      value.workItemId,
      "Application Action provider invocation work item id",
      160,
    ),
    resourceRef,
    appId,
    actionId: id,
    arguments: validateArguments(value.arguments),
  });
}

export function validateApplicationActionProviderResult(value) {
  exactFields(
    value,
    ["schema", "status", "summary", "output", "artifactRefs"],
    "Application Action provider result",
  );
  if (value.schema !== APPLICATION_ACTION_PROVIDER_RESULT_SCHEMA) {
    throw new TypeError("Application Action provider result schema is incompatible");
  }
  if (!STATUSES.has(value.status)) {
    throw new TypeError("Application Action provider result status is invalid");
  }
  const artifactRefs = value.artifactRefs;
  if (!Array.isArray(artifactRefs) || artifactRefs.length > 16) {
    throw new TypeError("Application Action provider result artifact refs are outside bounds");
  }
  const refs = artifactRefs.map((rawRef) => {
    const ref = boundedText(rawRef, "Application Action provider artifact ref", 240);
    if (!ARTIFACT_REF_RE.test(ref)) {
      throw new TypeError("Application Action provider artifact ref must remain opaque");
    }
    return ref;
  });
  if (new Set(refs).size !== refs.length) {
    throw new TypeError("Application Action provider artifact refs must be unique");
  }
  const output = value.output === null
    ? null
    : validateOutputValue(value.output, "Application Action provider output");
  if (value.status !== "succeeded" && output !== null) {
    throw new TypeError("Failed Application Action provider result must not expose output");
  }
  const normalized = Object.freeze({
    schema: APPLICATION_ACTION_PROVIDER_RESULT_SCHEMA,
    status: value.status,
    summary: boundedText(
      value.summary,
      "Application Action provider result summary",
      1024,
    ),
    output,
    artifactRefs: Object.freeze(refs),
  });
  if (encoder.encode(JSON.stringify(normalized)).byteLength > MAX_OUTPUT_BYTES) {
    throw new TypeError("Application Action provider result exceeds byte budget");
  }
  return normalized;
}
