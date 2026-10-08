export const APPLICATION_COMPATIBILITY_PROFILE_SCHEMA =
  "ordax.application-compatibility-profile/1";
export const APPLICATION_COMPATIBILITY_PROFILE_PLAN_SCHEMA =
  "ordax.application-compatibility-profile-plan/1";
export const APPLICATION_COMPATIBILITY_PROFILE_PLANNER_SCHEMA =
  "ordax.application-compatibility-profile-planner/1";

const ID_RE = /^[a-z][a-z0-9._-]{0,95}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const FAMILIES = new Set(["windows", "linux"]);
const ARCHITECTURES = new Set(["x86", "x86_64", "aarch64"]);
const PROFILE_KEYS = Object.freeze([
  "id",
  "family",
  "runtimeId",
  "architecture",
  "payload",
  "storageKey",
  "persistence",
  "hostAuthority",
]);
const PAYLOAD_KEYS = Object.freeze(["name", "digest"]);
// In-process profile-plan validation must not accept a caller-supplied schema-shaped clone.
// This verifies issuance by the structural profile constructor, NOT payload/runtime attestation.
const issuedProfiles = new WeakSet();

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

function id(value, label) {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function text(value, label, max = 255) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function storageKey(value) {
  const normalized = text(value, "compatibility profile storage key", 320);
  if (
    normalized.startsWith("/")
    || normalized.startsWith("\\")
    || normalized.includes("\\")
    || normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new TypeError("compatibility profile storage key must be a safe relative POSIX key");
  }
  return normalized;
}

export function defineApplicationCompatibilityProfile(spec) {
  exactKeys(spec, PROFILE_KEYS, "Application compatibility profile");
  exactKeys(spec.payload, PAYLOAD_KEYS, "Application compatibility profile payload");
  if (!FAMILIES.has(spec.family)) {
    throw new TypeError("Application compatibility profile family is unsupported");
  }
  if (!ARCHITECTURES.has(spec.architecture)) {
    throw new TypeError("Application compatibility profile architecture is unsupported");
  }
  if (spec.persistence !== "durable-user") {
    throw new TypeError("Application compatibility profile persistence must remain durable-user");
  }
  if (spec.hostAuthority !== "none") {
    throw new TypeError("Application compatibility profile must not grant host authority");
  }
  const digest = text(spec.payload.digest, "compatibility profile payload digest", 80);
  if (!DIGEST_RE.test(digest)) {
    throw new TypeError("Application compatibility profile payload digest must be sha256:<lowercase-hex>");
  }
  const profile = Object.freeze({
    schema: APPLICATION_COMPATIBILITY_PROFILE_SCHEMA,
    id: id(spec.id, "compatibility profile id"),
    family: spec.family,
    runtimeId: id(spec.runtimeId, "compatibility runtime id"),
    architecture: spec.architecture,
    payload: Object.freeze({
      name: text(spec.payload.name, "compatibility profile payload name"),
      digest,
    }),
    storageKey: storageKey(spec.storageKey),
    persistence: "durable-user",
    hostAuthority: "none",
  });
  issuedProfiles.add(profile);
  return profile;
}

export function validateApplicationCompatibilityProfilePlan(value) {
  exactKeys(value, ["ready", "reason", "profile"], "Application compatibility profile plan");
  if (typeof value.ready !== "boolean") {
    throw new TypeError("Application compatibility profile plan ready flag is required");
  }
  const reason = text(value.reason, "compatibility profile plan reason", 240);
  if (value.ready) {
    if (
      !value.profile
      || typeof value.profile !== "object"
      || value.profile.schema !== APPLICATION_COMPATIBILITY_PROFILE_SCHEMA
      || !issuedProfiles.has(value.profile)
    ) {
      throw new TypeError("Ready compatibility profile plan requires a canonically issued profile");
    }
    return Object.freeze({
      schema: APPLICATION_COMPATIBILITY_PROFILE_PLAN_SCHEMA,
      ready: true,
      reason,
      profile: value.profile,
    });
  }
  if (value.profile !== null) {
    throw new TypeError("Blocked compatibility profile plan must not contain a profile");
  }
  return Object.freeze({
    schema: APPLICATION_COMPATIBILITY_PROFILE_PLAN_SCHEMA,
    ready: false,
    reason,
    profile: null,
  });
}

export function assertApplicationCompatibilityProfilePlanner(port) {
  if (!port || typeof port !== "object" || port.schema !== APPLICATION_COMPATIBILITY_PROFILE_PLANNER_SCHEMA) {
    throw new TypeError("A compatible application-compatibility profile planner is required");
  }
  if (typeof port.planCreate !== "function") {
    throw new TypeError("Application-compatibility profile planner must implement planCreate()");
  }
  for (const forbidden of ["create", "delete", "execute", "install", "spawn", "writeFile"] ) {
    if (forbidden in port) {
      throw new TypeError("Application-compatibility profile planner must not expose mutation/execution authority");
    }
  }
  return port;
}
