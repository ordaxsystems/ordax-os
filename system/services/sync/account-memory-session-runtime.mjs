import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import { assertMemoryPort } from "../../contracts/memory.mjs";
import { assertSyncStateStorePort } from "../../contracts/sync-state-store.mjs";
import {
  SYNC_TRANSPORT_SCHEMA,
  assertSyncTransportPort,
} from "../../contracts/sync-transport.mjs";
import {
  MEMORY_SYNC_DATA_CLASS,
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

function mutationAuthorizationDescriptor(subjectId, mutation) {
  if (
    !mutation
    || typeof mutation !== "object"
    || mutation.dataClass !== MEMORY_SYNC_DATA_CLASS
  ) {
    throw new TypeError("Account Memory transport received an incompatible mutation");
  }
  if (mutation.operation === "upsert") {
    return Object.freeze({
      subjectId,
      dataClass: MEMORY_SYNC_DATA_CLASS,
      operation: "upsert",
      item: mutation.payload?.memory,
    });
  }
  if (mutation.operation === "delete") {
    return Object.freeze({
      subjectId,
      dataClass: MEMORY_SYNC_DATA_CLASS,
      operation: "delete",
      memoryIdentity: mutation.payload?.memoryIdentity,
    });
  }
  throw new TypeError("Account Memory transport received an unsupported mutation operation");
}

function createAuthorizationGatedTransport({ transport, subjectId, authorizeSync }) {
  const remote = assertSyncTransportPort(transport);
  return Object.freeze({
    schema: SYNC_TRANSPORT_SCHEMA,
    snapshot(request) {
      return remote.snapshot(request);
    },
    pullChanges(request) {
      return remote.pullChanges(request);
    },
    async applyMutation(mutation) {
      const descriptor = mutationAuthorizationDescriptor(subjectId, mutation);
      if (authorizeSync(descriptor) !== true) {
        throw new Error("Account Memory sync authorization is required at the transport boundary");
      }
      return remote.applyMutation(mutation);
    },
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
      const gatedTransport = createAuthorizationGatedTransport({
        transport,
        subjectId: activeSubjectId,
        authorizeSync: authorization,
      });
      return runtime.flush(gatedTransport);
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
