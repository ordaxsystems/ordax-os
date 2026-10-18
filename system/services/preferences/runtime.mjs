import { PREFERENCE_RUNTIME_SCHEMA } from "../../contracts/preference-runtime.mjs";
import { assertPreferenceStore } from "../../contracts/preference-store.mjs";
import { recoverPreferenceSnapshot, setPreferenceValue } from "./catalog.mjs";

// A single confirmation owner for the Surface Native reducer and portable Web.
// Persistence ports own storage; this service only tracks their ACKs.
export function createPreferencePersistence(preferenceStore = null) {
  const store = preferenceStore === null ? null : assertPreferenceStore(preferenceStore);
  let status = "not-written";
  let disposed = false;
  let revision = 0;
  const listeners = new Set();
  const notify = () => {
    for (const listener of [...listeners]) listener(status);
  };
  const confirm = (writeRevision, result) => {
    if (disposed || writeRevision !== revision) return;
    status = result === true ? "saved" : "session-only";
    notify();
  };
  return Object.freeze({
    getSnapshot: () => status,
    save(snapshot) {
      if (disposed) throw new Error("Preference persistence is disposed");
      const writeRevision = ++revision;
      let result;
      try { result = store === null ? false : store.save(snapshot); }
      catch { result = false; }
      if (result && typeof result.then === "function") {
        status = "pending";
        Promise.resolve(result).then(
          (result) => confirm(writeRevision, result),
          () => confirm(writeRevision, false),
        );
      } else {
        status = result === true ? "saved" : "session-only";
      }
      notify();
      return status;
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Preference persistence listener must be a function");
      if (disposed) return () => {};
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
    },
  });
}

// Portable binding for the existing preference semantics and persistence port.
// Native's Surface reducer uses the same catalog; no new preference IDs or sync.
export function createPreferenceRuntime(preferenceStore) {
  const store = assertPreferenceStore(preferenceStore);
  let seed;
  try { seed = store.load(); } catch { seed = {}; }
  /** @type {Readonly<Record<string, string | number | boolean | null>>} */
  let snapshot = recoverPreferenceSnapshot(seed);
  const persistence = createPreferencePersistence(store);
  let disposed = false;
  const listeners = new Set();
  const notify = () => {
    for (const listener of [...listeners]) listener(snapshot);
  };
  const unsubscribePersistence = persistence.subscribe(notify);
  return Object.freeze({
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot: () => snapshot,
    getPersistenceSnapshot: () => persistence.getSnapshot(),
    set(preferenceId, value) {
      if (disposed) throw new Error("Preference runtime is disposed");
      const next = setPreferenceValue(snapshot, preferenceId, value);
      if (next === snapshot) return snapshot;
      snapshot = next;
      persistence.save(next);
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Preference listener must be a function");
      if (disposed) return () => {};
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribePersistence();
      persistence.dispose();
      listeners.clear();
    },
  });
}
