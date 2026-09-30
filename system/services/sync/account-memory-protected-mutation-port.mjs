import {
  MAX_MEMORY_SEARCH_OFFSET,
  MAX_MEMORY_SEARCH_RESULTS,
  assertMemoryPort,
  validateMemoryForgetRequest,
  validateMemoryItem,
} from "../../contracts/memory.mjs";
import {
  MEMORY_SYNC_RUNTIME_SCHEMA,
  classifyMemoryForAccountSync,
} from "./account-memory-runtime.mjs";
import {
  ACCOUNT_MEMORY_CRASH_RECOVERY_JOURNAL_SCHEMA,
} from "./account-memory-crash-recovery-journal.mjs";

export const ACCOUNT_MEMORY_PROTECTED_MUTATION_PORT_SCHEMA = "ordax.account-memory-protected-mutation-port/1";

const TRANSFERRED_STATUSES = new Set(["pending", "conflict", "reconciliation-required"]);

function requireSync(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== MEMORY_SYNC_RUNTIME_SCHEMA
    || typeof value.stageUpsert !== "function"
    || typeof value.stageForget !== "function"
    || typeof value.getSnapshot !== "function"
  ) {
    throw new TypeError("Protected Memory mutations require a compatible account Memory sync runtime");
  }
  return value;
}

function requireJournal(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== ACCOUNT_MEMORY_CRASH_RECOVERY_JOURNAL_SCHEMA
    || typeof value.runProtectedMutation !== "function"
    || typeof value.recover !== "function"
    || typeof value.getSnapshot !== "function"
  ) {
    throw new TypeError("Protected Memory mutations require the crash recovery journal");
  }
  return value;
}

function requireDurabilityConfirmation(value) {
  if (typeof value !== "function") {
    throw new TypeError("Protected Memory mutations require flushCoordination()");
  }
  return value;
}

function activeSubjectId(sync) {
  const subjectId = sync.getSnapshot()?.subjectId;
  return typeof subjectId === "string" && subjectId.trim() ? subjectId.trim() : null;
}

function assertActiveAccount(value, sync) {
  const subjectId = activeSubjectId(sync);
  if (!subjectId) throw new Error("Signed-in account Memory sync is required for protected mutation");
  if (value.ownerKind !== "account" || value.ownerId !== subjectId) {
    throw new Error("Protected Memory mutation must belong to the active account");
  }
  return subjectId;
}

function findCurrent(memory, subjectId, id) {
  for (let offset = 0; offset <= MAX_MEMORY_SEARCH_OFFSET; offset += MAX_MEMORY_SEARCH_RESULTS) {
    const batch = memory.search({
      ownerKind: "account",
      ownerId: subjectId,
      scopes: ["device", "account", "space", "project", "session"],
      includeRestricted: true,
      limit: MAX_MEMORY_SEARCH_RESULTS,
      offset,
    });
    const current = batch.find((entry) => entry.id === id);
    if (current) return current;
    if (batch.length < MAX_MEMORY_SEARCH_RESULTS) return null;
  }
  return null;
}

function identityOf(value) {
  return Object.freeze({
    id: value.id,
    ownerKind: value.ownerKind,
    ownerId: value.ownerId,
  });
}

function identityKey(value) {
  return `${value.ownerKind}\0${value.ownerId ?? ""}\0${value.id}`;
}

function stageCurrentState(memory, sync, subjectId, identity) {
  const current = findCurrent(memory, subjectId, identity.id);
  let result;
  if (current) {
    const classification = classifyMemoryForAccountSync(current, { subjectId });
    result = classification.eligible
      ? sync.stageUpsert(classification.item)
      : sync.stageForget(identity);
  } else {
    result = sync.stageForget(identity);
  }

  if (TRANSFERRED_STATUSES.has(result?.status)) return result;
  if (result?.status === "blocked" && result.reason === "authorization-required") {
    throw new Error("Protected Memory reconciliation requires account sync authorization");
  }
  if (result?.status === "blocked") {
    throw new Error(`Protected Memory reconciliation was blocked: ${result.reason}`);
  }
  throw new Error(`Protected Memory reconciliation returned unsupported status: ${result?.status ?? "unknown"}`);
}

async function confirmTrue(operation, label) {
  const result = await operation();
  if (result !== true) throw new Error(`${label} durability was not confirmed`);
  return true;
}

export function createAccountMemoryProtectedMutationPort({
  memoryPort,
  memorySync,
  crashRecoveryJournal,
  flushCoordination,
} = {}) {
  const memory = assertMemoryPort(memoryPort);
  const sync = requireSync(memorySync);
  const journal = requireJournal(crashRecoveryJournal);
  const confirmCoordination = requireDurabilityConfirmation(flushCoordination);
  const identityQueues = new Map();
  let recoveryBarrier = Promise.resolve();

  const reconcileDurably = async (subjectId, identity) => {
    const result = stageCurrentState(memory, sync, subjectId, identity);
    await confirmTrue(confirmCoordination, "Account Memory coordination");
    return result;
  };

  const withIdentityLock = (identity, operation) => {
    const key = identityKey(identity);
    const previous = identityQueues.get(key) ?? Promise.resolve();
    const current = Promise.all([
      recoveryBarrier.catch(() => undefined),
      previous.catch(() => undefined),
    ]).then(operation);
    identityQueues.set(key, current);
    current.finally(() => {
      if (identityQueues.get(key) === current) identityQueues.delete(key);
    }).catch(() => undefined);
    return current;
  };

  const runRecovery = () => {
    const priorRecovery = recoveryBarrier.catch(() => undefined);
    const mutations = [...identityQueues.values()].map((promise) => promise.catch(() => undefined));
    const current = Promise.all([priorRecovery, ...mutations])
      .then(() => journal.recover(sync, { flushCoordination: confirmCoordination }));
    recoveryBarrier = current;
    return current;
  };

  return Object.freeze({
    schema: ACCOUNT_MEMORY_PROTECTED_MUTATION_PORT_SCHEMA,
    remember(value) {
      const normalized = validateMemoryItem(value);
      const identity = identityOf(normalized);
      return withIdentityLock(identity, () => {
        const subjectId = assertActiveAccount(normalized, sync);
        return journal.runProtectedMutation({
          identity,
          mutate: () => memory.remember(normalized),
          flushLocal: () => confirmTrue(() => memory.flush(), "Local Memory"),
          reconcile: () => reconcileDurably(subjectId, identity),
        });
      });
    },
    forget(value) {
      const request = validateMemoryForgetRequest(value);
      return withIdentityLock(request, () => {
        const subjectId = assertActiveAccount(request, sync);
        if (!findCurrent(memory, subjectId, request.id)) return false;
        return journal.runProtectedMutation({
          identity: request,
          mutate: () => memory.forget(request),
          flushLocal: () => confirmTrue(() => memory.flush(), "Local Memory"),
          reconcile: () => reconcileDurably(subjectId, request),
        });
      });
    },
    recover() {
      return runRecovery();
    },
    getSnapshot() {
      return Object.freeze({
        schema: ACCOUNT_MEMORY_PROTECTED_MUTATION_PORT_SCHEMA,
        subjectId: activeSubjectId(sync),
        journal: journal.getSnapshot(),
        activeIdentityQueues: identityQueues.size,
        synchronousMemoryPortUnchanged: true,
        cloudTransportOwnedBySyncRuntime: true,
        productionPromoted: false,
      });
    },
  });
}
