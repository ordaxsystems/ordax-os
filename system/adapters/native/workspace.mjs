import { validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
import {
  WORKSPACE_STORE_SCHEMA,
  assertWorkspaceStore,
  validateWorkspaceRecord,
} from "../../contracts/workspace-store.mjs";

// The old v1/v2 records had no attested owner. Never project them as guest.
// Preserve the original bytes for explicit owner-verified recovery.
const GUEST_STORAGE_KEY = "ordax.native.workspace.v2.guest";
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

export function createNativeWorkspaceStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  const emptyWorkspace = validateWorkspaceRecord(null);
  const volatilePartitions = new Map();
  // A failed persistent write is retained only in the verified owner's session.
  const volatileOnlyPartitions = new Set();
  const blockedPartitions = new Set();
  // No implicit owner: only a verified signed-in or signed-out snapshot selects a partition.
  let currentKey = null;

  const load = () => {
    if (currentKey === null || blockedPartitions.has(currentKey)) return emptyWorkspace;
    if (!storage) return volatilePartitions.get(currentKey) ?? emptyWorkspace;
    let currentRaw;
    try {
      currentRaw = storage.getItem(currentKey);
    } catch {
      // An unreadable backing partition cannot be proven to match a cached edit.
      blockedPartitions.add(currentKey);
      return emptyWorkspace;
    }
    if (currentRaw !== null) {
      try {
        const value = validateWorkspaceRecord(JSON.parse(currentRaw));
        // A rejected write must not be mistaken for durable state on the
        // next read. Still validate existing disk bytes to fail closed if
        // another writer corrupted the verified owner partition.
        if (volatileOnlyPartitions.has(currentKey)) {
          return volatilePartitions.get(currentKey) ?? emptyWorkspace;
        }
        volatilePartitions.set(currentKey, value);
        return value;
      } catch {
        // Do not silently overwrite corrupt per-account windows or paths.
        blockedPartitions.add(currentKey);
        return emptyWorkspace;
      }
    }
    if (volatileOnlyPartitions.has(currentKey)) {
      return volatilePartitions.get(currentKey) ?? emptyWorkspace;
    }
    // External removal of durable state must not resurrect an old cache.
    volatilePartitions.delete(currentKey);
    return emptyWorkspace;
  };

  const store = {
    schema: WORKSPACE_STORE_SCHEMA,
    load,
    selectOwner(sessionSnapshot) {
      // Unknown, unavailable, or invalid identity must not retain the previous owner.
      let identity = null;
      try {
        identity = validateIdentitySessionSnapshot(sessionSnapshot);
      } catch {
        // Failed verification is not signed-out proof.
      }
      const nextKey = identity?.state === "signed-in"
        ? SUBJECT_STORAGE_PREFIX + encodeURIComponent(identity.subjectId)
        : identity?.state === "signed-out" ? GUEST_STORAGE_KEY : null;
      if (currentKey === nextKey) return false;
      currentKey = nextKey;
      return true;
    },
    save(snapshot) {
      const validated = validateWorkspaceRecord(snapshot);
      if (currentKey === null || blockedPartitions.has(currentKey)) return false;
      if (!storage) {
        volatilePartitions.set(currentKey, validated);
        volatileOnlyPartitions.add(currentKey);
        return false;
      }
      // A first write without a preceding load must not overwrite an
      // unreadable on-disk account partition (or a corrupt guest record).
      try {
        const existing = storage.getItem(currentKey);
        if (existing !== null) validateWorkspaceRecord(JSON.parse(existing));
      } catch {
        blockedPartitions.add(currentKey);
        return false;
      }
      volatilePartitions.set(currentKey, validated);
      try {
        storage.setItem(currentKey, JSON.stringify(validated));
        volatileOnlyPartitions.delete(currentKey);
        return true;
      } catch {
        volatileOnlyPartitions.add(currentKey);
        return false;
      }
    },
  };

  assertWorkspaceStore(store);
  return Object.freeze(store);
}
