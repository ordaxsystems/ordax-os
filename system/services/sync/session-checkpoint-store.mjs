import {
  SYNC_CHECKPOINT_STORE_SCHEMA,
  assertSyncCheckpointStore,
  validateSyncCheckpoint,
} from "../../contracts/sync-checkpoint-store.mjs";

export function createSessionSyncCheckpointStore() {
  let value = null;
  const store = {
    schema: SYNC_CHECKPOINT_STORE_SCHEMA,
    scope: "session",
    load() {
      return value;
    },
    save(next) {
      value = validateSyncCheckpoint(next);
      return true;
    },
    async flush() {
      return true;
    },
  };
  assertSyncCheckpointStore(store);
  return Object.freeze(store);
}
