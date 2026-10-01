import {
  PERSONAL_ORDAX_STORE_SCHEMA,
  assertPersonalOrdaxStore,
  personalOrdaxOwnerKey,
  validatePersonalOrdaxOwner,
  validatePersonalOrdaxStoreState,
} from "../../contracts/personal-ordax-store.mjs";

const STORAGE_PREFIX = "ordax.native.personal-ordax.v1.";
const RECORD_SCHEMA = "ordax.native.personal-ordax-record/1";

function resolveStorage(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") {
      return storage;
    }
  } catch {
    // Native browser policy may deny storage; the store remains explicitly session-scoped.
  }
  return null;
}

function storageKey(owner) {
  return `${STORAGE_PREFIX}${encodeURIComponent(personalOrdaxOwnerKey(owner))}`;
}

function parseRecord(raw, owner) {
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    throw new TypeError("Native Personal OrdaX record is not valid JSON");
  }
  if (
    !record
    || typeof record !== "object"
    || Array.isArray(record)
    || Object.keys(record).length !== 2
    || record.schema !== RECORD_SCHEMA
    || !Object.hasOwn(record, "state")
  ) {
    throw new TypeError("Native Personal OrdaX record shape is invalid");
  }
  return validatePersonalOrdaxStoreState(record.state, owner);
}

export function createNativePersonalOrdaxStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  const sessionStates = new Map();
  const blockedOwners = new Set();

  const store = {
    schema: PERSONAL_ORDAX_STORE_SCHEMA,
    scope: storage ? "device" : "session",
    load(ownerValue) {
      const owner = validatePersonalOrdaxOwner(ownerValue);
      const ownerKey = personalOrdaxOwnerKey(owner);
      if (!storage) return sessionStates.get(ownerKey) ?? null;
      if (blockedOwners.has(ownerKey)) {
        throw new Error("Native Personal OrdaX owner partition requires recovery");
      }

      const key = storageKey(owner);
      let raw;
      try {
        raw = storage.getItem(key);
      } catch {
        throw new Error("Native Personal OrdaX owner partition is unreadable");
      }
      if (raw === null) return null;

      try {
        return parseRecord(raw, owner);
      } catch (error) {
        blockedOwners.add(ownerKey);
        throw error;
      }
    },
    save(ownerValue, stateValue) {
      const owner = validatePersonalOrdaxOwner(ownerValue);
      const state = validatePersonalOrdaxStoreState(stateValue, owner);
      const ownerKey = personalOrdaxOwnerKey(owner);

      if (!storage) {
        sessionStates.set(ownerKey, state);
        return true;
      }
      if (blockedOwners.has(ownerKey)) {
        throw new Error("Native Personal OrdaX owner partition requires recovery");
      }

      try {
        storage.setItem(
          storageKey(owner),
          JSON.stringify({ schema: RECORD_SCHEMA, state }),
        );
        return true;
      } catch {
        return false;
      }
    },
  };

  assertPersonalOrdaxStore(store);
  return Object.freeze(store);
}
