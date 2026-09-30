import {
  SYNC_CHECKPOINT_STORE_SCHEMA,
  assertSyncCheckpointStore,
  validateSyncCheckpoint,
} from "../../contracts/sync-checkpoint-store.mjs";

const ENDPOINT = "/__ordax/native/sync-checkpoint";

export async function createNativeSyncCheckpointStore(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native sync checkpoint store requires window.fetch");
  }

  let memory = null;
  let durable = false;
  try {
    const response = await windowRef.fetch(ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.ok) {
      const body = await response.json();
      memory = validateSyncCheckpoint(body?.checkpoint ?? null);
      durable = true;
    }
  } catch {
    // Account continuity is optional for boot; use session memory.
  }

  let desiredRevision = 0;
  let durableRevision = 0;
  let drainPromise = null;
  let lastPersistError = null;

  const persist = async (checkpoint) => {
    const response = await windowRef.fetch(ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkpoint }),
    });
    if (!response.ok) {
      throw new Error(`Native sync checkpoint persistence failed: ${response.status}`);
    }
    durable = true;
    return true;
  };

  const drainDesiredCheckpoint = async () => {
    while (durableRevision < desiredRevision) {
      const revision = desiredRevision;
      const checkpoint = memory;
      try {
        await persist(checkpoint);
        durableRevision = Math.max(durableRevision, revision);
        if (revision === desiredRevision) lastPersistError = null;
      } catch (error) {
        if (revision < desiredRevision) continue;
        lastPersistError = error instanceof Error
          ? error
          : new Error("Native sync checkpoint persistence failed");
        return false;
      }
    }
    return true;
  };

  const scheduleDrain = () => {
    if (drainPromise !== null) return drainPromise;
    drainPromise = Promise.resolve()
      .then(drainDesiredCheckpoint)
      .finally(() => {
        drainPromise = null;
      });
    return drainPromise;
  };

  const store = {
    schema: SYNC_CHECKPOINT_STORE_SCHEMA,
    get scope() {
      return durable ? "device" : "session";
    },
    load() {
      return memory;
    },
    save(value) {
      memory = validateSyncCheckpoint(value);
      desiredRevision += 1;
      scheduleDrain();
      return true;
    },
    async flush() {
      const targetRevision = desiredRevision;
      if (durableRevision >= targetRevision) return true;

      await scheduleDrain();
      if (durableRevision >= targetRevision) return true;

      await scheduleDrain();
      if (durableRevision < targetRevision) {
        throw lastPersistError ?? new Error("Native sync checkpoint persistence failed");
      }
      return true;
    },
  };

  assertSyncCheckpointStore(store);
  return Object.freeze(store);
}
