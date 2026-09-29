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
  let storageOperational = storage !== null;
  let memory = null;

  const load = () => {
    if (!storage || !storageOperational) return memory;
    let raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch {
      storageOperational = false;
      return memory;
    }
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
        storageOperational = false;
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
      if (!storage || !storageOperational) return false;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(validated));
        return true;
      } catch {
        storageOperational = false;
        return false;
      }
    },
    clear() {
      memory = null;
      if (!storage || !storageOperational) return false;
      try {
        storage.removeItem(STORAGE_KEY);
        return true;
      } catch {
        storageOperational = false;
        return false;
      }
    },
  };

  assertSpaceSelectionStore(store);
  return Object.freeze(store);
}
