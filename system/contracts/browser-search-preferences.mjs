import {
  BROWSER_SEARCH_PROVIDER,
  browserSearchProvider,
} from "./browser-navigation.mjs";

export const BROWSER_SEARCH_PREFERENCES_SCHEMA = "ordax.browser-search-preferences/1";
export const BROWSER_SEARCH_PREFERENCES_STORE_SCHEMA = "ordax.browser-search-preferences-store/1";

export function validateBrowserSearchPreferenceRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "providerId") {
    throw new TypeError("Browser search preferences record is incompatible");
  }
  return Object.freeze({ providerId: browserSearchProvider(value.providerId).id });
}

export function defaultBrowserSearchPreferenceRecord() {
  return validateBrowserSearchPreferenceRecord({ providerId: BROWSER_SEARCH_PROVIDER.id });
}

export function validateBrowserSearchPreferencesSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || !["device", "session"].includes(value.persistence)) {
    throw new TypeError("Browser search preferences snapshot is invalid");
  }
  return Object.freeze({
    providerId: browserSearchProvider(value.providerId).id,
    persistence: value.persistence,
  });
}

export function assertBrowserSearchPreferencesStore(store) {
  if (!store || store.schema !== BROWSER_SEARCH_PREFERENCES_STORE_SCHEMA
      || !["device", "session"].includes(store.scope)
      || typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("Compatible browser search preferences store is required");
  }
  validateBrowserSearchPreferenceRecord(store.load());
  return store;
}

export function assertBrowserSearchPreferencesPort(port) {
  if (!port || port.schema !== BROWSER_SEARCH_PREFERENCES_SCHEMA
      || ["getSnapshot", "subscribe", "setProvider", "destroy"].some(
        method => typeof port[method] !== "function"
      )) {
    throw new TypeError("Compatible browser search preferences port is required");
  }
  validateBrowserSearchPreferencesSnapshot(port.getSnapshot());
  return port;
}
