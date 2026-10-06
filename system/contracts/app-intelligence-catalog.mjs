import {
  APP_INTELLIGENCE_EXECUTION_MODE,
  validateAppIntelligenceManifest,
} from "./app-intelligence-manifest.mjs";

export const APP_INTELLIGENCE_CATALOG_PORT_SCHEMA = "ordax.app-intelligence-catalog/1";
export const APP_INTELLIGENCE_CATALOG_SNAPSHOT_SCHEMA = "ordax.app-intelligence-catalog-snapshot/1";
export const MAX_APP_INTELLIGENCE_CATALOG_APPS = 32;
export const MAX_APP_INTELLIGENCE_CATALOG_INTENTS = 512;

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

export function validateAppIntelligenceCatalogSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App intelligence catalog snapshot must be an object");
  }
  exactKeys(
    value,
    ["schema", "revision", "manifests", "authority", "execution"],
    "App intelligence catalog snapshot",
  );
  if (value.schema !== APP_INTELLIGENCE_CATALOG_SNAPSHOT_SCHEMA) {
    throw new TypeError("Unsupported app intelligence catalog snapshot schema");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError("App intelligence catalog revision is invalid");
  }
  if (value.authority !== "none") {
    throw new TypeError("App intelligence catalog must not carry authority");
  }
  if (value.execution !== APP_INTELLIGENCE_EXECUTION_MODE) {
    throw new TypeError("App intelligence catalog cannot grant execution");
  }
  if (!Array.isArray(value.manifests) || value.manifests.length > MAX_APP_INTELLIGENCE_CATALOG_APPS) {
    throw new TypeError("App intelligence catalog manifests must be a bounded array");
  }

  const manifests = value.manifests
    .map((manifest) => validateAppIntelligenceManifest(manifest))
    .sort((left, right) => left.appId.localeCompare(right.appId));

  if (new Set(manifests.map((manifest) => manifest.appId)).size !== manifests.length) {
    throw new TypeError("App intelligence catalog app ids must be unique");
  }
  const intentCount = manifests.reduce(
    (total, manifest) => total + manifest.intents.length,
    0,
  );
  if (intentCount > MAX_APP_INTELLIGENCE_CATALOG_INTENTS) {
    throw new TypeError("App intelligence catalog intent count exceeds its bound");
  }

  return Object.freeze({
    schema: APP_INTELLIGENCE_CATALOG_SNAPSHOT_SCHEMA,
    revision: value.revision,
    manifests: Object.freeze(manifests),
    authority: "none",
    execution: APP_INTELLIGENCE_EXECUTION_MODE,
  });
}

export function createEmptyAppIntelligenceCatalogSnapshot() {
  return validateAppIntelligenceCatalogSnapshot({
    schema: APP_INTELLIGENCE_CATALOG_SNAPSHOT_SCHEMA,
    revision: 0,
    manifests: [],
    authority: "none",
    execution: APP_INTELLIGENCE_EXECUTION_MODE,
  });
}

export function assertAppIntelligenceCatalogPort(port) {
  if (!port || typeof port !== "object" || port.schema !== APP_INTELLIGENCE_CATALOG_PORT_SCHEMA) {
    throw new TypeError("Compatible app intelligence catalog port is required");
  }
  for (const method of ["getSnapshot", "subscribe"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`App intelligence catalog port must implement ${method}()`);
    }
  }
  validateAppIntelligenceCatalogSnapshot(port.getSnapshot());
  return port;
}
