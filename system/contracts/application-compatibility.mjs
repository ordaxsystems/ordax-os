export const APPLICATION_COMPATIBILITY_SCHEMA = "ordax.application-compatibility/2";
export const APPLICATION_COMPATIBILITY_RUNTIME_SCHEMA = "ordax.application-compatibility-runtime/1";
export const APPLICATION_COMPATIBILITY_INSPECTION_SCHEMA = "ordax.application-compatibility-inspection/1";
export const APPLICATION_COMPATIBILITY_PLAN_SCHEMA = "ordax.application-compatibility-plan/1";

const ID_RE = /^[a-z][a-z0-9._-]{0,95}$/;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const FAMILIES = new Set(["windows", "linux"]);
const ENGINES = new Set(["wine", "proton", "native-linux", "other"]);
const ENGINE_FAMILIES = Object.freeze({
  wine: "windows",
  proton: "windows",
  "native-linux": "linux",
});
const ARCHITECTURES = new Set(["x86", "x86_64", "aarch64", "unknown"]);
const RUNTIME_ARCHITECTURES = new Set([...ARCHITECTURES].filter((architecture) => architecture !== "unknown"));
const KINDS = new Set(["windows-pe", "windows-msi", "linux-elf", "linux-appimage", "unknown"]);
const ROLES = new Set(["executable", "installer", "library", "unknown"]);
const RUNTIME_KEYS = Object.freeze([
  "id",
  "family",
  "engine",
  "version",
  "architectures",
  "source",
  "available",
  "executionEnabled",
  "sandboxed",
]);
const SOURCE_KEYS = Object.freeze(["identity", "digest"]);

function text(value, label, max = 240) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function id(value, label) {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

function stringArray(value, label, allowed, maxItems = 16) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new TypeError(`${label} must be a non-empty bounded array`);
  }
  const result = value.map((item) => {
    if (typeof item !== "string" || !allowed.has(item)) {
      throw new TypeError(`${label} contains an unsupported value`);
    }
    return item;
  });
  if (new Set(result).size !== result.length) {
    throw new TypeError(`${label} must be unique`);
  }
  return Object.freeze(result);
}

export function defineApplicationCompatibilityRuntime(spec) {
  exactKeys(spec, RUNTIME_KEYS, "Application compatibility runtime");
  exactKeys(spec.source, SOURCE_KEYS, "Application compatibility runtime source");
  if (!FAMILIES.has(spec.family)) throw new TypeError("Application compatibility runtime family is unsupported");
  if (!ENGINES.has(spec.engine)) throw new TypeError("Application compatibility runtime engine is unsupported");
  if (Object.hasOwn(ENGINE_FAMILIES, spec.engine) && ENGINE_FAMILIES[spec.engine] !== spec.family) {
    throw new TypeError("Application compatibility runtime engine and family are incompatible");
  }
  if (typeof spec.version !== "string" || !SEMVER_RE.test(spec.version)) {
    throw new TypeError("Application compatibility runtime version must be semantic version");
  }
  if (spec.available !== true) {
    throw new TypeError("Runtime descriptors may only represent a real available runtime");
  }
  if (spec.executionEnabled !== true) {
    throw new TypeError("Application compatibility runtime must declare executionEnabled=true");
  }
  if (spec.sandboxed !== true) {
    throw new TypeError("Application compatibility runtime must declare sandboxed=true");
  }
  const digest = text(spec.source.digest, "runtime source digest", 80);
  if (!DIGEST_RE.test(digest)) {
    throw new TypeError("Application compatibility runtime source digest must be sha256:<lowercase-hex>");
  }
  return Object.freeze({
    schema: APPLICATION_COMPATIBILITY_RUNTIME_SCHEMA,
    id: id(spec.id, "runtime id"),
    family: spec.family,
    engine: spec.engine,
    version: spec.version,
    architectures: stringArray(spec.architectures, "runtime architectures", RUNTIME_ARCHITECTURES),
    source: Object.freeze({
      identity: text(spec.source.identity, "runtime source identity", 256),
      digest,
    }),
    available: true,
    executionEnabled: true,
    sandboxed: true,
  });
}

export function validateApplicationCompatibilityInspection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Application compatibility inspection must be an object");
  }
  if (!KINDS.has(value.kind)) throw new TypeError("Application compatibility inspection kind is unsupported");
  if (!ROLES.has(value.role)) throw new TypeError("Application compatibility inspection role is unsupported");
  if (!ARCHITECTURES.has(value.architecture)) {
    throw new TypeError("Application compatibility inspection architecture is unsupported");
  }
  const family = value.family === null ? null : value.family;
  if (family !== null && !FAMILIES.has(family)) {
    throw new TypeError("Application compatibility inspection family is unsupported");
  }
  if (typeof value.launchable !== "boolean") {
    throw new TypeError("Application compatibility inspection launchable flag is required");
  }
  const evidence = Array.isArray(value.evidence)
    ? value.evidence.map((item) => text(item, "inspection evidence", 160))
    : [];
  if (evidence.length > 16) throw new TypeError("Application compatibility inspection evidence is too large");
  return Object.freeze({
    schema: APPLICATION_COMPATIBILITY_INSPECTION_SCHEMA,
    name: text(value.name, "payload name", 255),
    family,
    kind: value.kind,
    role: value.role,
    architecture: value.architecture,
    launchable: value.launchable,
    evidence: Object.freeze(evidence),
  });
}

export function validateApplicationCompatibilityPlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Application compatibility plan must be an object");
  }
  if (typeof value.ready !== "boolean") throw new TypeError("Application compatibility plan ready flag is required");
  return Object.freeze({
    schema: APPLICATION_COMPATIBILITY_PLAN_SCHEMA,
    ready: value.ready,
    runtimeId: value.runtimeId === null ? null : id(value.runtimeId, "runtime id"),
    reason: text(value.reason, "application compatibility plan reason", 240),
  });
}

export function assertApplicationCompatibilityPort(port) {
  if (!port || typeof port !== "object" || port.schema !== APPLICATION_COMPATIBILITY_SCHEMA) {
    throw new TypeError("A compatible application-compatibility port is required");
  }
  for (const method of ["inspect", "inspectVerified", "assertInspectionDigest", "listRuntimes", "planLaunch"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Application-compatibility port must implement ${method}()`);
    }
  }
  for (const forbidden of ["execute", "install", "shell", "spawn", "writeFile"]) {
    if (forbidden in port) {
      throw new TypeError("Application-compatibility inspection port must not expose mutation/execution authority");
    }
  }
  return port;
}
