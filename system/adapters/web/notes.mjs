import {
  NOTES_STORE_SCHEMA,
  assertNotesStore,
  validateNotesSnapshot,
} from "../../contracts/notes-store.mjs";

const STORAGE_KEY = "ordax.notes.v1";

function resolveStorage(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") {
      return storage;
    }
  } catch {
    // Privacy policy may deny local storage. The adapter falls back to session memory.
  }
  return null;
}

export function createWebNotesStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let memory = null;
  let persistentStateBlocked = false;

  const store = {
    schema: NOTES_STORE_SCHEMA,
    scope: storage ? "device" : "session",
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) {
          persistentStateBlocked = false;
          return memory;
        }
        memory = validateNotesSnapshot(JSON.parse(raw));
        persistentStateBlocked = false;
      } catch {
        // Fail closed after malformed/unreadable durable state. Treating corruption
        // as an empty device store would let the runtime overwrite the only
        // recoverable bytes with a fresh snapshot during initialization.
        persistentStateBlocked = true;
      }
      return memory;
    },
    save(snapshot) {
      const validated = validateNotesSnapshot(snapshot);
      memory = validated;
      if (!storage) return true;
      if (persistentStateBlocked) return false;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(validated));
        return true;
      } catch {
        return false;
      }
    },
    async flush() {
      // localStorage.setItem() is synchronous; reaching flush means save() already
      // completed or failed in the same call stack. Session memory is equally immediate.
      return true;
    },
  };

  assertNotesStore(store);
  return Object.freeze(store);
}
