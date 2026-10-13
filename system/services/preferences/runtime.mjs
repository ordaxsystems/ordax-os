import { PREFERENCE_RUNTIME_SCHEMA } from "../../contracts/preference-runtime.mjs";
import { assertPreferenceStore } from "../../contracts/preference-store.mjs";
import { recoverPreferenceSnapshot, setPreferenceValue } from "./catalog.mjs";

// Portable binding for the existing preference semantics and persistence port.
// Native's Surface reducer uses the same catalog; no new preference IDs or sync.
export function createPreferenceRuntime(preferenceStore) {
  const store = assertPreferenceStore(preferenceStore);
  let seed;
  try { seed = store.load(); } catch { seed = {}; }
  /** @type {Readonly<Record<string, string | number | boolean | null>>} */
  let snapshot = recoverPreferenceSnapshot(seed);
  let persistence = "not-written";
  let disposed = false;
  const listeners = new Set();
  return Object.freeze({
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot: () => snapshot,
    getPersistenceSnapshot: () => persistence,
    set(preferenceId, value) {
      if (disposed) throw new Error("Preference runtime is disposed");
      const next = setPreferenceValue(snapshot, preferenceId, value);
      if (next === snapshot) return snapshot;
      try { persistence = store.save(next) === true ? "saved" : "session-only"; }
      catch { persistence = "session-only"; }
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
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
      listeners.clear();
    },
  });
}
