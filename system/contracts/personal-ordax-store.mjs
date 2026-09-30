import {
  validatePersonalActivityEvent,
  validatePersonalWorkItem,
} from "./personal-ordax.mjs";

export const PERSONAL_ORDAX_STORE_SCHEMA = "ordax.personal-work-store/1";
export const PERSONAL_ORDAX_STORE_STATE_SCHEMA = "ordax.personal-work-store-state/1";
export const PERSONAL_ORDAX_RUNTIME_SCHEMA = "ordax.personal-runtime/1";
export const MAX_PERSONAL_WORK_ITEMS = 32;
export const MAX_PERSONAL_ACTIVITY_EVENTS = 512;

const STORE_SCOPES = new Set(["device", "session"]);

function validateNextOrdinal(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Personal OrdaX next ordinal must be a positive safe integer");
  }
  return value;
}

export function createEmptyPersonalOrdaxStoreState() {
  return Object.freeze({
    schema: PERSONAL_ORDAX_STORE_STATE_SCHEMA,
    nextOrdinal: 1,
    workItems: Object.freeze([]),
    activities: Object.freeze([]),
  });
}

export function validatePersonalOrdaxStoreState(value) {
  if (value === null || value === undefined) return createEmptyPersonalOrdaxStoreState();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal OrdaX store state must be an object");
  }
  if (value.schema !== PERSONAL_ORDAX_STORE_STATE_SCHEMA) {
    throw new TypeError("Personal OrdaX store state schema is incompatible");
  }
  if (!Array.isArray(value.workItems) || value.workItems.length > MAX_PERSONAL_WORK_ITEMS) {
    throw new TypeError("Personal OrdaX work items exceed their bound");
  }
  if (!Array.isArray(value.activities) || value.activities.length > MAX_PERSONAL_ACTIVITY_EVENTS) {
    throw new TypeError("Personal OrdaX activity events exceed their bound");
  }

  const workItems = Object.freeze(value.workItems.map(validatePersonalWorkItem));
  const workIds = new Set(workItems.map((item) => item.id));
  if (workIds.size !== workItems.length) {
    throw new TypeError("Personal OrdaX work ids must be unique");
  }

  const activities = Object.freeze(value.activities.map(validatePersonalActivityEvent));
  const lastSequence = new Map();
  for (const event of activities) {
    if (!workIds.has(event.workItemId)) {
      throw new TypeError("Personal OrdaX activity cannot reference missing work");
    }
    const previous = lastSequence.get(event.workItemId) ?? 0;
    if (event.sequence <= previous) {
      throw new TypeError("Personal OrdaX activity sequence must increase per work item");
    }
    lastSequence.set(event.workItemId, event.sequence);
  }

  return Object.freeze({
    schema: PERSONAL_ORDAX_STORE_STATE_SCHEMA,
    nextOrdinal: validateNextOrdinal(value.nextOrdinal),
    workItems,
    activities,
  });
}

export function assertPersonalOrdaxStore(store) {
  if (!store || typeof store !== "object" || store.schema !== PERSONAL_ORDAX_STORE_SCHEMA) {
    throw new TypeError("A compatible Personal OrdaX store is required");
  }
  if (!STORE_SCOPES.has(store.scope)) {
    throw new TypeError("Personal OrdaX store scope must be device or session");
  }
  for (const method of ["load", "save"]) {
    if (typeof store[method] !== "function") {
      throw new TypeError(`Personal OrdaX store must implement ${method}()`);
    }
  }
  validatePersonalOrdaxStoreState(store.load());
  return store;
}

export function validatePersonalOrdaxRuntimeSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal OrdaX runtime snapshot must be an object");
  }
  if (value.schema !== PERSONAL_ORDAX_RUNTIME_SCHEMA) {
    throw new TypeError("Personal OrdaX runtime snapshot schema is incompatible");
  }
  if (!STORE_SCOPES.has(value.persistence)) {
    throw new TypeError("Personal OrdaX runtime persistence is invalid");
  }
  const state = validatePersonalOrdaxStoreState({
    schema: PERSONAL_ORDAX_STORE_STATE_SCHEMA,
    nextOrdinal: value.nextOrdinal,
    workItems: value.workItems,
    activities: value.activities,
  });
  return Object.freeze({
    schema: PERSONAL_ORDAX_RUNTIME_SCHEMA,
    persistence: value.persistence,
    nextOrdinal: state.nextOrdinal,
    workItems: state.workItems,
    activities: state.activities,
  });
}
