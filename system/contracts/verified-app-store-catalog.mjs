import {
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";

export const VERIFIED_APP_STORE_CATALOG_SCHEMA = "ordax.verified-app-store-catalog/1";
export const VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA = "ordax.verified-app-store-catalog-port/1";

export const APP_STORE_CATALOG_SOURCE_REPOSITORY = "washingtonmsdj/ordax-apps";
export const APP_STORE_CATALOG_TRUST_DOMAIN = "runtime-components";
export const APP_STORE_CATALOG_KEY_ID = "ordax-runtime-components-v1";

const SHA256_RE = /^[0-9a-f]{64}$/;
const SOURCE_COMMIT_RE = /^[0-9a-f]{40}$/;
const ARTIFACT_NAME_RE = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_ENTRIES = 128;
const MAX_TITLE_LENGTH = 160;
const MAX_REASON_LENGTH = 256;

const SNAPSHOT_FIELDS = new Set([
  "schema",
  "state",
  "sequence",
  "catalogSha256",
  "source",
  "trust",
  "entries",
  "reason",
  "authority",
]);
const ENTRY_FIELDS = new Set([
  "appId",
  "title",
  "version",
  "releaseMode",
  "sourceCommit",
  "artifacts",
]);
const ARTIFACT_GROUP_FIELDS = new Set(["package", "release", "compatibility"]);
const ARTIFACT_FIELDS = new Set(["name", "sha256", "size"]);
const SOURCE_FIELDS = new Set(["repository", "commit"]);
const TRUST_FIELDS = new Set(["domain", "keyId"]);
const FORBIDDEN_AUTHORITY_METHODS = [
  "install",
  "update",
  "remove",
  "uninstall",
  "stage",
  "promote",
  "rollback",
  "execute",
  "invoke",
  "run",
  "writeFile",
  "grant",
  "authorize",
];

function assertExactFields(value, fields, label) {
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !fields.has(key));
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key));
  if (unknown.length || missing.length) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

function plainObject(value, label) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function boundedText(value, label, max) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > max
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new TypeError(`${label} must be lowercase SHA-256`);
  }
  return value;
}

function sourceCommit(value) {
  if (typeof value !== "string" || !SOURCE_COMMIT_RE.test(value)) {
    throw new TypeError("Verified Store catalog source commit must be lowercase 40-hex");
  }
  return value;
}

function artifact(value, label) {
  plainObject(value, label);
  assertExactFields(value, ARTIFACT_FIELDS, label);
  if (typeof value.name !== "string" || !ARTIFACT_NAME_RE.test(value.name)) {
    throw new TypeError(`${label} name is invalid`);
  }
  if (!Number.isSafeInteger(value.size) || value.size <= 0) {
    throw new TypeError(`${label} size is invalid`);
  }
  return Object.freeze({
    name: value.name,
    sha256: sha256(value.sha256, `${label} sha256`),
    size: value.size,
  });
}

function entry(value, expectedSourceCommit) {
  plainObject(value, "Verified Store catalog entry");
  assertExactFields(value, ENTRY_FIELDS, "Verified Store catalog entry");
  const appId = validateComponentId(value.appId);
  const commit = sourceCommit(value.sourceCommit);
  if (commit !== expectedSourceCommit) {
    throw new TypeError(`Verified Store catalog entry source commit mismatch: ${appId}`);
  }
  if (value.releaseMode !== "component-slot") {
    throw new TypeError("Verified Store catalog entries must use component-slot");
  }
  const artifacts = plainObject(value.artifacts, "Verified Store catalog artifacts");
  assertExactFields(
    artifacts,
    ARTIFACT_GROUP_FIELDS,
    "Verified Store catalog artifacts",
  );
  return Object.freeze({
    appId,
    title: boundedText(value.title, "Verified Store catalog title", MAX_TITLE_LENGTH),
    version: validateComponentVersion(value.version),
    releaseMode: "component-slot",
    sourceCommit: commit,
    artifacts: Object.freeze({
      package: artifact(artifacts.package, "Verified Store package artifact"),
      release: artifact(artifacts.release, "Verified Store release artifact"),
      compatibility: artifact(
        artifacts.compatibility,
        "Verified Store compatibility artifact",
      ),
    }),
  });
}

