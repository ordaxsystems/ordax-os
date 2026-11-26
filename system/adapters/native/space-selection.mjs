import {
  SPACE_SELECTION_STORE_SCHEMA,
  assertSpaceSelectionStore,
  validateSpaceSelectionRecord,
  validateNativeSpaceSelectionEnvelope,
} from "../../contracts/space-selection.mjs";

const SPACE_SELECTION_ENDPOINT = "/__ordax/native/space-selection";

// A Native app must not bind a selected Space to localStorage: the loopback
// port is ephemeral, so each healthy Desktop restart changes the web origin.
// The existing Native host owns this device-local record with the same
// Electron-granted state authorization as preferences and First Run.
export async function createNativeSpaceSelectionStore(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native Space selection store requires window.fetch");
  }
  let memory = null;
  let durableAvailable = false;
  try {
    const result = await windowRef.fetch(SPACE_SELECTION_ENDPOINT, {
      method: "GET", cache: "no-store", credentials: "same-origin",
    });
    if (!result.ok) throw new Error("Native Space selection receipt unavailable");
    memory = validateNativeSpaceSelectionEnvelope(await result.json()).record;
    durableAvailable = true;
  } catch {
    // The offline Surface must boot even when the optional local receipt
    // cannot be verified. This session starts unselected, never authorized.
    memory = null;
  }

  let writeQueue = Promise.resolve();
  const enqueue = (record) => {
    if (!durableAvailable) return false;
    const envelope = validateNativeSpaceSelectionEnvelope({ record });
    const write = writeQueue.then(async () => {
      const result = await windowRef.fetch(SPACE_SELECTION_ENDPOINT, {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      });
      if (!result.ok) throw new Error("Native Space selection persistence rejected");
      const confirmed = validateNativeSpaceSelectionEnvelope(await result.json());
      if (confirmed.record?.subjectId !== envelope.record?.subjectId
          || confirmed.record?.selectedSpaceId !== envelope.record?.selectedSpaceId) {
        throw new Error("Native Space selection persistence receipt mismatched");
      }
      return true;
    });
    // A rejected write does not poison later explicit selections. Report the
    // failure; an in-memory selection is not claimed to be durable.
    writeQueue = write.catch((error) => {
      console.warn("Native Space selection persistence remains unavailable", error);
      return false;
    });
    return true;
  };

  const store = Object.freeze({
    schema: SPACE_SELECTION_STORE_SCHEMA,
    load() { return memory; },
    save(record) {
      const valid = validateSpaceSelectionRecord(record);
      if (valid === null) throw new TypeError("Space selection requires a record");
      memory = valid;
      return enqueue(valid);
    },
    clear() {
      memory = null;
      return enqueue(null);
    },
    // Read-only confirmation for supervised persistence tests and diagnostics.
    settled() { return writeQueue; },
  });
  assertSpaceSelectionStore(store);
  return store;
}
