import { resolveWebLocalStorage } from "./local-storage.mjs";
import {
  PREFERENCE_STORE_SCHEMA,
  assertPreferenceStore,
  validatePreferenceRecord,
} from "../../contracts/preference-store.mjs";

const STORAGE_KEY = "ordax.preferences.v1";

export function createWebPreferenceStore(windowRef = globalThis.window) {
  const storage = resolveWebLocalStorage(windowRef);
  let memory = validatePreferenceRecord({});

  const store = {
    schema: PREFERENCE_STORE_SCHEMA,
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return memory;
        memory = validatePreferenceRecord(JSON.parse(raw));
      } catch {
        // Corrupt or unavailable storage must not destroy the last good session snapshot.
      }
      return memory;
    },
    save(snapshot) {
      const validated = validatePreferenceRecord(snapshot);
      memory = validated;
      if (!storage) return false;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(validated));
        return true;
      } catch {
        return false;
      }
    },
  };

  assertPreferenceStore(store);
  return Object.freeze(store);
}
