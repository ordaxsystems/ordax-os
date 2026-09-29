import { validateSpace } from "./spaces.mjs";

export const SPACE_SELECTION_SCHEMA = "ordax.space-selection/1";
export const SPACE_SELECTION_STORE_SCHEMA = "ordax.space-selection-store/1";
export const SPACE_SELECTION_RECORD_SCHEMA = "ordax.space-selection-record/1";

const STATES = new Set(["unavailable", "unselected", "selected"]);
const MAX_ID = 160;

function boundedId(value, label) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_ID) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

export function validateSpaceSelectionRecord(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Space selection record must be an object");
  }
  if (
    value.schema !== SPACE_SELECTION_RECORD_SCHEMA
    || Object.keys(value).sort().join(",") !== "schema,selectedSpaceId,subjectId"
  ) {
    throw new TypeError("Space selection record schema/fields are incompatible");
  }
  return Object.freeze({
    schema: SPACE_SELECTION_RECORD_SCHEMA,
    subjectId: boundedId(value.subjectId, "Space selection subject id"),
    selectedSpaceId: boundedId(value.selectedSpaceId, "Selected Space id"),
  });
}

export function validateSpaceSelectionSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Space selection snapshot must be an object");
  }
  if (value.schema !== SPACE_SELECTION_SCHEMA || !STATES.has(value.state)) {
    throw new TypeError("Space selection snapshot schema/state is incompatible");
  }

  if (value.state === "unavailable") {
    if (value.subjectId != null || value.selectedSpace != null) {
      throw new TypeError("Unavailable Space selection cannot expose identity or Space");
    }
    return Object.freeze({
      schema: SPACE_SELECTION_SCHEMA,
      state: "unavailable",
      subjectId: null,
      selectedSpace: null,
    });
  }

  const subjectId = boundedId(value.subjectId, "Space selection subject id");
  if (value.state === "unselected") {
    if (value.selectedSpace != null) {
      throw new TypeError("Unselected Space selection cannot expose a Space");
    }
    return Object.freeze({
      schema: SPACE_SELECTION_SCHEMA,
      state: "unselected",
      subjectId,
      selectedSpace: null,
    });
  }

  const selectedSpace = validateSpace(value.selectedSpace);
  if (selectedSpace.state !== "active") {
    throw new TypeError("Selected Space must be active");
  }
  return Object.freeze({
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId,
    selectedSpace,
  });
}

export function assertSpaceSelectionStore(store) {
  if (!store || typeof store !== "object" || store.schema !== SPACE_SELECTION_STORE_SCHEMA) {
    throw new TypeError("Compatible Space selection store is required");
  }
  for (const method of ["load", "save", "clear"]) {
    if (typeof store[method] !== "function") {
      throw new TypeError(`Space selection store must implement ${method}()`);
    }
  }
  validateSpaceSelectionRecord(store.load());
  return store;
}

export function assertSpaceSelectionPort(port) {
  if (!port || typeof port !== "object" || port.schema !== SPACE_SELECTION_SCHEMA) {
    throw new TypeError("Compatible Space selection port is required");
  }
  for (const method of ["getSnapshot", "subscribe", "select", "clear"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Space selection port must implement ${method}()`);
    }
  }
  validateSpaceSelectionSnapshot(port.getSnapshot());
  return port;
}
