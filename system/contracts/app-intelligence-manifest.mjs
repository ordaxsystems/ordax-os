import {
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";

export const APP_INTELLIGENCE_MANIFEST_SCHEMA = "ordax.app-intelligence-manifest/1";
export const APP_INTELLIGENCE_EXECUTION_MODE = "declarative-only";

const EFFECTS = new Set(["none", "read", "write", "external-write", "destructive"]);
const CONFIRMATION_MODES = new Set(["none", "policy", "explicit"]);
const PARAMETER_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "string-list",
  "json",
]);
const INTENT_ID_RE = /^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63})+$/;
const PARAMETER_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function boundedUniqueTextArray(value, label, { maxItems, maxChars, allowEmpty = false }) {
  if (!Array.isArray(value) || value.length > maxItems || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const normalized = value.map((item, index) => boundedText(item, `${label}[${index}]`, maxChars));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${label} must not contain duplicates`);
  }
  return Object.freeze(normalized);
}

function validateParameter(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App intelligence parameter must be an object");
  }
  exactKeys(value, ["name", "type", "required", "description"], "App intelligence parameter");
  if (typeof value.name !== "string" || !PARAMETER_NAME_RE.test(value.name)) {
    throw new TypeError("App intelligence parameter name is invalid");
  }
  if (!PARAMETER_TYPES.has(value.type)) {
    throw new TypeError("App intelligence parameter type is invalid");
  }
  if (typeof value.required !== "boolean") {
    throw new TypeError("App intelligence parameter required flag must be boolean");
  }
  return Object.freeze({
    name: value.name,
    type: value.type,
    required: value.required,
    description: boundedText(value.description, "App intelligence parameter description", 320),
  });
}

function validateIntent(appId, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App intelligence intent must be an object");
  }
  exactKeys(
    value,
    ["id", "description", "effect", "confirmation", "parameters", "examples"],
    "App intelligence intent",
  );
  if (
    typeof value.id !== "string"
    || !INTENT_ID_RE.test(value.id)
    || !value.id.startsWith(`${appId}.`)
  ) {
    throw new TypeError("App intelligence intent id must be namespaced by appId");
  }
  if (!EFFECTS.has(value.effect)) {
    throw new TypeError("App intelligence intent effect is invalid");
  }
  if (!CONFIRMATION_MODES.has(value.confirmation)) {
    throw new TypeError("App intelligence intent confirmation mode is invalid");
  }
  if (["external-write", "destructive"].includes(value.effect) && value.confirmation === "none") {
    throw new TypeError("External or destructive intents require a confirmation policy");
  }
  if (!Array.isArray(value.parameters) || value.parameters.length > 32) {
    throw new TypeError("App intelligence intent parameters must be a bounded array");
  }
  const parameters = value.parameters.map(validateParameter);
  if (new Set(parameters.map((item) => item.name)).size !== parameters.length) {
    throw new TypeError("App intelligence intent parameter names must be unique");
  }
  const examples = boundedUniqueTextArray(value.examples, "App intelligence intent examples", {
    maxItems: 8,
    maxChars: 320,
    allowEmpty: true,
  });
  return Object.freeze({
    id: value.id,
    description: boundedText(value.description, "App intelligence intent description", 640),
    effect: value.effect,
    confirmation: value.confirmation,
    parameters: Object.freeze(parameters),
    examples,
  });
}

export function validateAppIntelligenceManifest(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App intelligence manifest must be an object");
  }
  exactKeys(
    value,
    ["schema", "appId", "appVersion", "authority", "execution", "instructions", "intents"],
    "App intelligence manifest",
  );
  if (value.schema !== APP_INTELLIGENCE_MANIFEST_SCHEMA) {
    throw new TypeError("Unsupported app intelligence manifest schema");
  }
  const appId = validateComponentId(value.appId);
  const appVersion = validateComponentVersion(value.appVersion);
  if (expected.appId && appId !== expected.appId) {
    throw new TypeError(`App intelligence appId mismatch: expected ${expected.appId}`);
  }
  if (expected.appVersion && appVersion !== expected.appVersion) {
    throw new TypeError(`App intelligence appVersion mismatch: expected ${expected.appVersion}`);
  }
  if (value.authority !== "none") {
    throw new TypeError("App intelligence manifest must not carry authority");
  }
  if (value.execution !== APP_INTELLIGENCE_EXECUTION_MODE) {
    throw new TypeError("App intelligence manifest cannot grant execution");
  }
  const instructions = boundedUniqueTextArray(value.instructions, "App intelligence instructions", {
    maxItems: 32,
    maxChars: 640,
  });
  if (!Array.isArray(value.intents) || value.intents.length > 64) {
    throw new TypeError("App intelligence intents must be a bounded array");
  }
  const intents = value.intents.map((intent) => validateIntent(appId, intent));
  if (new Set(intents.map((intent) => intent.id)).size !== intents.length) {
    throw new TypeError("App intelligence intent ids must be unique");
  }
  return Object.freeze({
    schema: APP_INTELLIGENCE_MANIFEST_SCHEMA,
    appId,
    appVersion,
    authority: "none",
    execution: APP_INTELLIGENCE_EXECUTION_MODE,
    instructions,
    intents: Object.freeze(intents),
  });
}
