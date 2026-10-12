import {
  SPACE_SELECTION_SCHEMA,
  SPACE_SELECTION_STORE_SCHEMA,
  assertSpaceSelectionStore,
  validateSpaceSelectionRecord,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";

// Unconfigured hosts still expose an explicit unavailable selection port.
// Authenticated composition uses the session-only store below with the existing
// selection service. Neither adapter grants inference/actions.
export function createUnavailableWebSpaceSelection() {
  const snapshot = validateSpaceSelectionSnapshot({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unavailable",
    subjectId: null,
    selectedSpace: null,
  });
  return Object.freeze({
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Space selection listener must be a function");
      }
      listener(snapshot);
      return () => {};
    },
    select() {
      throw new Error("Space selection is not available in the Web composition");
    },
    clear() {
      return snapshot;
    },
  });
}

// Session-only adapter. Membership checks and selection lifecycle belong to the
// canonical selection service; this stores no credentials, catalog or grants.
export function createWebSpaceSelectionStore() {
  let record = null;
  const store = {
    schema: SPACE_SELECTION_STORE_SCHEMA,
    load: () => record,
    save(value) {
      const validated = validateSpaceSelectionRecord(value);
      if (validated === null) throw new TypeError("Space selection cannot save an empty record");
      record = validated;
      return false; // No durable or cloud persistence is advertised.
    },
    clear() { record = null; return false; },
  };
  assertSpaceSelectionStore(store);
  return Object.freeze(store);
}
