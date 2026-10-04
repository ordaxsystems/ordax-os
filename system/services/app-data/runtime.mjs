import {
  APP_DATA_OWNER_SCOPE,
  APP_DATA_SCHEMA,
  MAX_APP_DATA_PARTITION_BYTES,
  MAX_APP_DATA_PARTITION_KEYS,
  assertAppDataPort,
  validateAppDataDelete,
  validateAppDataIdentity,
  validateAppDataKey,
  validateAppDataPut,
} from "../../contracts/app-data.mjs";

export class AppDataConflictError extends Error {
  constructor(expectedRevision, actualRevision) {
    super(`App Data revision conflict: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = "AppDataConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function boundedInteger(value, label, { min = 1, max } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return value;
}

function partitionKey(identity) {
  return `${identity.publisherId}\u0000${identity.appId}\u0000${identity.ownerScope}`;
}

function cloneEntry(entry) {
  if (!entry) return null;
  return Object.freeze({
    key: entry.key,
    value: new Uint8Array(entry.value),
  });
}

function ensureNextRevision(partition) {
  if (partition.revision >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("App Data partition revision is exhausted");
  }
  return partition.revision + 1;
}

export function createInMemoryAppDataStore({
  quotaBytes = 8 * 1024 * 1024,
  maxKeys = 1024,
} = {}) {
  const quota = boundedInteger(quotaBytes, "App Data quotaBytes", {
    max: MAX_APP_DATA_PARTITION_BYTES,
  });
  const keyLimit = boundedInteger(maxKeys, "App Data maxKeys", {
    max: MAX_APP_DATA_PARTITION_KEYS,
  });
  const partitions = new Map();

  const getPartition = (rawIdentity) => {
    const identity = validateAppDataIdentity(rawIdentity);
    const id = partitionKey(identity);
    let partition = partitions.get(id);
    if (!partition) {
      partition = {
        identity,
        revision: 0,
        bytesUsed: 0,
        entries: new Map(),
      };
      partitions.set(id, partition);
    }
    return partition;
  };

  const assertRevision = (partition, expectedRevision) => {
    if (partition.revision !== expectedRevision) {
      throw new AppDataConflictError(expectedRevision, partition.revision);
    }
  };

  return Object.freeze({
    async get(rawIdentity, rawKey) {
      const partition = getPartition(rawIdentity);
      const key = validateAppDataKey(rawKey);
      const entry = cloneEntry(partition.entries.get(key));
      return Object.freeze({
        revision: partition.revision,
        found: entry !== null,
        key,
        value: entry?.value ?? null,
      });
    },

    async list(rawIdentity) {
      const partition = getPartition(rawIdentity);
      return Object.freeze({
        revision: partition.revision,
        keys: Object.freeze([...partition.entries.keys()].sort()),
        bytesUsed: partition.bytesUsed,
        quotaBytes: quota,
        maxKeys: keyLimit,
      });
    },

    async put(rawIdentity, rawCommand) {
      const partition = getPartition(rawIdentity);
      const command = validateAppDataPut(rawCommand);
      assertRevision(partition, command.expectedRevision);

      const previous = partition.entries.get(command.key) ?? null;
      if (!previous && partition.entries.size >= keyLimit) {
        throw new RangeError("App Data partition key quota exceeded");
      }
      const nextBytes = partition.bytesUsed - (previous?.value.byteLength ?? 0) + command.value.byteLength;
      if (nextBytes > quota) {
        throw new RangeError("App Data partition byte quota exceeded");
      }

      const revision = ensureNextRevision(partition);
      partition.entries.set(command.key, {
        key: command.key,
        value: new Uint8Array(command.value),
      });
      partition.bytesUsed = nextBytes;
      partition.revision = revision;
      return Object.freeze({ revision, stored: true });
    },

    async delete(rawIdentity, rawCommand) {
      const partition = getPartition(rawIdentity);
      const command = validateAppDataDelete(rawCommand);
      assertRevision(partition, command.expectedRevision);
      const previous = partition.entries.get(command.key) ?? null;
      if (!previous) {
        return Object.freeze({ revision: partition.revision, deleted: false });
      }

      const revision = ensureNextRevision(partition);
      partition.entries.delete(command.key);
      partition.bytesUsed -= previous.value.byteLength;
      partition.revision = revision;
      return Object.freeze({ revision, deleted: true });
    },
  });
}

export function createBoundAppDataPort({ store, appId, publisherId } = {}) {
  if (
    !store
    || typeof store.get !== "function"
    || typeof store.list !== "function"
    || typeof store.put !== "function"
    || typeof store.delete !== "function"
  ) {
    throw new TypeError("App Data bound port requires a compatible store");
  }
  const identity = validateAppDataIdentity({
    appId,
    publisherId,
    ownerScope: APP_DATA_OWNER_SCOPE,
  });

  const port = Object.freeze({
    schema: APP_DATA_SCHEMA,
    identity,
    async get(key) {
      return store.get(identity, key);
    },
    async list() {
      return store.list(identity);
    },
    async put(command) {
      return store.put(identity, command);
    },
    async delete(command) {
      return store.delete(identity, command);
    },
  });
  return assertAppDataPort(port);
}
