import {
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";

export const VERIFIED_APP_PUBLICATION_CATALOG_SCHEMA =
  "ordax.verified-app-publication-catalog/1";
export const VERIFIED_APP_PUBLICATION_SCHEMA =
  "ordax.verified-app-publication/1";

const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMPATIBILITY_STATES = new Set(["compatible", "blocked"]);
const FORBIDDEN_AUTHORITY_METHODS = Object.freeze([
  "install",
  "uninstall",
  "publish",
  "stage",
  "promote",
  "rollback",
  "execute",
  "invoke",
]);

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

function boundedText(value, label, max = 240) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > max
    || value !== value.trim()
    || value.includes("\0")
  ) {
    throw new TypeError(`${label} must be bounded text`);
  }
  return value;
}

function sha256(value, label) {
  const result = boundedText(value, label, 64);
  if (!SHA256_RE.test(result)) throw new TypeError(`${label} is invalid`);
  return result;
}

function nullableReason(value, label) {
  if (value === null) return null;
  return boundedText(value, label, 160);
}

export function validateVerifiedAppPublication(value) {
  exactKeys(
    value,
    [
      "schema",
      "appId",
      "componentId",
      "title",
      "version",
      "sourceRepository",
      "sourceCommit",
      "packageSha256",
      "releaseSha256",
      "envelopeSha256",
      "trustDomain",
      "keyId",
      "compatibilityState",
      "compatibilityReason",
      "publishedAt",
      "authority",
    ],
    "Verified app publication",
  );
  if (value.schema !== VERIFIED_APP_PUBLICATION_SCHEMA) {
    throw new TypeError("Unsupported verified app publication schema");
  }
  const appId = validateComponentId(value.appId);
  const componentId = validateComponentId(value.componentId);
  if (componentId !== appId) {
    throw new TypeError("Verified app publication component identity must match app identity");
  }
  const sourceRepository = boundedText(value.sourceRepository, "source repository", 200);
  if (!REPOSITORY_RE.test(sourceRepository)) {
    throw new TypeError("Verified app publication source repository is invalid");
  }
  const sourceCommit = boundedText(value.sourceCommit, "source commit", 40);
  if (!COMMIT_RE.test(sourceCommit)) {
    throw new TypeError("Verified app publication source commit is invalid");
  }
  if (value.trustDomain !== "runtime-components") {
    throw new TypeError("Verified app publication must use runtime-components trust");
  }
  const compatibilityState = boundedText(
    value.compatibilityState,
    "compatibility state",
    32,
  );
  if (!COMPATIBILITY_STATES.has(compatibilityState)) {
    throw new TypeError("Verified app publication compatibility state is invalid");
  }
  const compatibilityReason = nullableReason(
    value.compatibilityReason,
    "compatibility reason",
  );
  if (compatibilityState === "compatible" && compatibilityReason !== null) {
    throw new TypeError("Compatible publication cannot carry a compatibility reason");
  }
  if (compatibilityState === "blocked" && compatibilityReason === null) {
    throw new TypeError("Blocked publication requires a compatibility reason");
  }
  if (!Number.isSafeInteger(value.publishedAt) || value.publishedAt < 0) {
    throw new TypeError("Verified app publication publishedAt is invalid");
  }
  if (value.authority !== "none") {
    throw new TypeError("Verified app publication must remain authority:none");
  }

  return Object.freeze({
    schema: VERIFIED_APP_PUBLICATION_SCHEMA,
    appId,
    componentId,
    title: boundedText(value.title, "publication title", 160),
    version: validateComponentVersion(value.version),
    sourceRepository,
    sourceCommit,
    packageSha256: sha256(value.packageSha256, "package sha256"),
    releaseSha256: sha256(value.releaseSha256, "release sha256"),
    envelopeSha256: sha256(value.envelopeSha256, "envelope sha256"),
    trustDomain: "runtime-components",
    keyId: boundedText(value.keyId, "trust key id", 160),
    compatibilityState,
    compatibilityReason,
    publishedAt: value.publishedAt,
    authority: "none",
  });
}

export function validateVerifiedAppPublicationCatalogSnapshot(value) {
  exactKeys(
    value,
    ["schema", "state", "entries", "reason", "authority"],
    "Verified app publication catalog",
  );
  if (value.schema !== VERIFIED_APP_PUBLICATION_CATALOG_SCHEMA) {
    throw new TypeError("Unsupported verified app publication catalog schema");
  }
  if (!["unavailable", "ready"].includes(value.state)) {
    throw new TypeError("Verified app publication catalog state is invalid");
  }
  if (!Array.isArray(value.entries) || value.entries.length > 256) {
    throw new TypeError("Verified app publication catalog entries must be a bounded array");
  }
  const entries = Object.freeze(value.entries.map(validateVerifiedAppPublication));
  const identities = entries.map((entry) => entry.appId);
  if (new Set(identities).size !== identities.length) {
    throw new TypeError("Verified app publication catalog app ids must be unique");
  }
  const reason = nullableReason(value.reason, "catalog unavailable reason");
  if (value.state === "unavailable") {
    if (entries.length !== 0 || reason === null) {
      throw new TypeError("Unavailable verified catalog must be empty and explain why");
    }
  } else if (reason !== null) {
    throw new TypeError("Ready verified catalog cannot carry unavailable reason");
  }
  if (value.authority !== "none") {
    throw new TypeError("Verified app publication catalog must remain authority:none");
  }
  return Object.freeze({
    schema: VERIFIED_APP_PUBLICATION_CATALOG_SCHEMA,
    state: value.state,
    entries,
    reason,
    authority: "none",
  });
}

export function assertVerifiedAppPublicationCatalogPort(port) {
  if (
    !port
    || typeof port !== "object"
    || port.schema !== VERIFIED_APP_PUBLICATION_CATALOG_SCHEMA
    || port.authority !== "none"
    || typeof port.getSnapshot !== "function"
    || typeof port.subscribe !== "function"
  ) {
    throw new TypeError("A compatible verified app publication catalog port is required");
  }
  for (const method of FORBIDDEN_AUTHORITY_METHODS) {
    if (typeof port[method] === "function") {
      throw new TypeError(
        `Verified app publication catalog must not expose authority method ${method}()`,
      );
    }
  }
  validateVerifiedAppPublicationCatalogSnapshot(port.getSnapshot());
  return port;
}
