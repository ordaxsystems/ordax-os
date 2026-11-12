export const PREFERENCE_STORE_SCHEMA = "ordax.preference-store/1";

const PREFERENCE_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

// Shared record bounds mirror the Native host. Persistence transport is adapter-owned.
export const MAX_PREFERENCE_ENTRIES = 128;
export const MAX_PREFERENCE_STRING_LENGTH = 4096;

function isScalar(value) {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  // Native Python counts Unicode code points rather than UTF-16 code units.
  return typeof value === "string" && Array.from(value).length <= MAX_PREFERENCE_STRING_LENGTH;
}

export function validatePreferenceRecord(value) {
  if (value === undefined || value === null) {
    return Object.freeze({});
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Preference store payload must be an object");
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_PREFERENCE_ENTRIES) {
    throw new TypeError("Preference store record exceeds the entry limit");
  }
  const record = {};
  for (const [preferenceId, preferenceValue] of entries) {
    if (!PREFERENCE_ID.test(preferenceId)) {
      throw new TypeError(`Invalid preference id in store: ${preferenceId}`);
    }
    if (!isScalar(preferenceValue)) {
      throw new TypeError(`Preference store value must be scalar: ${preferenceId}`);
    }
    record[preferenceId] = preferenceValue;
  }
  return Object.freeze(record);
}

export function assertPreferenceStore(store) {
  if (!store || typeof store !== "object") {
    throw new TypeError("Preference store is required");
  }
  if (store.schema !== PREFERENCE_STORE_SCHEMA) {
    throw new TypeError(`Unsupported preference store schema: ${String(store.schema)}`);
  }
  if (typeof store.load !== "function") {
    throw new TypeError("Preference store must implement load()");
  }
  if (typeof store.save !== "function") {
    throw new TypeError("Preference store must implement save(snapshot)");
  }
  return store;
}
