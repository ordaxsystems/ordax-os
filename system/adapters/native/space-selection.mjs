import {
  SPACE_SELECTION_STORE_SCHEMA,
  assertSpaceSelectionStore,
  validateSpaceSelectionRecord,
} from "../../contracts/space-selection.mjs";

const STORAGE_KEY = "ordax.native.space-selection.v1";

function resolveStorage(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (
      storage
      && typeof storage.getItem === "function"
      && typeof storage.setItem === "function"
      && typeof storage.removeItem === "function"
    ) {
      return storage;
    }
  } catch {
    // Native browser policy may deny storage; memory fallback stays available.
  }
  return null;
}

export function createNativeSpaceSelectionStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let memory = null;

  const load = () => {
    if (!storage) return memory;
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) {
      memory = null;
      return null;
    }
    try {
      memory = validateSpaceSelectionRecord(JSON.parse(raw));
      return memory;
    } catch {
      memory = null;
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        // Corrupt storage stays unusable, but no stale selection is exposed.
      }
      return null;
    }
  };

  const store = {
    schema: SPACE_SELECTION_STORE_SCHEMA,
    load,
    save(record) {
      const validated = validateSpaceSelectionRecord(record);
      if (validated === null) {
        throw new TypeError("Space selection store cannot save an empty record");
      }
      memory = validated;
      if (!storage) return false;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(validated));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      memory = null;
      if (!storage) return false;
      try {
        storage.removeItem(STORAGE_KEY);
        return true;
      } catch {
        return false;
      }
    },
  };

  assertSpaceSelectionStore(store);
  return Object.freeze(store);
}
