import { validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
import {
  WORKSPACE_STORE_SCHEMA,
  assertWorkspaceStore,
  migrateLegacyWorkspaceRecord,
  validateWorkspaceRecord,
} from "../../contracts/workspace-store.mjs";

const STORAGE_KEY = "ordax.native.workspace.v2";
const LEGACY_STORAGE_KEY = "ordax.native.workspace.v1";
const SUBJECT_STORAGE_PREFIX = "ordax.native.workspace.v2.subject.";

function resolveStorage(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") {
      return storage;
    }
  } catch {
    // Native browser policy may deny storage access; memory remains usable.
  }
  return null;
}

function readStored(storage, key, validator) {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  return validator(JSON.parse(raw));
}

export function createNativeWorkspaceStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  const emptyWorkspace = validateWorkspaceRecord(null);
  const volatilePartitions = new Map();
  const blockedPartitions = new Set();
  let currentKey = STORAGE_KEY;

  const load = () => {
    if (blockedPartitions.has(currentKey)) return emptyWorkspace;
    if (!storage) return volatilePartitions.get(currentKey) ?? emptyWorkspace;
    let currentRaw;
    try {
      currentRaw = storage.getItem(currentKey);
    } catch {
      return volatilePartitions.get(currentKey) ?? emptyWorkspace;
    }
    if (currentRaw !== null) {
      try {
        const value = validateWorkspaceRecord(JSON.parse(currentRaw));
        volatilePartitions.set(currentKey, value);
        return value;
      } catch {
        // Do not silently overwrite corrupt per-account windows or paths.
        blockedPartitions.add(currentKey);
        return emptyWorkspace;
      }
    }
    if (currentKey === STORAGE_KEY) {
      try {
        const legacy = readStored(storage, LEGACY_STORAGE_KEY, migrateLegacyWorkspaceRecord);
        if (legacy) {
          volatilePartitions.set(currentKey, legacy);
          storage.setItem(STORAGE_KEY, JSON.stringify(legacy));
          return legacy;
        }
      } catch {
        // The old guest record is left untouched for explicit recovery.
      }
    }
    return volatilePartitions.get(currentKey) ?? emptyWorkspace;
  };

  const store = {
    schema: WORKSPACE_STORE_SCHEMA,
    load,
    selectOwner(sessionSnapshot) {
      const identity = validateIdentitySessionSnapshot(sessionSnapshot);
      // A missing/offline authority is not permission to inspect the
      // previous account's local browser workspace.
      const nextKey = identity.state === "signed-in"
        ? SUBJECT_STORAGE_PREFIX + encodeURIComponent(identity.subjectId)
        : STORAGE_KEY;
      if (currentKey === nextKey) return false;
      currentKey = nextKey;
      return true;
    },
    save(snapshot) {
      const validated = validateWorkspaceRecord(snapshot);
      if (blockedPartitions.has(currentKey)) return false;
      volatilePartitions.set(currentKey, validated);
      if (!storage) return false;
      try {
        storage.setItem(currentKey, JSON.stringify(validated));
        return true;
      } catch {
        return false;
      }
    },
  };

  assertWorkspaceStore(store);
  return Object.freeze(store);
}
