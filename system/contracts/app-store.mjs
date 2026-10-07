import {
  componentVersionIsNewer,
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";

const STORE_STATES = new Set(["unavailable", "ready"]);
const ENTRY_STATES = new Set([
  "available",
  "installed",
  "installing",
  "updating",
  "removing",
  "staged",
  "blocked",
  "failed-retained",
]);
const IN_FLIGHT_STATES = new Set(["installing", "updating", "removing", "staged"]);

export const APP_STORE_CATALOG_SCHEMA = "ordax.app-store-catalog/2";
export const APP_STORE_CATALOG_PORT_SCHEMA = "ordax.app-store-catalog-port/2";

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

function canonicalVersion(value, label) {
  if (value === null) return null;
  try {
    return validateComponentVersion(value);
  } catch {
    throw new TypeError(`${label} must be null or a canonical component version`);
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
      "state",
      "installedVersion",
      "availableVersion",
      "installable",
      "updatable",
      "removable",
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
  if (!ENTRY_STATES.has(value.state)) {
    throw new TypeError("App Store entry has invalid state");
  }

  const installedVersion = canonicalVersion(value.installedVersion, "App Store installedVersion");
  const availableVersion = canonicalVersion(value.availableVersion, "App Store availableVersion");

  for (const key of [
    "installable",
    "updatable",
    "removable",
    "artifactIdentityVerified",
    "provenanceVerified",
  ]) {
    if (typeof value[key] !== "boolean") {
      throw new TypeError(`App Store entry ${key} must be boolean`);
    }
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
  if (value.state === "blocked" && value.blockedReason === null) {
    throw new TypeError("Blocked App Store entry requires blockedReason");
  }
  if (value.state !== "blocked" && value.blockedReason !== null) {
    throw new TypeError("Only blocked App Store entries may carry blockedReason");
  }

  if (availableVersion === null && (value.artifactIdentityVerified || value.provenanceVerified)) {
    throw new TypeError("App Store candidate verification flags require an availableVersion");
  }
  if (
    installedVersion !== null
    && availableVersion !== null
    && !componentVersionIsNewer(availableVersion, installedVersion)
  ) {
    throw new TypeError("App Store availableVersion must be newer than installedVersion");
  }

  if (
    value.state === "installing"
    && (
      installedVersion !== null
      || availableVersion === null
      || !value.artifactIdentityVerified
      || !value.provenanceVerified
    )
  ) {
    throw new TypeError("Installing App Store entry requires a verified candidate and no installed version");
  }
  if (
    value.state === "updating"
    && (
      installedVersion === null
      || availableVersion === null
      || !value.artifactIdentityVerified
      || !value.provenanceVerified
    )
  ) {
    throw new TypeError("Updating App Store entry requires installed and verified candidate versions");
  }
  if (
    value.state === "staged"
    && (
      availableVersion === null
      || !value.artifactIdentityVerified
      || !value.provenanceVerified
    )
  ) {
    throw new TypeError("Staged App Store entry requires a verified candidate");
  }


  if (value.installable) {
    if (
      installedVersion !== null
      || availableVersion === null
      || value.state !== "available"
      || !value.artifactIdentityVerified
      || !value.provenanceVerified
      || value.updatable
      || value.removable
    ) {
      throw new TypeError("Installable App Store entry is semantically inconsistent");
    }
  }

  if (value.updatable) {
    if (
      installedVersion === null
      || availableVersion === null
      || value.state !== "installed"
      || !value.artifactIdentityVerified
      || !value.provenanceVerified
      || value.installable
    ) {
      throw new TypeError("Updatable App Store entry is semantically inconsistent");
    }
  }

  if (value.removable) {
    if (
      installedVersion === null
      || !["installed", "blocked", "failed-retained"].includes(value.state)
      || value.installable
    ) {
      throw new TypeError("Removable App Store entry is semantically inconsistent");
    }
  }

  if (IN_FLIGHT_STATES.has(value.state) && (value.installable || value.updatable || value.removable)) {
    throw new TypeError("In-flight App Store entry cannot expose a new lifecycle request");
  }
  if (value.state === "available" && (installedVersion !== null || availableVersion === null)) {
    throw new TypeError("Available App Store entry requires candidate only");
  }
  if (["installed", "updating", "removing", "failed-retained"].includes(value.state) && installedVersion === null) {
    throw new TypeError("Installed App Store lifecycle state requires installedVersion");
  }
  if (value.state === "installing" && installedVersion !== null) {
    throw new TypeError("Installing App Store entry cannot already claim installedVersion");
  }
  if (installedVersion === null && (value.updatable || value.removable)) {
    throw new TypeError("Absent App Store entry cannot update or remove");
  }
  if (installedVersion !== null && value.installable) {
    throw new TypeError("Installed App Store entry cannot also be installable");
  }

  return Object.freeze({
    ...value,
    appId,
    installedVersion,
    availableVersion,
  });
}

export function validateAppStoreCatalogSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App Store catalog snapshot must be an object");
  }
  assertExactKeys(
    value,
    ["schema", "state", "entries", "reason", "authority"],
    "App Store catalog snapshot",
  );
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
    || Array.isArray(port)
    || port.schema !== APP_STORE_CATALOG_PORT_SCHEMA
    || port.authority !== "none"
    || typeof port.getSnapshot !== "function"
    || typeof port.subscribe !== "function"
  ) {
    throw new TypeError("Incompatible App Store catalog port");
  }
  assertExactKeys(
    port,
    ["schema", "authority", "getSnapshot", "subscribe"],
    "App Store catalog port",
  );
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
      if (typeof listener !== "function") {
        throw new TypeError("App Store catalog listener must be a function");
      }
      listener(snapshot);
      return () => {};
    },
  });
}
