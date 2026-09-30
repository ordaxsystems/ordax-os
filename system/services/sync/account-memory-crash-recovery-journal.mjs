import {
  MAX_MEMORY_SEARCH_OFFSET,
  MAX_MEMORY_SEARCH_RESULTS,
  assertMemoryPort,
  validateMemoryForgetRequest,
} from "../../contracts/memory.mjs";
import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import {
  MAX_SYNC_STATE_PAYLOAD_BYTES,
  assertSyncStateStorePort,
} from "../../contracts/sync-state-store.mjs";
import {
  MEMORY_SYNC_RUNTIME_SCHEMA,
  classifyMemoryForAccountSync,
} from "./account-memory-runtime.mjs";

export const ACCOUNT_MEMORY_CRASH_RECOVERY_JOURNAL_SCHEMA = "ordax.account-memory-crash-recovery-journal/1";
export const ACCOUNT_MEMORY_CRASH_RECOVERY_STATE_SCHEMA = "ordax.account-memory-crash-recovery-state/1";

const MAX_JOURNAL_IDENTITIES = 128;
const TRANSFERRED_STATUSES = new Set(["pending", "conflict", "reconciliation-required"]);

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function requireFactory(value) {
  if (typeof value !== "function") {
    throw new TypeError("Memory crash recovery requires createJournalStateStore(subjectId)");
  }
  return value;
}

function requireMemorySync(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== MEMORY_SYNC_RUNTIME_SCHEMA
    || typeof value.stageUpsert !== "function"
    || typeof value.stageForget !== "function"
    || typeof value.pendingMutations !== "function"
    || typeof value.pendingConflicts !== "function"
  ) {
    throw new TypeError("Memory crash recovery requires a compatible Memory sync runtime");
  }
  return value;
}

function requireDurabilityConfirmation(value) {
  if (typeof value !== "function") {
    throw new TypeError("Memory crash recovery requires flushCoordination() before journal clear");
  }
  return value;
}

function identityRecord(value, subjectId) {
  const request = validateMemoryForgetRequest(value);
  if (request.ownerKind !== "account" || request.ownerId !== subjectId) {
    throw new TypeError("Memory crash recovery identity must belong to the active account");
  }
  return Object.freeze({
    id: request.id,
    ownerKind: "account",
    ownerId: subjectId,
  });
}

function identityQueueKey(value) {
  const request = validateMemoryForgetRequest(value);
  return `${request.ownerKind}\0${request.ownerId ?? ""}\0${request.id}`;
}

function serializeState(subjectId, identities) {
  const payload = JSON.stringify({
    $schema: ACCOUNT_MEMORY_CRASH_RECOVERY_STATE_SCHEMA,
    subjectId,
    identities: [...identities.values()].sort((left, right) => left.id.localeCompare(right.id)),
  });
  if (new TextEncoder().encode(payload).byteLength > MAX_SYNC_STATE_PAYLOAD_BYTES) {
    throw new Error("Memory crash recovery journal exceeds its durable bound");
  }
  return payload;
}

function recoverState(store, subjectId) {
  const raw = store.load();
  if (raw == null) return new Map();
  try {
    const parsed = JSON.parse(raw);
    if (
      !exactKeys(parsed, ["$schema", "subjectId", "identities"])
      || parsed.$schema !== ACCOUNT_MEMORY_CRASH_RECOVERY_STATE_SCHEMA
      || parsed.subjectId !== subjectId
      || !Array.isArray(parsed.identities)
      || parsed.identities.length > MAX_JOURNAL_IDENTITIES
    ) {
      throw new TypeError("incompatible Memory crash recovery state");
    }
    const identities = new Map();
    for (const rawIdentity of parsed.identities) {
      if (!exactKeys(rawIdentity, ["id", "ownerKind", "ownerId"])) {
        throw new TypeError("invalid Memory crash recovery identity shape");
      }
      const identity = identityRecord(rawIdentity, subjectId);
      if (identities.has(identity.id)) throw new TypeError("duplicate Memory crash recovery identity");
      identities.set(identity.id, identity);
    }
    return identities;
  } catch (error) {
    throw new Error("Memory crash recovery journal requires explicit recovery", { cause: error });
  }
}

function saveState(runtime) {
  const saved = runtime.store.save(serializeState(runtime.subjectId, runtime.identities));
  if (saved !== true) throw new Error("Memory crash recovery journal persistence failed");
}

