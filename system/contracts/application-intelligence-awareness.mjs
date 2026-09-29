export const APPLICATION_INTELLIGENCE_AWARENESS_SCHEMA = "ordax.application-intelligence-awareness/1";
export const APPLICATION_INTELLIGENCE_AWARENESS_PORT_SCHEMA = "ordax.application-intelligence-awareness-port/1";

const ID_RE = /^[a-z][a-z0-9-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SOURCE_CLASSES = new Set(["first-party", "installed"]);
const PLATFORMS = new Set(["ordax", "windows"]);
const DESCRIPTOR_FIELDS = new Set([
  "schema",
  "appId",
  "title",
  "sourceClass",
  "platform",
  "publisher",
  "payloadSha256",
  "compatibilityManaged",
  "nativeTrust",
  "knownActionIds",
  "actionExecutionAuthorized",
  "modelToolExecutionAuthorized",
  "provenance",
]);
const ACTION_ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const FORBIDDEN_AUTHORITY_METHODS = [
  "execute",
  "invoke",
  "run",
  "launch",
  "install",
  "uninstall",
  "shell",
  "spawn",
  "writeFile",
];

function exactFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`${label} contains incompatible fields: ${unknown.join(", ")}`);
  }
}

function boundedText(value, label, max, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return null;
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

function validateActionIds(value) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new TypeError("Application Intelligence knownActionIds must be a bounded array");
  }
  const values = value.map((item) => {
    if (typeof item !== "string" || !ACTION_ID_RE.test(item) || item.length > 120) {
      throw new TypeError("Application Intelligence action id is invalid");
    }
    return item;
  });
  if (new Set(values).size !== values.length) {
    throw new TypeError("Application Intelligence action ids must be unique");
  }
  return Object.freeze(values);
}

export function validateApplicationIntelligenceAwareness(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Application Intelligence awareness descriptor must be an object");
  }
  exactFields(value, DESCRIPTOR_FIELDS, "Application Intelligence awareness descriptor");
  if (value.schema !== APPLICATION_INTELLIGENCE_AWARENESS_SCHEMA) {
    throw new TypeError("Application Intelligence awareness schema is incompatible");
  }
  if (typeof value.appId !== "string" || !ID_RE.test(value.appId)) {
    throw new TypeError("Application Intelligence appId is invalid");
  }
  if (!SOURCE_CLASSES.has(value.sourceClass) || !PLATFORMS.has(value.platform)) {
    throw new TypeError("Application Intelligence source/platform is invalid");
  }
  if (
    (value.sourceClass === "first-party" && value.platform !== "ordax")
    || (value.sourceClass === "installed" && value.platform !== "windows")
  ) {
    throw new TypeError("Application Intelligence source/platform binding is inconsistent");
  }

  const title = boundedText(value.title, "Application Intelligence title", 160);
  const publisher = boundedText(
    value.publisher,
    "Application Intelligence publisher",
    240,
    { optional: true },
  );
  const payloadSha256 = value.payloadSha256 == null ? null : value.payloadSha256;
  if (payloadSha256 !== null && (typeof payloadSha256 !== "string" || !SHA256_RE.test(payloadSha256))) {
    throw new TypeError("Application Intelligence payloadSha256 is invalid");
  }
  if (value.sourceClass === "installed" && payloadSha256 === null) {
    throw new TypeError("Installed Application Intelligence awareness requires payload binding");
  }
  if (value.sourceClass === "first-party" && payloadSha256 !== null) {
    throw new TypeError("First-party Application Intelligence awareness must not claim installed payload binding");
  }

  const compatibilityManaged = value.compatibilityManaged === true;
  const nativeTrust = value.nativeTrust === true;
  if (value.sourceClass === "installed" && (!compatibilityManaged || nativeTrust)) {
    throw new TypeError("Installed Windows awareness cannot gain native trust");
  }
  if (value.sourceClass === "first-party" && (compatibilityManaged || !nativeTrust)) {
    throw new TypeError("First-party awareness trust binding is invalid");
  }
  if (value.actionExecutionAuthorized !== false || value.modelToolExecutionAuthorized !== false) {
    throw new TypeError("Application Intelligence awareness must remain non-executing");
  }

  return Object.freeze({
    schema: APPLICATION_INTELLIGENCE_AWARENESS_SCHEMA,
    appId: value.appId,
    title,
    sourceClass: value.sourceClass,
    platform: value.platform,
    publisher,
    payloadSha256,
    compatibilityManaged,
    nativeTrust,
    knownActionIds: validateActionIds(value.knownActionIds ?? []),
    actionExecutionAuthorized: false,
    modelToolExecutionAuthorized: false,
    provenance: boundedText(value.provenance, "Application Intelligence provenance", 240),
  });
}

export function assertApplicationIntelligenceAwarenessPort(port) {
  if (!port || typeof port !== "object" || port.schema !== APPLICATION_INTELLIGENCE_AWARENESS_PORT_SCHEMA) {
    throw new TypeError("Compatible Application Intelligence awareness port is required");
  }
  for (const method of ["list", "get", "resolveExact", "contextItem"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Application Intelligence awareness port must implement ${method}()`);
    }
  }
  for (const method of FORBIDDEN_AUTHORITY_METHODS) {
    if (typeof port[method] === "function") {
      throw new TypeError(`Application Intelligence awareness port must not expose ${method}()`);
    }
  }
  return port;
}
