import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import { assertMemoryPort } from "../../contracts/memory.mjs";
import { assertSyncStateStorePort } from "../../contracts/sync-state-store.mjs";
import {
  MEMORY_SYNC_RUNTIME_SCHEMA,
  createAccountMemorySyncRuntime,
} from "./account-memory-runtime.mjs";

export const ACCOUNT_MEMORY_SESSION_RUNTIME_SCHEMA = "ordax.account-memory-session-runtime/1";

function requireStoreFactory(value) {
  if (typeof value !== "function") {
    throw new TypeError("Account Memory session runtime requires createSyncStateStore(subjectId)");
  }
  return value;
}

function requireAuthorization(value) {
  if (typeof value !== "function") {
    throw new TypeError("Account Memory session runtime requires authorizeSync()");
  }
  return value;
}

function requireIdFactory(value) {
  if (typeof value !== "function") {
    throw new TypeError("Account Memory session runtime requires createIdempotencyKey()");
  }
  return value;
}

function inactiveSnapshot(state) {
  return Object.freeze({
    schema: MEMORY_SYNC_RUNTIME_SCHEMA,
    sessionSchema: ACCOUNT_MEMORY_SESSION_RUNTIME_SCHEMA,
    identityState: state,
    subjectId: null,
    pendingMutationCount: 0,
    conflictCount: 0,
    revisionCount: 0,
    queuePersistence: "session",
    recoveredCoordinationState: false,
    recoveryBlocked: false,
    recoveryBlockReason: null,
    reconciliationOwnership: "account-runtime",
    ownsCursor: false,
    ownsTransport: false,
    liveClientIntegration: false,
    productionPromoted: false,
  });
}

export function createAccountMemorySessionRuntime({
  identitySession,
  memoryPort,
  createSyncStateStore,
  authorizeSync,
  createIdempotencyKey,
} = {}) {
  const identity = assertIdentitySessionPort(identitySession);
  const memory = assertMemoryPort(memoryPort);
  const nextStore = requireStoreFactory(createSyncStateStore);
  const authorization = requireAuthorization(authorizeSync);
  const nextKey = requireIdFactory(createIdempotencyKey);

  let activeSubjectId = null;
  let activeRuntime = null;
  let destroyed = false;

  const resolve = () => {
    if (destroyed) throw new Error("Account Memory session runtime is disposed");
    const snapshot = validateIdentitySessionSnapshot(identity.getSnapshot());
    if (snapshot.state !== "signed-in") {
      activeSubjectId = null;
      activeRuntime = null;
      return null;
    }
    if (activeRuntime && activeSubjectId === snapshot.subjectId) return activeRuntime;

    const store = assertSyncStateStorePort(nextStore(snapshot.subjectId));
    activeSubjectId = snapshot.subjectId;
    activeRuntime = createAccountMemorySyncRuntime({
      memoryPort: memory,
      subjectId: snapshot.subjectId,
      syncStateStore: store,
      authorizeSync: authorization,
      createIdempotencyKey: nextKey,
    });
    return activeRuntime;
  };

  const unsubscribe = identity.subscribe(() => {
    if (!destroyed) resolve();
  });
  if (typeof unsubscribe !== "function") {
    throw new TypeError("Identity session subscription must return an unsubscribe function");
  }
  resolve();

  return Object.freeze({
    schema: MEMORY_SYNC_RUNTIME_SCHEMA,
    sessionSchema: ACCOUNT_MEMORY_SESSION_RUNTIME_SCHEMA,
    getSnapshot() {
      const runtime = resolve();
      if (runtime) {
        return Object.freeze({
          ...runtime.getSnapshot(),
          sessionSchema: ACCOUNT_MEMORY_SESSION_RUNTIME_SCHEMA,
          identityState: "signed-in",
        });
      }
      return inactiveSnapshot(validateIdentitySessionSnapshot(identity.getSnapshot()).state);
    },
    async applyRemoteBatch(values) {
      const runtime = resolve();
      if (!runtime) {
        return Object.freeze({ applied: 0, ignored: 0, rejected: 0, blocked: 0, inactive: true });
      }
      return runtime.applyRemoteBatch(values);
    },
    async flush(transport) {
      const runtime = resolve();
      if (!runtime) return Object.freeze({ ...inactiveSnapshot(validateIdentitySessionSnapshot(identity.getSnapshot()).state), accepted: 0, failures: 0 });
      return runtime.flush(transport);
    },
    stageUpsert(value) {
      const runtime = resolve();
      if (!runtime) return Object.freeze({ status: "blocked", reason: "signed-in-account-required", objectId: null });
      return runtime.stageUpsert(value);
    },
    stageForget(value) {
      const runtime = resolve();
      if (!runtime) return Object.freeze({ status: "blocked", reason: "signed-in-account-required", objectId: null });
      return runtime.stageForget(value);
    },
    pendingMutations() {
      return resolve()?.pendingMutations() ?? Object.freeze([]);
    },
    pendingConflicts() {
      return resolve()?.pendingConflicts() ?? Object.freeze([]);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      activeRuntime = null;
      activeSubjectId = null;
      unsubscribe();
    },
  });
}
