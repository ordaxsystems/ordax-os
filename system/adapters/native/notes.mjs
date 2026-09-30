import {
  NOTES_STORE_SCHEMA,
  assertNotesStore,
  validateNotesSnapshot,
} from "../../contracts/notes-store.mjs";

const NOTES_ENDPOINT = "/__ordax/native/notes";

export async function createNativeNotesStore(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native notes store requires window.fetch");
  }

  let memory = null;
  const response = await windowRef.fetch(NOTES_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Native notes persistence unavailable: ${response.status}`);
  const initial = await response.json();
  if (initial?.payload !== null && initial?.payload !== undefined) {
    memory = validateNotesSnapshot(JSON.parse(initial.payload));
  }

  let desiredRevision = 0;
  let durableRevision = 0;
  let persistQueue = null;
  let lastPersistError = null;

  const persist = async (snapshot) => {
    const next = await windowRef.fetch(NOTES_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: JSON.stringify(snapshot) }),
    });
    if (!next.ok) throw new Error(`Native notes persistence failed: ${next.status}`);
    return true;
  };

  const drainDesiredSnapshot = async () => {
    while (durableRevision < desiredRevision) {
      const revision = desiredRevision;
      const snapshot = memory;
      try {
        await persist(snapshot);
        durableRevision = Math.max(durableRevision, revision);
        if (revision === desiredRevision) lastPersistError = null;
      } catch (error) {
        if (revision < desiredRevision) continue;
        lastPersistError = error instanceof Error
          ? error
          : new Error("Native notes persistence failed");
        return false;
      }
    }
    return true;
  };

  const scheduleDrain = () => {
    if (persistQueue !== null) return persistQueue;
    // Collapse a synchronous burst of edits into the newest snapshot while
    // preserving a revision boundary that flush() can prove durable.
    persistQueue = Promise.resolve()
      .then(drainDesiredSnapshot)
      .finally(() => {
        persistQueue = null;
      });
    return persistQueue;
  };

  const store = {
    schema: NOTES_STORE_SCHEMA,
    scope: "device",
    load() {
      return memory;
    },
    save(snapshot) {
      const validated = validateNotesSnapshot(snapshot);
      memory = validated;
      desiredRevision += 1;
      scheduleDrain();
      return true;
    },
    async flush() {
      const targetRevision = desiredRevision;
      if (durableRevision >= targetRevision) return true;

      await scheduleDrain();
      if (durableRevision >= targetRevision) return true;

      // Retry only the newest desired snapshot once. An obsolete failed write
      // must never force stale data back over a newer note revision.
      await scheduleDrain();
      if (durableRevision < targetRevision) {
        throw lastPersistError ?? new Error("Native notes persistence failed");
      }
      return true;
    },
  };

  assertNotesStore(store);
  return Object.freeze(store);
}
