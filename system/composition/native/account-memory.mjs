import { createWebMemoryEntitlements } from "../../adapters/web/entitlements.mjs";
import { createAccountMemoryAuthorizedComposition } from "../../services/sync/account-memory-authorized-composition.mjs";

export const NATIVE_ACCOUNT_MEMORY_COMPOSITION_SCHEMA = "ordax.native-account-memory-composition/1";
export const NATIVE_ACCOUNT_MEMORY_SYNC_NAMESPACE = "memory";
export const NATIVE_ACCOUNT_MEMORY_DEFERRED_NAMESPACE = "memory-deferred";
export const NATIVE_ACCOUNT_MEMORY_RECOVERY_NAMESPACE = "memory-recovery";

function requireRegistry(value) {
  if (!value || typeof value.open !== "function") {
    throw new TypeError("Native Account Memory composition requires a sync-state namespace registry");
  }
  return value;
}

function requireIdFactory(value) {
  if (typeof value !== "function") {
    throw new TypeError("Native Account Memory composition requires createIdempotencyKey()");
  }
  return value;
}

function isPersistedCoordinationRecoveryError(value) {
  let error = value;
  while (error instanceof Error) {
    const message = error.message;
    if (
      message.includes("requires explicit recovery")
      || message.startsWith("Sync-state root payload ")
      || message.startsWith("Sync-state container ")
      || message.includes("incompatible Memory crash recovery state")
    ) {
      return true;
    }
    error = error.cause;
  }
  return false;
}

function recoveryState(composition) {
  try {
    const snapshot = composition.getSnapshot();
    const blocked = snapshot.memory?.memorySync?.recoveryBlocked === true;
    return Object.freeze({
      blocked,
      reason: blocked
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

function guardedProtectedMutations(composition) {
  const ensureHealthy = () => {
    const state = recoveryState(composition);
    if (state.blocked) {
      throw new Error("Native Account Memory coordination requires recovery");
    }
  };
  return Object.freeze({
    schema: composition.protectedMutations.schema,
    async remember(value) {
      ensureHealthy();
      return composition.protectedMutations.remember(value);
    },
    async forget(value) {
      ensureHealthy();
      return composition.protectedMutations.forget(value);
    },
    async recover() {
      ensureHealthy();
      return composition.protectedMutations.recover();
    },
    getSnapshot() {
      ensureHealthy();
      return composition.protectedMutations.getSnapshot();
    },
  });
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
  const registry = requireRegistry(syncStateRegistry);
  const nextKey = requireIdFactory(createIdempotencyKey);
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
    createIdempotencyKey: nextKey,
    now,
    onStageError,
  });

  const protectedMutations = guardedProtectedMutations(composition);

  return Object.freeze({
    schema: NATIVE_ACCOUNT_MEMORY_COMPOSITION_SCHEMA,
    entitlementsPort,
    memory: composition.memory,
    memorySync: composition.memorySync,
    protectedMutations,
    deferredIntents: composition.deferredIntents,
    settled: () => composition.settled(),
    refreshAuthorization: () => composition.refreshAuthorization(),
    recover: () => protectedMutations.recover(),
    getSnapshot() {
      const recovery = recoveryState(composition);
      if (recovery.snapshot === null) {
        return Object.freeze({
          schema: NATIVE_ACCOUNT_MEMORY_COMPOSITION_SCHEMA,
          state: "recovery-required",
          reason: recovery.reason,
          accountMemory: null,
          accountMutationsBlocked: true,
          entitlementEndpoint: "/account/entitlements/memory-cloud",
          syncStatePartitioning: "account-subject",
          publicCloudMemoryEnabled: false,
        });
      }
      return Object.freeze({
        schema: NATIVE_ACCOUNT_MEMORY_COMPOSITION_SCHEMA,
        state: recovery.blocked ? "recovery-required" : "protected-local-first",
        reason: recovery.reason,
        accountMemory: recovery.snapshot,
        accountMutationsBlocked: recovery.blocked,
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