async function flushState(runtime) {
  if (typeof runtime.store.flush !== "function") return true;
  const flushed = await runtime.store.flush();
  if (flushed !== true) throw new Error("Memory crash recovery journal durability was not confirmed");
  return true;
}

function findCurrentMemoryItem(memory, subjectId, id) {
  for (let offset = 0; offset <= MAX_MEMORY_SEARCH_OFFSET; offset += MAX_MEMORY_SEARCH_RESULTS) {
    const items = memory.search({
      ownerKind: "account",
      ownerId: subjectId,
      scopes: ["device", "account", "space", "project", "session"],
      includeRestricted: true,
      limit: MAX_MEMORY_SEARCH_RESULTS,
      offset,
    });
    const current = items.find((item) => item.id === id);
    if (current) return current;
    if (items.length < MAX_MEMORY_SEARCH_RESULTS) return null;
  }
  return null;
}

function desiredCanonicalState(memory, subjectId, journalIdentity) {
  const current = findCurrentMemoryItem(memory, subjectId, journalIdentity.id);
  if (current) {
    const classification = classifyMemoryForAccountSync(current, { subjectId });
    if (classification.eligible) {
      return Object.freeze({ operation: "upsert", item: classification.item });
    }
  }
  return Object.freeze({ operation: "delete", identity: journalIdentity });
}

function canonicalOwnershipMatches(memorySync, objectId, desired) {
  if (memorySync.pendingConflicts().some((entry) => entry?.objectId === objectId)) return true;
  const pending = memorySync.pendingMutations().find((mutation) => mutation?.objectId === objectId);
  if (!pending) return false;
  if (desired.operation === "delete") return pending.operation === "delete";
  return pending.operation === "upsert"
    && JSON.stringify(pending.payload?.memory) === JSON.stringify(desired.item);
}

