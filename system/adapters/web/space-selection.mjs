import {
  SPACE_SELECTION_SCHEMA,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";

// Web currently has no authenticated Space-selection store/port. Expose an
// explicit non-authoritative unavailable capability instead of silently
// mounting an Assistant without its mandatory context or inventing a Space.
// This is not a second selection store, and never grants inference/actions.
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
