import { listFirstPartyApps, isAppAvailable } from "./catalog.mjs";

export const APP_RUNTIME_CATALOG_SCHEMA = "ordax.app-runtime-catalog/1";

function validateApp(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || typeof value.id !== "string"
    || !value.id
    || typeof value.singleton !== "boolean"
    || !Array.isArray(value.requiredCapabilities)
  ) {
    throw new TypeError("App runtime catalog entry is invalid");
  }
  return value;
}

export function createAppRuntimeCatalog(apps = listFirstPartyApps()) {
  if (!Array.isArray(apps)) {
    throw new TypeError("App runtime catalog requires an array");
  }
  const list = apps.map(validateApp);
  const byId = new Map();
  for (const app of list) {
    if (byId.has(app.id)) {
      throw new TypeError(`App runtime catalog duplicates app id: ${app.id}`);
    }
    byId.set(app.id, app);
  }
  const frozen = Object.freeze([...list]);
  const catalog = {
    schema: APP_RUNTIME_CATALOG_SCHEMA,
    list() {
      return frozen;
    },
    get(appId) {
      return typeof appId === "string" ? (byId.get(appId) ?? null) : null;
    },
    isAvailable(app, capabilityIds) {
      return isAppAvailable(app, capabilityIds);
    },
  };
  return Object.freeze(catalog);
}

export function assertAppRuntimeCatalog(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== APP_RUNTIME_CATALOG_SCHEMA
    || typeof value.list !== "function"
    || typeof value.get !== "function"
    || typeof value.isAvailable !== "function"
  ) {
    throw new TypeError("A compatible app runtime catalog is required");
  }
  return value;
}

export const defaultAppRuntimeCatalog = createAppRuntimeCatalog();