export function createAccountMemoryCrashRecoveryJournal({
  identitySession,
  memoryPort,
  createJournalStateStore,
} = {}) {
  const identity = assertIdentitySessionPort(identitySession);
  const memory = assertMemoryPort(memoryPort);
  const createStore = requireFactory(createJournalStateStore);
  const runtimes = new Map();
  const protectedQueues = new Map();
  let recoveryBarrier = Promise.resolve();
  let destroyed = false;

  const activeIdentity = () => {
    if (destroyed) throw new Error("Memory crash recovery journal is disposed");
    return validateIdentitySessionSnapshot(identity.getSnapshot());
  };

  const runtimeFor = (subjectId) => {
    if (runtimes.has(subjectId)) return runtimes.get(subjectId);
    const store = assertSyncStateStorePort(createStore(subjectId));
    const runtime = {
      subjectId,
      store,
      identities: recoverState(store, subjectId),
    };
    runtimes.set(subjectId, runtime);
    return runtime;
  };

  const currentRuntime = () => {
    const snapshot = activeIdentity();
    if (snapshot.state !== "signed-in") return null;
    return runtimeFor(snapshot.subjectId);
  };

  const armRuntimeDurably = async (runtime, value) => {
    const journalIdentity = identityRecord(value, runtime.subjectId);
    const before = new Map(runtime.identities);
    runtime.identities.set(journalIdentity.id, journalIdentity);
    if (runtime.identities.size > MAX_JOURNAL_IDENTITIES) {
      runtime.identities.clear();
      for (const [key, entry] of before) runtime.identities.set(key, entry);
      throw new Error("Memory crash recovery journal capacity exceeded");
    }
    try {
      saveState(runtime);
      await flushState(runtime);
      return journalIdentity;
    } catch (error) {
      runtime.identities.clear();
      for (const [key, entry] of before) runtime.identities.set(key, entry);
      throw error;
    }
  };

  const armDurably = async (value) => {
    const runtime = currentRuntime();
    if (!runtime) throw new Error("Signed-in account required before arming Memory crash recovery");
    return armRuntimeDurably(runtime, value);
  };

  const clearRuntimeDurably = async (runtime, id) => {
    if (!runtime.identities.has(id)) return false;
    const before = new Map(runtime.identities);
    runtime.identities.delete(id);
    try {
      saveState(runtime);
      await flushState(runtime);
      return true;
    } catch (error) {
      runtime.identities.clear();
      for (const [key, entry] of before) runtime.identities.set(key, entry);
      throw error;
    }
  };

  const clearDurably = async (id) => {
    const runtime = currentRuntime();
    if (!runtime) return false;
    return clearRuntimeDurably(runtime, id);
  };

  const reconcileOne = (runtime, memorySync, journalIdentity) => {
    const desired = desiredCanonicalState(memory, runtime.subjectId, journalIdentity);
    if (canonicalOwnershipMatches(memorySync, journalIdentity.id, desired)) {
      return Object.freeze({ status: "canonical-owner", objectId: journalIdentity.id });
    }
    return desired.operation === "upsert"
      ? memorySync.stageUpsert(desired.item)
      : memorySync.stageForget(desired.identity);
  };

  const runSerializedProtectedMutation = (value, operation) => {
    const key = identityQueueKey(value);
    const previous = protectedQueues.get(key) ?? Promise.resolve();
    const current = Promise.all([
      recoveryBarrier.catch(() => undefined),
      previous.catch(() => undefined),
    ]).then(operation);
    protectedQueues.set(key, current);
    current.finally(() => {
      if (protectedQueues.get(key) === current) protectedQueues.delete(key);
    }).catch(() => undefined);
    return current;
  };

  const runRecovery = (operation) => {
    const priorRecovery = recoveryBarrier.catch(() => undefined);
    const activeMutations = [...protectedQueues.values()].map((promise) => promise.catch(() => undefined));
    const current = Promise.all([priorRecovery, ...activeMutations]).then(operation);
    recoveryBarrier = current;
    return current;
  };

  return Object.freeze({
    schema: ACCOUNT_MEMORY_CRASH_RECOVERY_JOURNAL_SCHEMA,
    armDurably,
    clearDurably,
    runProtectedMutation({ identity: value, mutate, flushLocal, reconcile } = {}) {
      if (typeof mutate !== "function" || typeof flushLocal !== "function" || typeof reconcile !== "function") {
        throw new TypeError("Protected Memory mutation requires mutate, flushLocal and reconcile functions");
      }
      return runSerializedProtectedMutation(value, async () => {
        const runtime = currentRuntime();
        if (!runtime) throw new Error("Signed-in account required before arming Memory crash recovery");
        const journalIdentity = await armRuntimeDurably(runtime, value);
        const result = mutate();
        await flushLocal();
        await reconcile();
        await clearRuntimeDurably(runtime, journalIdentity.id);
        return result;
      });
    },
    recover(memorySyncValue, { flushCoordination } = {}) {
      const memorySync = requireMemorySync(memorySyncValue);
      const confirmCoordination = requireDurabilityConfirmation(flushCoordination);
      return runRecovery(async () => {
        const runtime = currentRuntime();
        if (!runtime) return Object.freeze({ attempted: 0, transferred: 0, retained: 0, inactive: true });

        let attempted = 0;
        let transferred = 0;
        for (const journalIdentity of [...runtime.identities.values()]) {
          attempted += 1;
          const result = reconcileOne(runtime, memorySync, journalIdentity);
          if (result.status === "canonical-owner" || TRANSFERRED_STATUSES.has(result.status)) {
            const durable = await confirmCoordination();
            if (durable !== true) {
              throw new Error("Memory crash recovery coordination durability was not confirmed");
            }
            await clearRuntimeDurably(runtime, journalIdentity.id);
            transferred += 1;
            continue;
          }
          if (result.status === "blocked" && result.reason === "authorization-required") continue;
          if (result.status === "blocked") {
            throw new Error(`Memory crash recovery reconciliation was blocked: ${result.reason}`);
          }
          throw new Error(`Memory crash recovery reconciliation returned unsupported status: ${result.status}`);
        }
        return Object.freeze({
          attempted,
          transferred,
          retained: runtime.identities.size,
          inactive: false,
        });
      });
    },
    pendingIdentities() {
      const runtime = currentRuntime();
      return runtime ? Object.freeze([...runtime.identities.values()]) : Object.freeze([]);
    },
    getSnapshot() {
      const runtime = currentRuntime();
      return Object.freeze({
        schema: ACCOUNT_MEMORY_CRASH_RECOVERY_JOURNAL_SCHEMA,
        subjectId: runtime?.subjectId ?? null,
        pendingIdentityCount: runtime?.identities.size ?? 0,
        activeProtectedMutationCount: protectedQueues.size,
        journalPersistence: runtime?.store.scope ?? null,
        storesPortableContent: false,
        durabilityConfirmationAvailable: typeof runtime?.store.flush === "function",
        productionPromoted: false,
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      runtimes.clear();
      protectedQueues.clear();
    },
  });
}
