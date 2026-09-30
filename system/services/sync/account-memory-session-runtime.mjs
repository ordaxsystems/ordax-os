import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import {
  MAX_MEMORY_SEARCH_OFFSET,
  MAX_MEMORY_SEARCH_RESULTS,
  assertMemoryPort,
} from "../../contracts/memory.mjs";
import { assertSyncStateStorePort } from "../../contracts/sync-state-store.mjs";
import {
  SYNC_TRANSPORT_SCHEMA,
  assertSyncTransportPort,
} from "../../contracts/sync-transport.mjs";
import {
  MEMORY_SYNC_DATA_CLASS,
  MEMORY_SYNC_RUNTIME_SCHEMA,
  classifyMemoryForAccountSync,
  createAccountMemorySyncRuntime,
} from "./account-memory-runtime.mjs";
import { resolveMemorySyncConflict } from "./memory-conflict-resolution.mjs";

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

function trackedSyncStateStore(store, tracking) {
  const tracked = {
    schema: store.schema,
    get scope() {
      return store.scope;
    },
    load() {
      return store.load();
    },
    save(value) {
      tracking.lastPayload = value;
      try {
        const accepted = store.save(value);
        tracking.lastSaveAccepted = accepted === true;
        return accepted;
      } catch (error) {
        tracking.lastSaveAccepted = false;
        throw error;
      }
    },
  };
  if (typeof store.flush === "function") {
    tracked.flush = () => store.flush();
  }
  return assertSyncStateStorePort(tracked);
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

function mutationAuthorizationDescriptor(memory, subjectId, mutation) {
  if (
    !mutation
    || typeof mutation !== "object"
    || mutation.dataClass !== MEMORY_SYNC_DATA_CLASS
  ) {
    throw new TypeError("Account Memory transport received an incompatible mutation");
  }
  if (mutation.operation === "upsert") {
    const queued = mutation.payload?.memory;
    const current = findCurrentMemoryItem(memory, subjectId, queued?.id);
    if (!current) {
      throw new Error("Pending Memory upsert no longer has a current local item");
    }
    const classification = classifyMemoryForAccountSync(current, { subjectId });
    if (!classification.eligible || JSON.stringify(current) !== JSON.stringify(queued)) {
      throw new Error("Pending Memory upsert no longer matches current portable local state");
    }
    return Object.freeze({
      subjectId,
      dataClass: MEMORY_SYNC_DATA_CLASS,
      operation: "upsert",
      item: current,
    });
  }
  if (mutation.operation === "delete") {
    const identity = mutation.payload?.memoryIdentity;
    const current = findCurrentMemoryItem(memory, subjectId, identity?.id);
    if (current) {
      const classification = classifyMemoryForAccountSync(current, { subjectId });
      if (classification.eligible) {
        throw new Error("Pending Memory delete is stale because portable local state exists again");
      }
    }
    return Object.freeze({
      subjectId,
      dataClass: MEMORY_SYNC_DATA_CLASS,
      operation: "delete",
      memoryIdentity: identity,
    });
  }
  throw new TypeError("Account Memory transport received an unsupported mutation operation");
}

function createAuthorizationGatedTransport({ transport, memoryPort, subjectId, authorizeSync }) {
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
      const descriptor = mutationAuthorizationDescriptor(memoryPort, subjectId, mutation);
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
  let activeStore = null;
  let activeCoordinationTracking = null;
  let destroyed = false;

  const resolve = () => {
    if (destroyed) throw new Error("Account Memory session runtime is disposed");
    const snapshot = validateIdentitySessionSnapshot(identity.getSnapshot());
    if (snapshot.state !== "signed-in") {
      activeSubjectId = null;
      activeRuntime = null;
      activeStore = null;
      activeCoordinationTracking = null;
      return null;
    }
    if (activeRuntime && activeSubjectId === snapshot.subjectId) return activeRuntime;

    const store = assertSyncStateStorePort(nextStore(snapshot.subjectId));
    const tracking = { lastSaveAccepted: null, lastPayload: null };
    const trackedStore = trackedSyncStateStore(store, tracking);
    activeSubjectId = snapshot.subjectId;
    activeStore = store;
    activeCoordinationTracking = tracking;
    activeRuntime = createAccountMemorySyncRuntime({
      memoryPort: memory,
      subjectId: snapshot.subjectId,
      syncStateStore: trackedStore,
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

  const flushCoordination = async () => {
    const runtime = resolve();
    if (!runtime || !activeStore || !activeCoordinationTracking) {
      return Object.freeze({
        confirmed: false,
        reason: "signed-in-account-required",
        persistence: "session",
      });
    }
    if (activeCoordinationTracking.lastSaveAccepted === false) {
      if (activeCoordinationTracking.lastPayload === null) {
        return Object.freeze({
          confirmed: false,
          reason: "last-save-rejected",
          persistence: activeStore.scope,
        });
      }
      const accepted = activeStore.save(activeCoordinationTracking.lastPayload);
      activeCoordinationTracking.lastSaveAccepted = accepted === true;
      if (accepted !== true) {
        return Object.freeze({
          confirmed: false,
          reason: "last-save-rejected",
          persistence: activeStore.scope,
        });
      }
    }
    if (typeof activeStore.flush === "function") {
      const flushed = await activeStore.flush();
      if (flushed !== true) {
        return Object.freeze({
          confirmed: false,
          reason: "flush-not-confirmed",
          persistence: activeStore.scope,
        });
      }
    }
    const persistence = activeStore.scope;
    const confirmed = persistence === "device";
    if (confirmed) activeCoordinationTracking.lastSaveAccepted = null;
    return Object.freeze({
      confirmed,
      reason: confirmed ? "durable" : "session-only",
      persistence,
    });
  };

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
        memoryPort: memory,
        subjectId: activeSubjectId,
        authorizeSync: authorization,
      });
      return runtime.flush(gatedTransport);
    },
    flushCoordination,
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
    async resolveConflict(objectId, decision) {
      const runtime = resolve();
      if (!runtime || activeSubjectId === null) {
        throw new Error("Signed-in account required before resolving Memory conflict");
      }
      const conflict = runtime.pendingConflicts().find((entry) => entry.objectId === objectId) ?? null;
      if (conflict === null) throw new Error("Memory conflict is no longer pending");
      if (conflict.reason === "reconciliation-required") {
        throw new Error("Memory conflict already requires authoritative remote reconciliation");
      }
      const pendingMutation = runtime.pendingMutations().find((entry) => entry.objectId === objectId) ?? null;
      if (pendingMutation === null) {
        throw new Error("Memory conflict no longer has a local intent to resolve");
      }
      const resolution = resolveMemorySyncConflict({
        conflict,
        pendingMutation,
        decision,
        subjectId: activeSubjectId,
        createIdempotencyKey,
      });
      const result = runtime.applyConflictResolution(resolution);
      const durability = await flushCoordination();
      if (durability.confirmed !== true) {
        throw new Error("Memory conflict resolution durability was not confirmed");
      }
      return result;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      activeRuntime = null;
      activeStore = null;
      activeCoordinationTracking = null;
      activeSubjectId = null;
      unsubscribe();
    },
  });
}
