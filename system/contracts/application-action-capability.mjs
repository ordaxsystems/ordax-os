export const APPLICATION_ACTION_CAPABILITY_SCHEMA = "ordax.application-action-capability/1";
export const APPLICATION_ACTION_PROPOSAL_SCHEMA = "ordax.application-action-proposal/1";
export const APPLICATION_ACTION_CAPABILITY_REGISTRY_PORT_SCHEMA = "ordax.application-action-capability-registry/1";

const APP_ID_RE = /^[a-z][a-z0-9-]{0,127}$/;
const ACTION_ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const PROVIDER_ID_RE = /^[a-z][a-z0-9-]{0,127}$/;
const PARAMETER_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const URI_SCHEME_RE = /^[a-z][a-z0-9+.-]{0,31}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SOURCE_CLASSES = new Set(["first-party", "installed"]);
const PLATFORMS = new Set(["ordax", "windows"]);
const PROVIDER_KINDS = new Set(["first-party-native", "generic-lifecycle", "verified-integration"]);
const PARAMETER_TYPES = new Set(["string", "boolean", "integer", "number", "enum", "uri", "resource-grant-id"]);
const RISK_CLASSES = new Set(["read-only", "local-change", "external-effect", "privileged"]);
const CONFIRMATION_MODES = new Set(["none", "policy-gated", "always"]);
const FORBIDDEN_PARAMETER_IDS = new Set([
  "path", "raw-path", "host-path", "command", "shell", "executable", "executable-path",
  "wineprefix", "wine-prefix", "argv", "environment", "env", "working-directory",
]);
const CAPABILITY_FIELDS = new Set([
  "schema", "appId", "actionId", "title", "description", "sourceClass", "platform",
  "provider", "binding", "parameters", "riskClass", "confirmation",
  "executionAuthorized", "modelDirectExecutionAuthorized", "provenance",
]);
const PROVIDER_FIELDS = new Set(["kind", "adapterId", "revision"]);
const BINDING_FIELDS = new Set(["payloadSha256"]);
const PARAMETER_FIELDS = new Set(["id", "type", "required", "maxLength", "minimum", "maximum", "values", "schemes"]);
const PROPOSAL_FIELDS = new Set([
  "schema", "appId", "actionId", "arguments", "riskClass", "confirmation",
  "capabilitySha256", "capabilityProvenance", "executionAuthorized", "modelDirectExecutionAuthorized",
]);
const FORBIDDEN_AUTHORITY_METHODS = [
  "register", "mutate", "execute", "invoke", "run", "launch", "install", "uninstall",
  "shell", "spawn", "writeFile", "grant", "authorize", "confirm",
];

function exactFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`${label} contains incompatible fields: ${unknown.join(", ")}`);
}

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function boundedText(value, label, max, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function validateSchemes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new TypeError("Application action URI schemes are invalid");
  const schemes = value.map((scheme) => {
    if (typeof scheme !== "string" || !URI_SCHEME_RE.test(scheme)) throw new TypeError("Application action URI scheme is invalid");
    return scheme;
  });
  if (new Set(schemes).size !== schemes.length) throw new TypeError("Application action URI schemes must be unique");
  return Object.freeze(schemes);
}