function unavailableSnapshot(value) {
  if (
    value.sequence !== null
    || value.catalogSha256 !== null
    || value.source !== null
    || value.trust !== null
    || !Array.isArray(value.entries)
    || value.entries.length !== 0
  ) {
    throw new TypeError("Unavailable verified Store catalog cannot carry trusted catalog identity");
  }
  return Object.freeze({
    schema: VERIFIED_APP_STORE_CATALOG_SCHEMA,
    state: "unavailable",
    sequence: null,
    catalogSha256: null,
    source: null,
    trust: null,
    entries: Object.freeze([]),
    reason: boundedText(value.reason, "Verified Store catalog unavailable reason", MAX_REASON_LENGTH),
    authority: "none",
  });
}

function readySnapshot(value) {
  if (!Number.isSafeInteger(value.sequence) || value.sequence <= 0) {
    throw new TypeError("Verified Store catalog sequence must be a positive safe integer");
  }
  const digest = sha256(value.catalogSha256, "Verified Store catalog digest");

  const source = plainObject(value.source, "Verified Store catalog source");
  assertExactFields(source, SOURCE_FIELDS, "Verified Store catalog source");
  if (source.repository !== APP_STORE_CATALOG_SOURCE_REPOSITORY) {
    throw new TypeError("Verified Store catalog source repository is not canonical");
  }
  const commit = sourceCommit(source.commit);

  const trust = plainObject(value.trust, "Verified Store catalog trust");
  assertExactFields(trust, TRUST_FIELDS, "Verified Store catalog trust");
  if (
    trust.domain !== APP_STORE_CATALOG_TRUST_DOMAIN
    || trust.keyId !== APP_STORE_CATALOG_KEY_ID
  ) {
    throw new TypeError("Verified Store catalog trust identity is not canonical");
  }

  if (!Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > MAX_ENTRIES) {
    throw new TypeError("Verified Store catalog entries must be a bounded non-empty array");
  }
  const entries = value.entries.map((candidate) => entry(candidate, commit));
  const ids = new Set();
  for (const candidate of entries) {
    if (ids.has(candidate.appId)) {
      throw new TypeError(`Verified Store catalog app id is duplicated: ${candidate.appId}`);
    }
    ids.add(candidate.appId);
  }

  if (value.reason !== null) {
    throw new TypeError("Ready verified Store catalog cannot carry unavailable reason");
  }

  return Object.freeze({
    schema: VERIFIED_APP_STORE_CATALOG_SCHEMA,
    state: "ready",
    sequence: value.sequence,
    catalogSha256: digest,
    source: Object.freeze({
      repository: APP_STORE_CATALOG_SOURCE_REPOSITORY,
      commit,
    }),
    trust: Object.freeze({
      domain: APP_STORE_CATALOG_TRUST_DOMAIN,
      keyId: APP_STORE_CATALOG_KEY_ID,
    }),
    entries: Object.freeze(entries),
    reason: null,
    authority: "none",
  });
}

export function validateVerifiedAppStoreCatalogSnapshot(value) {
  plainObject(value, "Verified Store catalog snapshot");
  assertExactFields(value, SNAPSHOT_FIELDS, "Verified Store catalog snapshot");
  if (value.schema !== VERIFIED_APP_STORE_CATALOG_SCHEMA) {
    throw new TypeError("Unsupported verified Store catalog schema");
  }
  if (value.authority !== "none") {
    throw new TypeError("Verified Store catalog must remain authority:none");
  }
  if (value.state === "unavailable") return unavailableSnapshot(value);
  if (value.state === "ready") return readySnapshot(value);
  throw new TypeError("Verified Store catalog state must be ready or unavailable");
}

export function assertVerifiedAppStoreCatalogPort(port) {
  if (
    !port
    || typeof port !== "object"
    || Array.isArray(port)
    || port.schema !== VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA
    || port.authority !== "none"
    || typeof port.getSnapshot !== "function"
    || typeof port.subscribe !== "function"
  ) {
    throw new TypeError("A compatible verified Store catalog port is required");
  }
  for (const method of FORBIDDEN_AUTHORITY_METHODS) {
    if (typeof port[method] === "function") {
      throw new TypeError(`Verified Store catalog port must not expose ${method}()`);
    }
  }
  validateVerifiedAppStoreCatalogSnapshot(port.getSnapshot());
  return port;
}
