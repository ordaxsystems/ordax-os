import {
  BROWSER_SEARCH_PREFERENCES_SCHEMA,
  assertBrowserSearchPreferencesPort,
  assertBrowserSearchPreferencesStore,
  defaultBrowserSearchPreferenceRecord,
  validateBrowserSearchPreferenceRecord,
  validateBrowserSearchPreferencesSnapshot,
} from "../../../contracts/browser-search-preferences.mjs";

export function createBrowserSearchPreferencesRuntime({ store = null } = {}) {
  const durableStore = store === null ? null : assertBrowserSearchPreferencesStore(store);
  let state = defaultBrowserSearchPreferenceRecord();
  let persistence = durableStore?.scope ?? "session";
  let destroyed = false;
  const listeners = new Set();
  if (durableStore) {
    try {
      state = validateBrowserSearchPreferenceRecord(durableStore.load());
    } catch {
      state = defaultBrowserSearchPreferenceRecord();
      persistence = "session";
    }
  }
  const getSnapshot = () => validateBrowserSearchPreferencesSnapshot({
    providerId: state.providerId,
    persistence,
  });
  return assertBrowserSearchPreferencesPort(Object.freeze({
    schema: BROWSER_SEARCH_PREFERENCES_SCHEMA,
    getSnapshot,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Search preference listener must be a function");
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setProvider(providerId) {
      if (destroyed) return getSnapshot();
      const next = validateBrowserSearchPreferenceRecord({ providerId });
      if (state.providerId === next.providerId) return getSnapshot();
      state = next;
      if (durableStore) {
        try {
          persistence = durableStore.save(next) !== false && durableStore.scope === "device"
            ? "device" : "session";
        } catch {
          persistence = "session";
        }
      }
      const snapshot = getSnapshot();
      for (const listener of [...listeners]) listener(snapshot);
      return snapshot;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
    },
  }));
}
