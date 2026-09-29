import {
  SYNC_STATE_STORE_SCHEMA,
  assertSyncStateStorePort,
  validateSyncStatePayload,
} from "../../contracts/sync-state-store.mjs";

export const SYNC_STATE_CONTAINER_SCHEMA = "ordax.sync-state-container/1";
export const MAX_SYNC_STATE_NAMESPACES = 16;

const NAMESPACE_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

function validateNamespace(value) {
  if (typeof value !== "string" || !NAMESPACE_RE.test(value)) {
    throw new TypeError("Sync-state namespace is invalid");
  }
  return value;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function decodeContainer(payload, legacyNamespace) {
  const raw = validateSyncStatePayload(payload);
  if (raw === null) return new Map();

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    if (legacyNamespace === null) {
      throw new TypeError("Sync-state root payload is not a compatible container");
    }
    return new Map([[legacyNamespace, raw]]);
  }

  if (value?.$schema !== SYNC_STATE_CONTAINER_SCHEMA) {
    if (legacyNamespace === null) return new Map([["__invalid__", raw]]);
    return new Map([[legacyNamespace, raw]]);
  }
  if (!exactKeys(value, ["$schema", "slots"]) || !value.slots || typeof value.slots !== "object" || Array.isArray(value.slots)) {
    throw new TypeError("Sync-state container fields are incompatible");
  }

  const entries = Object.entries(value.slots);
  if (entries.length > MAX_SYNC_STATE_NAMESPACES) {
    throw new TypeError("Sync-state container has too many namespaces");
  }
  const slots = new Map();
  for (const [namespace, slotPayload] of entries) {
    validateNamespace(namespace);
    if (slots.has(namespace)) throw new TypeError("Duplicate sync-state namespace");
    slots.set(namespace, validateSyncStatePayload(slotPayload));
  }
  return slots;
}

function encodeContainer(slots) {
  if (slots.size > MAX_SYNC_STATE_NAMESPACES) {
    throw new TypeError("Sync-state container has too many namespaces");
  }
  const ordered = {};
  for (const [namespace, payload] of [...slots.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    validateNamespace(namespace);
    ordered[namespace] = validateSyncStatePayload(payload);
  }
  return validateSyncStatePayload(JSON.stringify({
    $schema: SYNC_STATE_CONTAINER_SCHEMA,
    slots: ordered,
  }));
}

export function createSyncStateNamespaceRegistry(rootStore, { legacyNamespace = null } = {}) {
  const root = assertSyncStateStorePort(rootStore);
  const legacy = legacyNamespace === null ? null : validateNamespace(legacyNamespace);
  const stores = new Map();

  const loadSlots = () => {
    const slots = decodeContainer(root.load(), legacy);
    if (slots.has("__invalid__")) {
      throw new TypeError("Sync-state root payload schema is incompatible");
    }
    return slots;
  };

  const open = (namespace) => {
    const id = validateNamespace(namespace);
    if (stores.has(id)) return stores.get(id);

    const store = Object.freeze({
      schema: SYNC_STATE_STORE_SCHEMA,
      scope: root.scope,
      load() {
        return loadSlots().get(id) ?? null;
      },
      save(payload) {
        const validated = validateSyncStatePayload(payload);
        const slots = loadSlots();
        if (validated === null) slots.delete(id);
        else slots.set(id, validated);
        return root.save(encodeContainer(slots));
      },
    });
    assertSyncStateStorePort(store);
    stores.set(id, store);
    return store;
  };

  return Object.freeze({
    schema: SYNC_STATE_CONTAINER_SCHEMA,
    scope: root.scope,
    legacyNamespace: legacy,
    open,
  });
}
