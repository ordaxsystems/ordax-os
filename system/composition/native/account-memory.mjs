import { createWebMemoryEntitlements } from "../../adapters/web/entitlements.mjs";
import { assertEntitlementsPort } from "../../contracts/entitlements.mjs";
import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import { assertMemoryPort } from "../../contracts/memory.mjs";
import {
  SYNC_STATE_CONTAINER_SCHEMA,
} from "../../services/sync/state-store-registry.mjs";
import {
  createAccountMemoryAuthorizedComposition,
} from "../../services/sync/account-memory-authorized-composition.mjs";

export const NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA =
  "ordax.native-account-memory-foundation/1";

export const NATIVE_ACCOUNT_MEMORY_COMPOSITION_SCHEMA = "ordax.native-account-memory-composition/1";
export const NATIVE_ACCOUNT_MEMORY_SYNC_NAMESPACE = "memory";
export const NATIVE_ACCOUNT_MEMORY_DEFERRED_NAMESPACE = "memory-deferred";
export const NATIVE_ACCOUNT_MEMORY_RECOVERY_NAMESPACE = "memory-recovery";

function requireRegistry(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== SYNC_STATE_CONTAINER_SCHEMA
    || typeof value.open !== "function"
  ) {
    throw new TypeError("Native Account Memory requires a compatible sync-state namespace registry");
  }
  return value;
}

function disabledSnapshot(reason, scope) {
  return Object.freeze({
    schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
    state: "local-only",
    reason,
    syncStateScope: scope,
    protectedMutationsAvailable: false,
    cloudTransportWired: false,
    productionPromoted: false,
  });
}

function isPersistedCoordinationRecoveryError(value) {
  let error = value;
  while (error instanceof Error) {
    const message = error.message;
    if (
      message.includes("requires explicit recovery")
      || message.startsWith("Sync-state root payload ")
      || message.startsWith("Sync-state container ")
    ) {
      return true;
    }
    error = error.cause;
  }
  return false;
}

function blockedMutations() {
  const fail = async () => {
    throw new Error("Native Account Memory coordination requires recovery");
  };
  return Object.freeze({
    remember: fail,
    forget: fail,
    recover: fail,
  });
}

function accountCoordinationRecoveryState(accountMemory) {
  try {
    const snapshot = accountMemory.getSnapshot();
    const recoveryBlocked = snapshot.memory?.memorySync?.recoveryBlocked === true;
    return Object.freeze({
      blocked: recoveryBlocked,
      reason: recoveryBlocked
        ? (snapshot.memory.memorySync.recoveryBlockReason ?? "coordination-recovery-required")
        : null,
      snapshot,
    });
  } catch (error) {
    if (!isPersistedCoordinationRecoveryError(error)) throw error;
    return Object.freeze({
      blocked: true,
      reason: "coordination-state-incompatible",
      snapshot: null,
    });
  }
}

function guardedProtectedMutations(accountMemory) {
  const ensureHealthy = () => {
    if (accountCoordinationRecoveryState(accountMemory).blocked) {
      throw new Error("Native Account Memory coordination requires recovery");
    }
  };
  return Object.freeze({
    schema: accountMemory.protectedMutations.schema,
    async remember(value) {
      ensureHealthy();
      return accountMemory.protectedMutations.remember(value);
    },
    async forget(value) {
      ensureHealthy();
      return accountMemory.protectedMutations.forget(value);
    },
    async recover() {
      ensureHealthy();
      return accountMemory.protectedMutations.recover();
    },
    getSnapshot() {
      ensureHealthy();
      return accountMemory.protectedMutations.getSnapshot();
    },
  });
}

function recoveryRequiredFoundation(scope) {
  const protectedMutations = blockedMutations();
  return Object.freeze({
    schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
    protectedMutations,
    accountMemory: null,
    getSnapshot() {
      return Object.freeze({
        schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
        state: "recovery-required",
        reason: "coordination-state-incompatible",
        syncStateScope: scope,
        protectedMutationsAvailable: false,
        accountMutationsBlocked: true,
        cloudTransportWired: false,
        productionPromoted: false,
      });
    },
    destroy() {},
  });
}

