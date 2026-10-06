import {
  MAX_APP_DATA_PARTITION_BYTES,
  MAX_APP_DATA_PARTITION_KEYS,
  MAX_APP_DATA_VALUE_BYTES,
  validateAppDataDelete,
  validateAppDataIdentity,
  validateAppDataKey,
  validateAppDataPut,
} from "../../contracts/app-data.mjs";
import { AppDataConflictError } from "../../services/app-data/runtime.mjs";

const WEB_APP_DATA_SCHEMA = "ordax.web-app-data-partition/1";
const STORAGE_PREFIX = "ordax.web-app-data.v1";
const LOCK_PREFIX = "ordax.web-app-data.lock.v1";
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function boundedInteger(value, label, { min = 1, max } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return value;
}

function storageObject(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (
      storage
      && typeof storage.getItem === "function"
      && typeof storage.setItem === "function"
      && typeof storage.removeItem === "function"
    ) {
      return storage;
    }
  } catch {
    // Fall through to a hard failure. Device scope must never silently become session memory.
  }
  throw new Error("Web App Data requires durable localStorage");
}

function lockObject(windowRef) {
  const locks = windowRef?.navigator?.locks;
  if (!locks || typeof locks.request !== "function") {
    throw new Error("Web App Data requires Web Locks for atomic mutations");
  }
  return locks;
}

function identitySuffix(identity) {
  return [
    encodeURIComponent(identity.publisherId),
    encodeURIComponent(identity.appId),
    encodeURIComponent(identity.ownerScope),
  ].join(":");
}

function partitionStorageKey(identity) {
  return `${STORAGE_PREFIX}:${identitySuffix(identity)}`;
}

function partitionLockName(identity) {
  return `${LOCK_PREFIX}:${identitySuffix(identity)}`;
}

function bytesToBase64(bytes) {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const packed = (a << 16) | (b << 8) | c;
    result += BASE64_ALPHABET[(packed >> 18) & 63];
    result += BASE64_ALPHABET[(packed >> 12) & 63];
    result += index + 1 < bytes.length ? BASE64_ALPHABET[(packed >> 6) & 63] : "=";
    result += index + 2 < bytes.length ? BASE64_ALPHABET[packed & 63] : "=";
  }
  return result;
}

function base64Value(value) {
  if (
    typeof value !== "string"
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new TypeError("Web App Data value encoding is invalid");
  }
  const outputLength = value.length === 0
    ? 0
    : (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
  const bytes = new Uint8Array(outputLength);
  let offset = 0;
  for (let index = 0; index < value.length; index += 4) {
    const chars = value.slice(index, index + 4);
    const numbers = [...chars].map((char) => char === "=" ? 0 : BASE64_ALPHABET.indexOf(char));
    if (numbers.some((item) => item < 0)) {
      throw new TypeError("Web App Data value encoding is invalid");
    }
    const packed = (numbers[0] << 18) | (numbers[1] << 12) | (numbers[2] << 6) | numbers[3];
    if (offset < bytes.length) bytes[offset++] = (packed >> 16) & 255;
    if (offset < bytes.length) bytes[offset++] = (packed >> 8) & 255;
    if (offset < bytes.length) bytes[offset++] = packed & 255;
  }
  if (bytesToBase64(bytes) !== value) {
    throw new TypeError("Web App Data value encoding is non-canonical");
  }
  return bytes;
}

function emptyPartition() {
  return {
    $schema: WEB_APP_DATA_SCHEMA,
    revision: 0,
    entries: new Map(),
    bytesUsed: 0,
  };
}

function readPartition(storage, identity, quotaBytes, maxKeys) {
  const raw = storage.getItem(partitionStorageKey(identity));
  if (raw === null) return emptyPartition();

  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new TypeError("Web App Data partition is invalid JSON", { cause: error });
  }
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.$schema !== WEB_APP_DATA_SCHEMA
    || !Number.isSafeInteger(value.revision)
    || value.revision < 0
    || !value.entries
    || typeof value.entries !== "object"
    || Array.isArray(value.entries)
    || Object.keys(value).sort().join(",") !== "$schema,entries,revision"
  ) {
    throw new TypeError("Web App Data partition is incompatible");
  }

  const rawEntries = Object.entries(value.entries);
  if (rawEntries.length > maxKeys) {
    throw new RangeError("Web App Data persisted partition exceeds key quota");
  }

  const entries = new Map();
  let bytesUsed = 0;
  for (const [rawKey, encoded] of rawEntries) {
    const key = validateAppDataKey(rawKey);
    const bytes = base64Value(encoded);
    if (bytes.byteLength > MAX_APP_DATA_VALUE_BYTES) {
      throw new RangeError("Web App Data persisted value exceeds hard bound");
    }
    bytesUsed += bytes.byteLength;
    if (bytesUsed > quotaBytes) {
      throw new RangeError("Web App Data persisted partition exceeds byte quota");
    }
    entries.set(key, bytes);
  }
  return {
    $schema: WEB_APP_DATA_SCHEMA,
    revision: value.revision,
    entries,
    bytesUsed,
  };
}

