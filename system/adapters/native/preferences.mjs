import {
  PREFERENCE_STORE_SCHEMA,
  assertPreferenceStore,
  validatePreferenceRecord,
} from "../../contracts/preference-store.mjs";

const PREFERENCES_ENDPOINT = "/__ordax/native/preferences";

export async function createNativePreferenceStore(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native preference store requires window.fetch");
  }

  let memory = validatePreferenceRecord({});
  try {
    const response = await windowRef.fetch(PREFERENCES_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.ok) {
      memory = validatePreferenceRecord(await response.json());
    }
  } catch {
    // Persistent preference state is optional for boot. The Surface keeps a
    // valid in-memory snapshot if the local host state endpoint is unavailable.
  }

  let persistQueue = Promise.resolve();
  const persist = async (snapshot) => {
    const response = await windowRef.fetch(PREFERENCES_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    if (!response.ok) {
      throw new Error(`Native preference persistence failed: ${response.status}`);
    }
  };

  const store = {
    schema: PREFERENCE_STORE_SCHEMA,
    load() {
      return memory;
    },
    save(snapshot) {
      const validated = validatePreferenceRecord(snapshot);
      memory = validated;
      // A queued write is not durable until the loopback host acknowledges POST.
      // Keep the last valid session snapshot even if the host rejects the write.
      const confirmation = persistQueue
        .then(() => persist(validated))
        .then(() => true, () => false);
      // Failure must not poison subsequent writes; each write remains serialized.
      persistQueue = confirmation;
      return confirmation;
    },
  };

  assertPreferenceStore(store);
  return Object.freeze(store);
}