export function createNativeAccountMemoryFoundation({
  identitySession,
  memoryPort,
  syncStateRegistry = null,
  entitlementsPort,
  createIdempotencyKey,
  now = () => new Date(),
  onStageError = null,
} = {}) {
  const identity = assertIdentitySessionPort(identitySession);
  const memory = assertMemoryPort(memoryPort);
  const entitlements = assertEntitlementsPort(entitlementsPort);
  if (typeof createIdempotencyKey !== "function") {
    throw new TypeError("Native Account Memory requires createIdempotencyKey()");
  }

  if (syncStateRegistry === null) {
    const snapshot = disabledSnapshot("sync-state-unavailable", null);
    return Object.freeze({
      schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
      protectedMutations: null,
      accountMemory: null,
      getSnapshot: () => snapshot,
      destroy() {},
    });
  }

  const registry = requireRegistry(syncStateRegistry);
  if (registry.scope !== "device") {
    const snapshot = disabledSnapshot("device-durable-sync-state-required", registry.scope);
    return Object.freeze({
      schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
      protectedMutations: null,
      accountMemory: null,
      getSnapshot: () => snapshot,
      destroy() {},
    });
  }

  let ordinal = 0;
  let accountMemory;
  try {
    accountMemory = createAccountMemoryAuthorizedComposition({
      identitySession: identity,
      entitlementsPort: entitlements,
      memoryPort: memory,
      createSyncStateStore(subjectId) {
        return registry.open(NATIVE_ACCOUNT_MEMORY_SYNC_NAMESPACE, { partitionKey: subjectId });
      },
      createDeferredStateStore(subjectId) {
        return registry.open(NATIVE_ACCOUNT_MEMORY_DEFERRED_NAMESPACE, { partitionKey: subjectId });
      },
      createCrashRecoveryStateStore(subjectId) {
        return registry.open(NATIVE_ACCOUNT_MEMORY_RECOVERY_NAMESPACE, { partitionKey: subjectId });
      },
      createIdempotencyKey(kind = "state") {
        ordinal += 1;
        return createIdempotencyKey(kind, ordinal);
      },
      now,
      onStageError,
    });
  } catch (error) {
    if (!isPersistedCoordinationRecoveryError(error)) throw error;
    if (typeof onStageError === "function") {
      onStageError(error, Object.freeze({ kind: "native-account-memory-foundation" }));
    }
    return recoveryRequiredFoundation(registry.scope);
  }

  let destroyed = false;
  const protectedMutations = guardedProtectedMutations(accountMemory);
  return Object.freeze({
    schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
    protectedMutations,
    accountMemory,
    getSnapshot() {
      if (destroyed) throw new Error("Native Account Memory foundation is disposed");
      const recovery = accountCoordinationRecoveryState(accountMemory);
      if (recovery.snapshot === null) {
        return Object.freeze({
          schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
          state: "recovery-required",
          reason: recovery.reason,
          syncStateScope: registry.scope,
          protectedMutationsAvailable: true,
          accountMutationsBlocked: true,
          cloudTransportWired: false,
          productionPromoted: false,
        });
      }
      const current = recovery.snapshot;
      return Object.freeze({
        schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
        state: recovery.blocked ? "recovery-required" : "protected-local-first",
        reason: recovery.reason,
        syncStateScope: registry.scope,
        protectedMutationsAvailable: true,
        accountMutationsBlocked: recovery.blocked,
        entitlement: current.entitlement,
        crashRecovery: current.crashRecovery,
        cloudTransportWired: false,
        productionPromoted: false,
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      accountMemory.destroy();
    },
  });
}


function requireCompositionRegistry(value) {
  if (!value || typeof value.open !== "function") {
    throw new TypeError("Native Account Memory composition requires a sync-state namespace registry");
  }
  return value;
}

export function createNativeAccountMemoryComposition({
  windowRef = globalThis.window,
  identitySession,
  memoryPort,
  syncStateRegistry,
  createIdempotencyKey,
  now = () => new Date(),
  onStageError = null,
} = {}) {
  const registry = requireCompositionRegistry(syncStateRegistry);
  if (typeof createIdempotencyKey !== "function") {
    throw new TypeError("Native Account Memory composition requires createIdempotencyKey()");
  }
  const entitlementsPort = createWebMemoryEntitlements(windowRef);
  const composition = createAccountMemoryAuthorizedComposition({
    identitySession,
    entitlementsPort,
    memoryPort,
    createSyncStateStore(subjectId) {
      return registry.open(NATIVE_ACCOUNT_MEMORY_SYNC_NAMESPACE, { partitionKey: subjectId });
    },
    createDeferredStateStore(subjectId) {
      return registry.open(NATIVE_ACCOUNT_MEMORY_DEFERRED_NAMESPACE, { partitionKey: subjectId });
    },
    createCrashRecoveryStateStore(subjectId) {
      return registry.open(NATIVE_ACCOUNT_MEMORY_RECOVERY_NAMESPACE, { partitionKey: subjectId });
    },
    createIdempotencyKey,
    now,
    onStageError,
  });

  return Object.freeze({
    schema: NATIVE_ACCOUNT_MEMORY_COMPOSITION_SCHEMA,
    entitlementsPort,
    memory: composition.memory,
    memorySync: composition.memorySync,
    protectedMutations: composition.protectedMutations,
    deferredIntents: composition.deferredIntents,
    settled: () => composition.settled(),
    getSnapshot() {
      return Object.freeze({
        schema: NATIVE_ACCOUNT_MEMORY_COMPOSITION_SCHEMA,
        accountMemory: composition.getSnapshot(),
        entitlementEndpoint: "/account/entitlements/memory-cloud",
        syncStatePartitioning: "account-subject",
        publicCloudMemoryEnabled: false,
      });
    },
    destroy() {
      composition.destroy();
    },
  });
}