function writePartition(storage, identity, partition) {
  const entries = {};
  for (const [key, bytes] of [...partition.entries.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    entries[key] = bytesToBase64(bytes);
  }
  storage.setItem(
    partitionStorageKey(identity),
    JSON.stringify({
      $schema: WEB_APP_DATA_SCHEMA,
      revision: partition.revision,
      entries,
    }),
  );
}

function cloneEntry(value) {
  return value === undefined ? null : new Uint8Array(value);
}

export function createWebAppDataStore({
  windowRef = globalThis.window,
  quotaBytes = 8 * 1024 * 1024,
  maxKeys = 1024,
} = {}) {
  const storage = storageObject(windowRef);
  const locks = lockObject(windowRef);
  const quota = boundedInteger(quotaBytes, "Web App Data quotaBytes", {
    max: MAX_APP_DATA_PARTITION_BYTES,
  });
  const keyLimit = boundedInteger(maxKeys, "Web App Data maxKeys", {
    max: MAX_APP_DATA_PARTITION_KEYS,
  });

  const snapshot = (rawIdentity) => {
    const identity = validateAppDataIdentity(rawIdentity);
    return { identity, state: readPartition(storage, identity, quota, keyLimit) };
  };

  const mutate = async (rawIdentity, callback) => {
    const identity = validateAppDataIdentity(rawIdentity);
    return await locks.request(
      partitionLockName(identity),
      { mode: "exclusive" },
      async () => await callback(identity, readPartition(storage, identity, quota, keyLimit)),
    );
  };

  const assertRevision = (state, expectedRevision) => {
    if (state.revision !== expectedRevision) {
      throw new AppDataConflictError(expectedRevision, state.revision);
    }
  };

  return Object.freeze({
    async get(rawIdentity, rawKey) {
      const { state } = snapshot(rawIdentity);
      const key = validateAppDataKey(rawKey);
      const value = cloneEntry(state.entries.get(key));
      return Object.freeze({
        revision: state.revision,
        found: value !== null,
        key,
        value,
      });
    },

    async list(rawIdentity) {
      const { state } = snapshot(rawIdentity);
      return Object.freeze({
        revision: state.revision,
        keys: Object.freeze([...state.entries.keys()].sort()),
        bytesUsed: state.bytesUsed,
        quotaBytes: quota,
        maxKeys: keyLimit,
      });
    },

    async put(rawIdentity, rawCommand) {
      const command = validateAppDataPut(rawCommand);
      return await mutate(rawIdentity, async (identity, state) => {
        assertRevision(state, command.expectedRevision);

        const previous = state.entries.get(command.key);
        if (previous === undefined && state.entries.size >= keyLimit) {
          throw new RangeError("Web App Data partition key quota exceeded");
        }
        const bytesUsed = state.bytesUsed - (previous?.byteLength ?? 0) + command.value.byteLength;
        if (bytesUsed > quota) {
          throw new RangeError("Web App Data partition byte quota exceeded");
        }
        if (state.revision >= Number.MAX_SAFE_INTEGER) {
          throw new RangeError("Web App Data partition revision is exhausted");
        }

        const next = {
          $schema: WEB_APP_DATA_SCHEMA,
          revision: state.revision + 1,
          entries: new Map(state.entries),
          bytesUsed,
        };
        next.entries.set(command.key, new Uint8Array(command.value));
        writePartition(storage, identity, next);
        return Object.freeze({ revision: next.revision, stored: true });
      });
    },

    async delete(rawIdentity, rawCommand) {
      const command = validateAppDataDelete(rawCommand);
      return await mutate(rawIdentity, async (identity, state) => {
        assertRevision(state, command.expectedRevision);
        const previous = state.entries.get(command.key);
        if (previous === undefined) {
          return Object.freeze({ revision: state.revision, deleted: false });
        }
        if (state.revision >= Number.MAX_SAFE_INTEGER) {
          throw new RangeError("Web App Data partition revision is exhausted");
        }

        const next = {
          $schema: WEB_APP_DATA_SCHEMA,
          revision: state.revision + 1,
          entries: new Map(state.entries),
          bytesUsed: state.bytesUsed - previous.byteLength,
        };
        next.entries.delete(command.key);
        writePartition(storage, identity, next);
        return Object.freeze({ revision: next.revision, deleted: true });
      });
    },
  });
}
