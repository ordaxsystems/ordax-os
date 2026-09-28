export const INTELLIGENCE_TOOL_SCHEMA = "ordax.intelligence-tool/1";
export const INTELLIGENCE_TOOL_REGISTRY_SCHEMA = "ordax.intelligence-tool-registry/1";
export const INTELLIGENCE_CAPABILITY_BRIDGE_SCHEMA = "ordax.intelligence-capability-bridge/1";

const TOOL_ID_RE = /^[a-z][a-z0-9-]{0,79}$/;
const CAPABILITY_ID_RE = /^[a-z][a-z0-9.-]{0,127}$/;
const SCOPE_ID_RE = /^[a-z][a-z0-9.-]{0,63}$/;
const MAX_TOOLS = 32;
const MAX_SCOPES = 8;
const ALLOWED_DESCRIPTOR_KEYS = new Set([
  "schema",
  "id",
  "title",
  "description",
  "capabilityId",
  "inputScopes",
  "readOnly",
  "networkEgress",
  "mutatesState",
  "invocationEnabled",
  "authority",
]);

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function validateId(value, label, pattern, max) {
  const normalized = boundedText(value, label, max);
  if (!pattern.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function validateScopes(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SCOPES) {
    throw new TypeError("Intelligence tool input scopes must be a bounded non-empty array");
  }
  const scopes = value.map((scope) =>
    validateId(scope, "Intelligence tool input scope", SCOPE_ID_RE, 64));
  if (new Set(scopes).size !== scopes.length) {
    throw new TypeError("Intelligence tool input scopes must be unique");
  }
  return Object.freeze(scopes);
}

export function validateIntelligenceToolId(value) {
  return validateId(value, "Intelligence tool id", TOOL_ID_RE, 80);
}

export function validateIntelligenceToolDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence tool descriptor must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_DESCRIPTOR_KEYS.has(key)) {
      throw new TypeError(`Intelligence tool descriptor field ${key} is not allowed`);
    }
  }
  if (value.schema !== INTELLIGENCE_TOOL_SCHEMA) {
    throw new TypeError("Intelligence tool descriptor schema is invalid");
  }
  if (
    value.readOnly !== true
    || value.networkEgress !== false
    || value.mutatesState !== false
    || value.invocationEnabled !== false
    || value.authority !== "none"
  ) {
    throw new TypeError("Intelligence tool foundation must remain read-only, offline and non-invocable");
  }
  return Object.freeze({
    schema: INTELLIGENCE_TOOL_SCHEMA,
    id: validateIntelligenceToolId(value.id),
    title: boundedText(value.title, "Intelligence tool title", 120),
    description: boundedText(value.description, "Intelligence tool description", 512),
    capabilityId: validateId(
      value.capabilityId,
      "Intelligence tool capability id",
      CAPABILITY_ID_RE,
      128,
    ),
    inputScopes: validateScopes(value.inputScopes),
    readOnly: true,
    networkEgress: false,
    mutatesState: false,
    invocationEnabled: false,
    authority: "none",
  });
}

export function validateIntelligenceToolDescriptors(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TOOLS) {
    throw new TypeError("Intelligence tool descriptors must be a bounded non-empty array");
  }
  const tools = value.map(validateIntelligenceToolDescriptor);
  if (new Set(tools.map((tool) => tool.id)).size !== tools.length) {
    throw new TypeError("Intelligence tool ids must be unique");
  }
  return Object.freeze(tools);
}