function validateParameter(value) {
  objectValue(value, "Application action parameter");
  exactFields(value, PARAMETER_FIELDS, "Application action parameter");
  if (typeof value.id !== "string" || !PARAMETER_ID_RE.test(value.id) || FORBIDDEN_PARAMETER_IDS.has(value.id)) {
    throw new TypeError("Application action parameter id is invalid or exposes raw authority");
  }
  if (!PARAMETER_TYPES.has(value.type)) throw new TypeError("Application action parameter type is invalid");
  if (typeof value.required !== "boolean") throw new TypeError("Application action parameter required flag is invalid");

  let maxLength = null;
  let minimum = null;
  let maximum = null;
  let values = null;
  let schemes = null;
  if (value.type === "string") {
    maxLength = value.maxLength ?? 1024;
    if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 8192) throw new TypeError("Application action string maxLength is invalid");
    if (value.minimum != null || value.maximum != null || value.values != null || value.schemes != null) throw new TypeError("String application action parameter has incompatible constraints");
  } else if (value.type === "uri") {
    maxLength = value.maxLength ?? 2048;
    if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 8192) throw new TypeError("Application action URI maxLength is invalid");
    schemes = validateSchemes(value.schemes);
    if (value.minimum != null || value.maximum != null || value.values != null) throw new TypeError("URI application action parameter has incompatible constraints");
  } else if (value.type === "resource-grant-id") {
    maxLength = value.maxLength ?? 128;
    if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 128) throw new TypeError("Application action resource grant maxLength is invalid");
    if (value.minimum != null || value.maximum != null || value.values != null || value.schemes != null) throw new TypeError("Resource grant application action parameter has incompatible constraints");
  } else if (["integer", "number"].includes(value.type)) {
    minimum = value.minimum ?? null;
    maximum = value.maximum ?? null;
    if (minimum !== null && (typeof minimum !== "number" || !Number.isFinite(minimum))) throw new TypeError("Application action parameter minimum is invalid");
    if (maximum !== null && (typeof maximum !== "number" || !Number.isFinite(maximum))) throw new TypeError("Application action parameter maximum is invalid");
    if (minimum !== null && maximum !== null && minimum > maximum) throw new TypeError("Application action parameter numeric range is invalid");
    if (value.maxLength != null || value.values != null || value.schemes != null) throw new TypeError("Numeric application action parameter has incompatible constraints");
  } else if (value.type === "enum") {
    if (!Array.isArray(value.values) || value.values.length < 1 || value.values.length > 64) throw new TypeError("Application action enum values are invalid");
    values = Object.freeze(value.values.map((item) => boundedText(item, "Application action enum value", 160)));
    if (new Set(values).size !== values.length) throw new TypeError("Application action enum values must be unique");
    if (value.maxLength != null || value.minimum != null || value.maximum != null || value.schemes != null) throw new TypeError("Enum application action parameter has incompatible constraints");
  } else if (value.maxLength != null || value.minimum != null || value.maximum != null || value.values != null || value.schemes != null) {
    throw new TypeError("Boolean application action parameter has incompatible constraints");
  }

  return Object.freeze({ id: value.id, type: value.type, required: value.required, maxLength, minimum, maximum, values, schemes });
}

function validateRiskConfirmation(riskClass, confirmation, label) {
  if (!RISK_CLASSES.has(riskClass)) throw new TypeError(`${label} risk class is invalid`);
  if (!CONFIRMATION_MODES.has(confirmation)) throw new TypeError(`${label} confirmation mode is invalid`);
  if (riskClass === "privileged" && confirmation !== "always") throw new TypeError("Privileged application actions require confirmation");
  if (riskClass === "external-effect" && confirmation === "none") throw new TypeError("External-effect application actions require policy or confirmation");
}

export function validateApplicationActionCapability(value) {
  objectValue(value, "Application action capability");
  exactFields(value, CAPABILITY_FIELDS, "Application action capability");
  if (value.schema !== APPLICATION_ACTION_CAPABILITY_SCHEMA) throw new TypeError("Application action capability schema is incompatible");
  if (typeof value.appId !== "string" || !APP_ID_RE.test(value.appId)) throw new TypeError("Application action capability appId is invalid");
  if (typeof value.actionId !== "string" || value.actionId.length > 120 || !ACTION_ID_RE.test(value.actionId)) throw new TypeError("Application action capability actionId is invalid");
  if (!SOURCE_CLASSES.has(value.sourceClass) || !PLATFORMS.has(value.platform)) throw new TypeError("Application action capability source/platform is invalid");
  if ((value.sourceClass === "first-party" && value.platform !== "ordax") || (value.sourceClass === "installed" && value.platform !== "windows")) {
    throw new TypeError("Application action capability source/platform binding is inconsistent");
  }

  const provider = objectValue(value.provider, "Application action provider");
  exactFields(provider, PROVIDER_FIELDS, "Application action provider");
  if (!PROVIDER_KINDS.has(provider.kind)) throw new TypeError("Application action provider kind is invalid");
  if (typeof provider.adapterId !== "string" || !PROVIDER_ID_RE.test(provider.adapterId)) throw new TypeError("Application action provider adapterId is invalid");
  const revision = boundedText(provider.revision, "Application action provider revision", 160);
  if (provider.kind === "first-party-native" && value.sourceClass !== "first-party") throw new TypeError("Foreign application cannot claim first-party native action provider");
  if (provider.kind === "verified-integration" && value.sourceClass !== "installed") throw new TypeError("Verified foreign integration must bind an installed application");

  const binding = objectValue(value.binding, "Application action binding");
  exactFields(binding, BINDING_FIELDS, "Application action binding");
  const payloadSha256 = binding.payloadSha256 == null ? null : binding.payloadSha256;
  if (value.sourceClass === "installed" && (typeof payloadSha256 !== "string" || !SHA256_RE.test(payloadSha256))) {
    throw new TypeError("Installed application action capability requires exact payload binding");
  }
  if (value.sourceClass === "first-party" && payloadSha256 !== null) throw new TypeError("First-party action capability must not claim foreign payload binding");

  if (!Array.isArray(value.parameters) || value.parameters.length > 24) throw new TypeError("Application action parameters must be a bounded array");
  const parameters = Object.freeze(value.parameters.map(validateParameter));
  if (new Set(parameters.map((item) => item.id)).size !== parameters.length) throw new TypeError("Application action parameter ids must be unique");
  validateRiskConfirmation(value.riskClass, value.confirmation, "Application action capability");
  if (value.executionAuthorized !== false || value.modelDirectExecutionAuthorized !== false) {
    throw new TypeError("Application action capability foundation must remain non-executing");
  }

  return Object.freeze({
    schema: APPLICATION_ACTION_CAPABILITY_SCHEMA,
    appId: value.appId,
    actionId: value.actionId,
    title: boundedText(value.title, "Application action title", 160),
    description: boundedText(value.description, "Application action description", 800),
    sourceClass: value.sourceClass,
    platform: value.platform,
    provider: Object.freeze({ kind: provider.kind, adapterId: provider.adapterId, revision }),
    binding: Object.freeze({ payloadSha256 }),
    parameters,
    riskClass: value.riskClass,
    confirmation: value.confirmation,
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
    provenance: boundedText(value.provenance, "Application action provenance", 320),
  });
}

