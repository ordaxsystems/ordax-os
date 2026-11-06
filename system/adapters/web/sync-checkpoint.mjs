import { resolveWebLocalStorage } from "./local-storage.mjs";
import {
  SYNC_CHECKPOINT_STORE_SCHEMA,
  assertSyncCheckpointStore,
  validateSyncCheckpoint,
} from "../../contracts/sync-checkpoint-store.mjs";

const STORAGE_KEY = "ordax.account-sync-checkpoint.v1";

export function createWebSyncCheckpointStore(windowRef = globalThis.window) {
  const storage = resolveWebLocalStorage(windowRef);
  let memory = null;
  let lastSaveConfirmed = true;

  const store = {
    schema: SYNC_CHECKPOINT_STORE_SCHEMA,
    scope: storage ? "device" : "session",
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        memory = raw === null ? null : validateSyncCheckpoint(JSON.parse(raw));
      } catch {
        memory = null;
      }
      return memory;
    },
    save(value) {
      const checkpoint = validateSyncCheckpoint(value);
      memory = checkpoint;
      if (!storage) {
        lastSaveConfirmed = true;
        return true;
      }
      try {
        if (checkpoint === null) {
          storage.removeItem?.(STORAGE_KEY);
        } else {
          storage.setItem(STORAGE_KEY, JSON.stringify(checkpoint));
        }
        lastSaveConfirmed = true;
        return true;
      } catch {
        lastSaveConfirmed = false;
        return false;
      }
    },
    async flush() {
      if (!lastSaveConfirmed) {
        throw new Error("Web sync checkpoint persistence is not confirmed");
      }
      return true;
    },
  };

  assertSyncCheckpointStore(store);
  return Object.freeze(store);
}
