import {
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";

const STORE_STATES = new Set(["unavailable", "ready"]);
const ENTRY_STATES = new Set(["available", "installed", "installing", "staged", "blocked", "failed-retained"]);

export const APP_STORE_CATALOG_SCHEMA = "ordax.app-store-catalog/1";
export const APP_STORE_CATALOG_PORT_SCHEMA = "ordax.app-store-catalog-port/1";

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

function freezeEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App Store entry must be an object");
  }
  assertExactKeys(
    value,
    [
      "appId",
      "title",
      "version",
      "state",
      "installable",
      "installed",
      "blockedReason",
      "artifactIdentityVerified",
      "provenanceVerified",
    ],
    "App Store entry",
  );
  let appId;
  try {
    appId = validateComponentId(value.appId);
  } catch {
    throw new TypeError("App Store entry has invalid appId");
  }
  if (
    typeof value.title !== "string"
    || !value.title.trim()
    || value.title !== value.title.trim()
    || value.title.length > 160
  ) {
    throw new TypeError("App Store entry requires bounded canonical title");
  }
  let version = null;
  if (value.version !== null) {
    try {
      version = validateComponentVersion(value.version);
    } catch {
      throw new TypeError("App Store entry version must be null or canonical component version");
    }
  }
  if (!ENTRY_STATES.has(value.state)) {
    throw new TypeError("App Store entry has invalid state");
  }
  if (
    typeof value.installable !== "boolean"
    || typeof value.installed !== "boolean"
    || typeof value.artifactIdentityVerified !== "boolean"
    || typeof value.provenanceVerified !== "boolean"
  ) {
    throw new TypeError("App Store entry boolean fields are invalid");
  }
  if (
    value.blockedReason !== null
    && (
      typeof value.blockedReason !== "string"
      || !value.blockedReason.trim()
      || value.blockedReason !== value.blockedReason.trim()
      || value.blockedReason.length > 160
    )
  ) {
    throw new TypeError("App Store entry blockedReason must be null or bounded canonical text");
  }
  if (value.installable && (!value.artifactIdentityVerified || !value.provenanceVerified)) {
    throw new TypeError("Installable App Store entry requires verified artifact identity and provenance");
  }
  if (value.installable && value.state !== "available") {
    throw new TypeError("Installable App Store entry must be in available state");
  }
  if (value.installed && ["available", "blocked"].includes(value.state)) {
    throw new TypeError("Installed App Store entry cannot claim available or blocked state");
  }
  if (!value.installed && ["installed", "failed-retained"].includes(value.state)) {
    throw new TypeError("Installed/failed-retained Store state requires installed payload");
  }
  if (value.installed && value.installable) {
    throw new TypeError("Installed App Store entry cannot also be installable");
  }
  return Object.freeze({ ...value, appId, version });
}

export function validateAppStoreCatalogSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App Store catalog snapshot must be an object");
  }
  assertExactKeys(value, ["schema", "state", "entries", "reason", "authority"], "App Store catalog snapshot");
  if (value.schema !== APP_STORE_CATALOG_SCHEMA) {
    throw new TypeError("Unsupported App Store catalog snapshot schema");
  }
  if (!STORE_STATES.has(value.state)) {
    throw new TypeError("App Store catalog snapshot has invalid state");
  }
  if (!Array.isArray(value.entries) || value.entries.length > 256) {
    throw new TypeError("App Store catalog snapshot entries must be a bounded array");
  }
  if (value.reason !== null && (typeof value.reason !== "string" || !value.reason.trim())) {
    throw new TypeError("App Store catalog snapshot reason must be null or non-empty string");
  }
  if (value.authority !== "none") {
    throw new TypeError("App Store catalog must remain authority:none");
  }
  const entries = value.entries.map(freezeEntry);
  const ids = new Set(entries.map((entry) => entry.appId));
  if (ids.size !== entries.length) {
    throw new TypeError("App Store catalog app ids must be unique");
  }
  if (value.state === "unavailable" && entries.length !== 0) {
    throw new TypeError("Unavailable App Store catalog cannot claim product entries");
  }
  if (value.state === "unavailable" && value.reason === null) {
    throw new TypeError("Unavailable App Store catalog requires a reason");
  }
  if (value.state === "ready" && value.reason !== null) {
    throw new TypeError("Ready App Store catalog cannot carry unavailable reason");
  }
  return Object.freeze({
    schema: APP_STORE_CATALOG_SCHEMA,
    state: value.state,
    entries: Object.freeze(entries),
    reason: value.reason,
    authority: "none",
  });
}

export function assertAppStoreCatalogPort(port) {
  if (
    !port
    || typeof port !== "object"
    || port.schema !== APP_STORE_CATALOG_PORT_SCHEMA
    || port.authority !== "none"
    || typeof port.getSnapshot !== "function"
    || typeof port.subscribe !== "function"
  ) {
    throw new TypeError("Incompatible App Store catalog port");
  }
  validateAppStoreCatalogSnapshot(port.getSnapshot());
  return port;
}

export function createUnavailableAppStoreCatalogPort(reason = "signed-catalog-unavailable") {
  const snapshot = validateAppStoreCatalogSnapshot({
    schema: APP_STORE_CATALOG_SCHEMA,
    state: "unavailable",
    entries: [],
    reason,
    authority: "none",
  });
  return Object.freeze({
    schema: APP_STORE_CATALOG_PORT_SCHEMA,
    authority: "none",
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("App Store catalog listener must be a function");
      listener(snapshot);
      return () => {};
    },
  });
}
