import {
  BROWSER_SEARCH_PREFERENCES_STORE_SCHEMA,
  assertBrowserSearchPreferencesStore,
  defaultBrowserSearchPreferenceRecord,
  validateBrowserSearchPreferenceRecord,
} from "../../contracts/browser-search-preferences.mjs";

const STORAGE_KEY = "ordax.native.browser-search-preferences.v1";
const RECORD_SCHEMA = "ordax.native.browser-search-preferences-record/1";

function resolveStorage(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") {
      return storage;
    }
  } catch {
    // Privileged browser profile storage may be denied; fall back to session.
  }
  return null;
}

export function createNativeBrowserSearchPreferencesStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let memory = defaultBrowserSearchPreferenceRecord();
  const store = {
    schema: BROWSER_SEARCH_PREFERENCES_STORE_SCHEMA,
    scope: storage ? "device" : "session",
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return memory;
        const record = JSON.parse(raw);
        if (!record || record.schema !== RECORD_SCHEMA) {
          memory = defaultBrowserSearchPreferenceRecord();
          return memory;
        }
        memory = validateBrowserSearchPreferenceRecord(record.state);
      } catch {
        memory = defaultBrowserSearchPreferenceRecord();
      }
      return memory;
    },
    save(value) {
      memory = validateBrowserSearchPreferenceRecord(value);
      if (!storage) return false;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify({
          schema: RECORD_SCHEMA,
          state: memory,
        }));
        return true;
      } catch {
        return false;
      }
    },
  };
  return Object.freeze(assertBrowserSearchPreferencesStore(store));
}
