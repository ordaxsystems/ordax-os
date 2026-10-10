import { listFirstPartyApps } from "./catalog.mjs";
import { isAppAvailable } from "../contracts/first-party-app.mjs";

export const APP_RUNTIME_CATALOG_SCHEMA = "ordax.app-runtime-catalog/1";

function validateEntry(value, source) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.id !== "string" || !value.id
      || value.component?.id !== value.id || value.component?.kind !== "app"
      || typeof value.singleton !== "boolean"
      || !Array.isArray(value.requiredCapabilities) || !Array.isArray(value.panels)) {
    throw new TypeError(`Invalid ${source} app catalog entry`);
  }
  if (source === "external" && (
    value.component.releaseMode !== "component-slot"
    || value.presentation?.sourceLocale !== value.localization?.sourceLocale
    || value.panels.length !== 1
    || value.panels[0]?.kind !== "extension"
    || value.panels[0]?.extensionId !== value.id
    || value.requiredCapabilities.length !== 0
  )) {
    throw new TypeError("External catalog entry must be descriptive component-slot data");
  }
  return value;
}

// Built-ins always win ID collisions. No package, runtime or permission is
// activated by this read-only catalog; mounting remains a separate verified gate.
export function createAppRuntimeCatalog({
  builtIns = listFirstPartyApps(),
  external = [],
} = {}) {
  if (!Array.isArray(builtIns) || !Array.isArray(external)) {
    throw new TypeError("App runtime catalog requires built-in and external arrays");
  }
  const byId = new Map();
  const internalApps = [];
  for (const value of builtIns) {
    const app = validateEntry(value, "built-in");
    if (byId.has(app.id)) throw new TypeError(`Duplicate built-in app id: ${app.id}`);
    byId.set(app.id, app);
    internalApps.push(app);
  }

  const externalIds = new Set();
  const externalApps = [];
  for (const value of external) {
    const app = validateEntry(value, "external");
    if (externalIds.has(app.id)) throw new TypeError(`Duplicate external app id: ${app.id}`);
    externalIds.add(app.id);
    if (byId.has(app.id)) continue; // Reserved built-in identity cannot be replaced.
    byId.set(app.id, app);
    externalApps.push(app);
  }
  externalApps.sort((a, b) => a.id.localeCompare(b.id));
  const apps = Object.freeze([...internalApps, ...externalApps]);
  return Object.freeze({
    schema: APP_RUNTIME_CATALOG_SCHEMA,
    list() { return apps; },
    get(id) { return typeof id === "string" ? byId.get(id) ?? null : null; },
    isAvailable(app, capabilities) { return isAppAvailable(app, capabilities); },
  });
}

export function assertAppRuntimeCatalog(value) {
  if (!value || typeof value !== "object"
      || value.schema !== APP_RUNTIME_CATALOG_SCHEMA
      || typeof value.list !== "function"
      || typeof value.get !== "function"
      || typeof value.isAvailable !== "function") {
    throw new TypeError("A compatible app runtime catalog is required");
  }
  return value;
}

// Source-only foundation. Surface does not switch catalogs until signed-slot
// discovery and lifecycle integration pass their independent CI and E2E gates.
export const defaultAppRuntimeCatalog = createAppRuntimeCatalog();
