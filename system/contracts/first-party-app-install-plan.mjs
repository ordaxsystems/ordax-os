export const FIRST_PARTY_APP_INSTALL_PLAN_SCHEMA = "ordax.first-party-app-install-plan/1";
export const FIRST_PARTY_APP_INSTALL_PLANNER_SCHEMA = "ordax.first-party-app-install-planner/1";

const APP_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const REPOSITORY_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const RUNTIME_COMPONENT_RELEASE_SCHEMA = "prototype-ordax.runtime-component-release/2";
const BLOCKED_REASONS = new Set([
  "already-installed",
  "artifact-unavailable",
  "artifact-unverified",
  "incompatible-artifact",
  "lifecycle-busy",
  "not-catalogued",
  "platform-blocked",
  "policy-not-installable",
  "production-activation-blocked",
]);

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

function appId(value) {
  if (typeof value !== "string" || !APP_ID_RE.test(value)) {
    throw new TypeError("First-party app install plan appId is invalid");
  }
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new TypeError(`First-party app install artifact ${label} is invalid`);
  }
  return value;
}

function requireSourceRepository(value) {
  if (typeof value !== "string" || value.length > 201) {
    throw new TypeError("First-party app install artifact source repository is invalid");
  }
  const segments = value.split("/");
  if (
    segments.length !== 2
    || segments.some((segment) => !REPOSITORY_SEGMENT_RE.test(segment))
  ) {
    throw new TypeError("First-party app install artifact source repository is invalid");
  }
  return value;
}

export function defineFirstPartyAppInstallArtifact(value) {
  exactKeys(
    value,
    [
      "appId",
      "version",
      "releaseSchema",
      "releaseMode",
      "sourceRepository",
      "sourceCommit",
      "releaseEnvelopeSha256",
      "packageSha256",
      "compatibilitySha256",
      "verified",
      "compatible",
    ],
    "First-party app install artifact",
  );
  const id = appId(value.appId);
  if (typeof value.version !== "string" || !SEMVER_RE.test(value.version)) {
    throw new TypeError("First-party app install artifact version is invalid");
  }
  if (value.releaseSchema !== RUNTIME_COMPONENT_RELEASE_SCHEMA) {
    throw new TypeError("First-party app install artifact release schema is unsupported");
  }
  if (value.releaseMode !== "component-slot") {
    throw new TypeError("First-party app install artifact release mode must be component-slot");
  }
  const sourceRepository = requireSourceRepository(value.sourceRepository);
  if (typeof value.sourceCommit !== "string" || !COMMIT_RE.test(value.sourceCommit)) {
    throw new TypeError("First-party app install artifact source commit is invalid");
  }
  const releaseEnvelopeSha256 = requireSha256(value.releaseEnvelopeSha256, "release envelope sha256");
  const packageSha256 = requireSha256(value.packageSha256, "package sha256");
  const compatibilitySha256 = requireSha256(value.compatibilitySha256, "compatibility sha256");
  if (typeof value.verified !== "boolean" || typeof value.compatible !== "boolean") {
    throw new TypeError("First-party app install artifact verified/compatible flags must be boolean");
  }
  return Object.freeze({
    appId: id,
    version: value.version,
    releaseSchema: value.releaseSchema,
    releaseMode: value.releaseMode,
    sourceRepository,
    sourceCommit: value.sourceCommit,
    releaseEnvelopeSha256,
    packageSha256,
    compatibilitySha256,
    verified: value.verified,
    compatible: value.compatible,
  });
}

export function validateFirstPartyAppInstallPlan(value) {
  exactKeys(
    value,
    ["schema", "appId", "ready", "reason", "artifact", "authority"],
    "First-party app install plan",
  );
  if (value.schema !== FIRST_PARTY_APP_INSTALL_PLAN_SCHEMA) {
    throw new TypeError("Unsupported first-party app install plan schema");
  }
  const id = appId(value.appId);
  if (typeof value.ready !== "boolean") {
    throw new TypeError("First-party app install plan ready must be boolean");
  }
  if (value.authority !== "none") {
    throw new TypeError("First-party app install plan must remain authority:none");
  }

  if (value.ready) {
    if (value.reason !== "install-plan-ready") {
      throw new TypeError("Ready first-party app install plan reason is invalid");
    }
    const artifact = defineFirstPartyAppInstallArtifact(value.artifact);
    if (artifact.appId !== id || !artifact.verified || !artifact.compatible) {
      throw new TypeError("Ready first-party app install plan requires exact verified compatible artifact");
    }
    return Object.freeze({
      schema: FIRST_PARTY_APP_INSTALL_PLAN_SCHEMA,
      appId: id,
      ready: true,
      reason: "install-plan-ready",
      artifact,
      authority: "none",
    });
  }

  if (!BLOCKED_REASONS.has(value.reason)) {
    throw new TypeError("Blocked first-party app install plan reason is invalid");
  }
  if (value.artifact !== null) {
    throw new TypeError("Blocked first-party app install plan must not contain an artifact");
  }
  return Object.freeze({
    schema: FIRST_PARTY_APP_INSTALL_PLAN_SCHEMA,
    appId: id,
    ready: false,
    reason: value.reason,
    artifact: null,
    authority: "none",
  });
}

export function assertFirstPartyAppInstallPlanner(port) {
  if (!port || typeof port !== "object" || port.schema !== FIRST_PARTY_APP_INSTALL_PLANNER_SCHEMA) {
    throw new TypeError("A compatible first-party app install planner is required");
  }
  if (typeof port.planInstall !== "function") {
    throw new TypeError("First-party app install planner must implement planInstall()");
  }
  for (const forbidden of [
    "fetch",
    "install",
    "stage",
    "promote",
    "rollback",
    "uninstall",
    "sign",
    "execute",
    "writeFile",
  ]) {
    if (forbidden in port) {
      throw new TypeError("First-party app install planner must not expose mutation or execution authority");
    }
  }
  return port;
}
