import { resolveWebLocalStorage } from "./local-storage.mjs";
import {
  WORKSPACE_STORE_SCHEMA,
  assertWorkspaceStore,
  migrateLegacyWorkspaceRecord,
  validateWorkspaceRecord,
} from "../../contracts/workspace-store.mjs";

const STORAGE_KEY = "ordax.workspace.v2";
const LEGACY_STORAGE_KEY = "ordax.workspace.v1";

function readStored(storage, key, validator) {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  return validator(JSON.parse(raw));
}

// v2 is the sole writable Workspace record. Retire stale v1 bytes only after
// v2 has been validated or durably written; cleanup failure cannot undo v2.
function retireLegacyRecord(storage) {
  try {
    if (storage.getItem(LEGACY_STORAGE_KEY) !== null) {
      storage.removeItem?.(LEGACY_STORAGE_KEY);
    }
  } catch {
    // The canonical v2 value remains authoritative even if cleanup is denied.
  }
}

export function createWebWorkspaceStore(windowRef = globalThis.window) {
  const storage = resolveWebLocalStorage(windowRef);
  let memory = validateWorkspaceRecord(null);

  const load = () => {
    if (!storage) return memory;
    let currentRaw;
    try {
      currentRaw = storage.getItem(STORAGE_KEY);
    } catch {
      return memory; // Storage may be revoked after adapter creation.
    }
    if (currentRaw !== null) {
      try {
        memory = validateWorkspaceRecord(JSON.parse(currentRaw));
        retireLegacyRecord(storage);
      } catch {
        // A corrupt v2 never falls back to stale v1 state.
        memory = validateWorkspaceRecord(null);
      }
      return memory;
    }

    let legacy;
    try {
      legacy = readStored(storage, LEGACY_STORAGE_KEY, migrateLegacyWorkspaceRecord);
    } catch {
      return memory;
    }
    if (legacy) {
      memory = legacy;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(memory));
        retireLegacyRecord(storage);
      } catch {
        // Keep the validated layout in memory and v1 on disk if v2 was not saved.
      }
    }
    return memory;
  };

  const store = {
    schema: WORKSPACE_STORE_SCHEMA,
    load,
    save(snapshot) {
      const validated = validateWorkspaceRecord(snapshot);
      memory = validated;
      if (!storage) return false;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(validated));
        retireLegacyRecord(storage);
        return true;
      } catch {
        return false;
      }
    },
  };

  assertWorkspaceStore(store);
  return Object.freeze(store);
}
