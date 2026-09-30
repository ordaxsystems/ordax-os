export const SYNC_CHECKPOINT_STORE_SCHEMA = "ordax.sync-checkpoint-store/1";

const MAX_REVISIONS = 64;

function safeCursor(value, label = "cursor") {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function validateSyncCheckpoint(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Sync checkpoint must be an object or null");
  }
  if (
    typeof value.subjectId !== "string"
    || value.subjectId.length < 1
    || value.subjectId.length > 200
  ) {
    throw new TypeError("Sync checkpoint subjectId is invalid");
  }
  if (
    !value.revisions
    || typeof value.revisions !== "object"
    || Array.isArray(value.revisions)
  ) {
    throw new TypeError("Sync checkpoint revisions must be an object");
  }
  const entries = Object.entries(value.revisions);
  if (entries.length > MAX_REVISIONS) {
    throw new TypeError("Sync checkpoint has too many object revisions");
  }
  const revisions = {};
  for (const [objectId, revision] of entries) {
    if (!objectId || objectId.length > 240) {
      throw new TypeError("Sync checkpoint object id is invalid");
    }
    revisions[objectId] = safeCursor(revision, "server revision");
  }
  return Object.freeze({
    subjectId: value.subjectId,
    cursor: safeCursor(value.cursor),
    revisions: Object.freeze(revisions),
  });
}

export function assertSyncCheckpointStore(store) {
  if (
    !store
    || typeof store !== "object"
    || store.schema !== SYNC_CHECKPOINT_STORE_SCHEMA
  ) {
    throw new TypeError("A compatible sync-checkpoint-store is required");
  }
  if (!new Set(["device", "session"]).has(store.scope)) {
    throw new TypeError("Sync checkpoint scope must be device or session");
  }
  if (typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("Sync checkpoint store must implement load() and save()");
  }
  if (store.flush !== undefined && typeof store.flush !== "function") {
    throw new TypeError("Sync checkpoint flush must be a function when provided");
  }
  validateSyncCheckpoint(store.load());
  if (typeof store.flush === "function") return store;

  // Legacy/synchronous stores already make save() durable before returning.
  // Asynchronous stores must expose flush(); production Native does so.
  return Object.freeze({
    schema: store.schema,
    scope: store.scope,
    load: store.load.bind(store),
    save: store.save.bind(store),
    async flush() {
      return true;
    },
  });
}
