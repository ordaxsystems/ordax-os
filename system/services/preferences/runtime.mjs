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
  let latestWrite = 0;
  const notify = () => {
    for (const listener of [...listeners]) listener(snapshot);
  };
  const confirm = (revision, successful) => {
    if (disposed || revision !== latestWrite) return;
    persistence = successful === true ? "saved" : "session-only";
    notify();
  };
  return Object.freeze({
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot: () => snapshot,
    getPersistenceSnapshot: () => persistence,
    set(preferenceId, value) {
      if (disposed) throw new Error("Preference runtime is disposed");
      const next = setPreferenceValue(snapshot, preferenceId, value);
      if (next === snapshot) return snapshot;
      const revision = ++latestWrite;
      let result;
      try { result = store.save(next); }
      catch { result = false; }
      snapshot = next;
      if (result && typeof result.then === "function") {
        // Native writes are asynchronous; never display "saved" before ACK.
        persistence = "pending";
        Promise.resolve(result).then(
          (successful) => confirm(revision, successful),
          () => confirm(revision, false),
        );
      } else {
        // Web localStorage confirms synchronously.
        persistence = result === true ? "saved" : "session-only";
      }
      notify();
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