function validateProposalArgument(value, label) {
  if (typeof value === "string") return boundedText(value, label, 8192);
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new TypeError(`${label} must be a bounded scalar`);
}

export function validateApplicationActionProposal(value) {
  objectValue(value, "Application action proposal");
  exactFields(value, PROPOSAL_FIELDS, "Application action proposal");
  if (value.schema !== APPLICATION_ACTION_PROPOSAL_SCHEMA) throw new TypeError("Application action proposal schema is incompatible");
  if (typeof value.appId !== "string" || !APP_ID_RE.test(value.appId)) throw new TypeError("Application action proposal appId is invalid");
  if (typeof value.actionId !== "string" || !ACTION_ID_RE.test(value.actionId) || value.actionId.length > 120) throw new TypeError("Application action proposal actionId is invalid");
  const args = objectValue(value.arguments, "Application action proposal arguments");
  if (Object.keys(args).length > 24) throw new TypeError("Application action proposal arguments are outside bounds");
  const normalizedArguments = {};
  for (const [key, item] of Object.entries(args)) {
    if (!PARAMETER_ID_RE.test(key) || FORBIDDEN_PARAMETER_IDS.has(key)) throw new TypeError("Application action proposal argument id is invalid or exposes raw authority");
    normalizedArguments[key] = validateProposalArgument(item, `Application action proposal argument ${key}`);
  }
  validateRiskConfirmation(value.riskClass, value.confirmation, "Application action proposal");
  if (typeof value.capabilitySha256 !== "string" || !SHA256_RE.test(value.capabilitySha256)) throw new TypeError("Application action proposal capability digest is invalid");
  if (value.executionAuthorized !== false || value.modelDirectExecutionAuthorized !== false) throw new TypeError("Application action proposal cannot carry execution authority");
  return Object.freeze({
    schema: APPLICATION_ACTION_PROPOSAL_SCHEMA,
    appId: value.appId,
    actionId: value.actionId,
    arguments: Object.freeze(normalizedArguments),
    riskClass: value.riskClass,
    confirmation: value.confirmation,
    capabilitySha256: value.capabilitySha256,
    capabilityProvenance: boundedText(value.capabilityProvenance, "Application action proposal capability provenance", 320),
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
  });
}

export function assertApplicationActionCapabilityRegistryPort(port) {
  if (!port || typeof port !== "object" || port.schema !== APPLICATION_ACTION_CAPABILITY_REGISTRY_PORT_SCHEMA) {
    throw new TypeError("Compatible Application action capability registry is required");
  }
  for (const method of ["list", "get", "listForApp", "propose", "contextItem"]) {
    if (typeof port[method] !== "function") throw new TypeError(`Application action capability registry must implement ${method}()`);
  }
  for (const method of FORBIDDEN_AUTHORITY_METHODS) {
    if (typeof port[method] === "function") throw new TypeError(`Application action capability registry must not expose ${method}()`);
  }
  return port;
}
