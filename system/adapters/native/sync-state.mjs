import {
  SYNC_STATE_STORE_SCHEMA,
  assertSyncStateStore,
  validateSyncStatePayload,
} from "../../contracts/sync-state-store.mjs";

const SYNC_STATE_ENDPOINT = "/__ordax/native/sync-state";

export async function createNativeSyncStateStore(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native sync state store requires window.fetch");
  }

  let memory = null;
  let durable = false;
  try {
    const response = await windowRef.fetch(SYNC_STATE_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.ok) {
      const payload = await response.json();
      memory = validateSyncStatePayload(payload?.payload ?? null);
      durable = true;
    }
  } catch {
    // Sync continuity is optional for boot. Session memory remains usable.
  }

  let desiredRevision = 0;
  let durableRevision = 0;
  let drainPromise = null;
  let lastPersistError = null;

  const persist = async (payload) => {
    const response = await windowRef.fetch(SYNC_STATE_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
    });
    if (!response.ok) {
      throw new Error(`Native sync state persistence failed: ${response.status}`);
    }
    durable = true;
    return true;
  };

  const drainDesiredPayload = async () => {
    while (durableRevision < desiredRevision) {
      const revision = desiredRevision;
      const payload = memory;
      try {
        await persist(payload);
        durableRevision = Math.max(durableRevision, revision);
        if (revision === desiredRevision) lastPersistError = null;
      } catch (error) {
        if (revision < desiredRevision) continue;
        lastPersistError = error instanceof Error
          ? error
          : new Error("Native sync state persistence failed");
        return false;
      }
    }
    return true;
  };

  const scheduleDrain = () => {
    if (drainPromise !== null) return drainPromise;
    drainPromise = Promise.resolve()
      .then(drainDesiredPayload)
      .finally(() => {
        drainPromise = null;
      });
    return drainPromise;
  };

  const store = {
    schema: SYNC_STATE_STORE_SCHEMA,
    get scope() {
      return durable ? "device" : "session";
    },
    load() {
      return memory;
    },
    save(payload) {
      memory = validateSyncStatePayload(payload);
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
        throw lastPersistError ?? new Error("Native sync state persistence failed");
      }
      return true;
    },
  };

  assertSyncStateStore(store);
  return Object.freeze(store);
}
