import {
  SYNC_STATE_STORE_SCHEMA,
  assertSyncStateStorePort,
  validateSyncStatePayload,
} from "../../contracts/sync-state-store.mjs";

export const SYNC_STATE_CONTAINER_SCHEMA = "ordax.sync-state-container/1";
export const MAX_SYNC_STATE_NAMESPACES = 16;

const LOGICAL_NAMESPACE_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const SLOT_KEY_RE = /^[A-Za-z0-9._-]{1,320}$/;
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const encoder = new TextEncoder();

function validateLogicalNamespace(value) {
  if (typeof value !== "string" || !LOGICAL_NAMESPACE_RE.test(value)) {
    throw new TypeError("Sync-state namespace is invalid");
  }
  return value;
}

function validatePartitionKey(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 200) {
    throw new TypeError("Sync-state partition key is invalid");
  }
  return value;
}

function base64UrlUtf8(value) {
  const bytes = encoder.encode(value);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const hasB = index + 1 < bytes.length;
    const hasC = index + 2 < bytes.length;
    const b = hasB ? bytes[index + 1] : 0;
    const c = hasC ? bytes[index + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    output += BASE64URL[(triple >>> 18) & 63];
    output += BASE64URL[(triple >>> 12) & 63];
    if (hasB) output += BASE64URL[(triple >>> 6) & 63];
    if (hasC) output += BASE64URL[triple & 63];
  }
  return output;
}

function slotKey(namespace, partitionKey = null) {
  const logical = validateLogicalNamespace(namespace);
  const key = partitionKey === null
    ? logical
    : `${logical}.p.${base64UrlUtf8(validatePartitionKey(partitionKey))}`;
  if (!SLOT_KEY_RE.test(key)) {
    throw new TypeError("Sync-state slot key is invalid");
  }
  return key;
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
    return new Map([[slotKey(legacyNamespace), raw]]);
  }

  if (value?.$schema !== SYNC_STATE_CONTAINER_SCHEMA) {
    if (legacyNamespace === null) {
      throw new TypeError("Sync-state root payload schema is incompatible");
    }
    return new Map([[slotKey(legacyNamespace), raw]]);
  }
  if (!exactKeys(value, ["$schema", "slots"]) || !value.slots || typeof value.slots !== "object" || Array.isArray(value.slots)) {
    throw new TypeError("Sync-state container fields are incompatible");
  }

  const entries = Object.entries(value.slots);
  if (entries.length > MAX_SYNC_STATE_NAMESPACES) {
    throw new TypeError("Sync-state container has too many slots");
  }
  const slots = new Map();
  for (const [key, slotPayload] of entries) {
    if (!SLOT_KEY_RE.test(key)) throw new TypeError("Sync-state container slot key is invalid");
    if (slots.has(key)) throw new TypeError("Duplicate sync-state slot");
    slots.set(key, validateSyncStatePayload(slotPayload));
  }
  return slots;
}

function encodeContainer(slots) {
  if (slots.size > MAX_SYNC_STATE_NAMESPACES) {
    throw new TypeError("Sync-state container has too many slots");
  }
  const ordered = {};
  for (const [key, payload] of [...slots.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!SLOT_KEY_RE.test(key)) throw new TypeError("Sync-state container slot key is invalid");
    ordered[key] = validateSyncStatePayload(payload);
  }
  return validateSyncStatePayload(JSON.stringify({
    $schema: SYNC_STATE_CONTAINER_SCHEMA,
    slots: ordered,
  }));
}

export function createSyncStateNamespaceRegistry(rootStore, { legacyNamespace = null } = {}) {
  const root = assertSyncStateStorePort(rootStore);
  const legacy = legacyNamespace === null ? null : validateLogicalNamespace(legacyNamespace);
  const stores = new Map();

  const loadSlots = () => decodeContainer(root.load(), legacy);

  const open = (namespace, { partitionKey = null } = {}) => {
    const key = slotKey(namespace, partitionKey);
    if (stores.has(key)) return stores.get(key);

    const store = Object.freeze({
      schema: SYNC_STATE_STORE_SCHEMA,
      get scope() {
        return root.scope;
      },
      load() {
        return loadSlots().get(key) ?? null;
      },
      save(payload) {
        const validated = validateSyncStatePayload(payload);
        const slots = loadSlots();
        if (validated === null) slots.delete(key);
        else slots.set(key, validated);
        return root.save(encodeContainer(slots));
      },
      async flush() {
        if (typeof root.flush !== "function") return true;
        return root.flush();
      },
    });
    assertSyncStateStorePort(store);
    stores.set(key, store);
    return store;
  };

  return Object.freeze({
    schema: SYNC_STATE_CONTAINER_SCHEMA,
    get scope() {
      return root.scope;
    },
    legacyNamespace: legacy,
    open,
  });
}
