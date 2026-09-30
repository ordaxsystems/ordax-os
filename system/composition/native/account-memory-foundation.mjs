import { assertMemoryPort } from "../../contracts/memory.mjs";
import { SYNC_STATE_CONTAINER_SCHEMA } from "../../services/sync/state-store-registry.mjs";
import { createNativeAccountMemoryComposition } from "./account-memory.mjs";

export const NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA = "ordax.native-account-memory-foundation/1";

function localOnly(memory, reason, scope = null) {
  const snapshot = Object.freeze({
    schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
    state: "local-only",
    reason,
    syncStateScope: scope,
    protectedMutationsAvailable: false,
    accountMutationsBlocked: false,
    cloudTransportWired: false,
    productionPromoted: false,
  });
  return Object.freeze({
    schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
    memory,
    memorySync: null,
    protectedMutations: null,
    accountMemory: null,
    settled: async () => snapshot,
    getSnapshot: () => snapshot,
    destroy() {},
  });
}

function requireCompatibleRegistry(value) {
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

function isPersistedCoordinationRecoveryError(value) {
  let error = value;
  while (error instanceof Error) {
    if (
      error.message.includes("requires explicit recovery")
      || error.message.startsWith("Sync-state root payload ")
      || error.message.startsWith("Sync-state container ")
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
    const blocked = snapshot.accountMemory?.memory?.memorySync?.recoveryBlocked === true;
    return Object.freeze({
      blocked,
      reason: blocked
        ? (snapshot.accountMemory.memory.memorySync.recoveryBlockReason ?? "coordination-recovery-required")
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

function recoveryRequired(memory, scope, reason = "coordination-state-incompatible") {
  const fail = async () => {
    throw new Error("Native Account Memory coordination requires recovery");
  };
  const protectedMutations = Object.freeze({
    remember: fail,
    forget: fail,
    recover: fail,
  });
  return Object.freeze({
    schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
    memory,
    memorySync: null,
    protectedMutations,
    accountMemory: null,
    settled: async () => null,
    getSnapshot() {
      return Object.freeze({
        schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
        state: "recovery-required",
        reason,
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
  windowRef = globalThis.window,
  identitySession,
  memoryPort,
  syncStateRegistry = null,
  createIdempotencyKey,
  now = () => new Date(),
  onStageError = null,
} = {}) {
  const memory = assertMemoryPort(memoryPort);
  if (syncStateRegistry === null) {
    return localOnly(memory, "sync-state-unavailable");
  }

  const registry = requireCompatibleRegistry(syncStateRegistry);
  if (registry.scope !== "device") {
    return localOnly(memory, "device-durable-sync-state-required", registry.scope);
  }

  let composition;
  try {
    composition = createNativeAccountMemoryComposition({
      windowRef,
      identitySession,
      memoryPort: memory,
      syncStateRegistry: registry,
      createIdempotencyKey,
      now,
      onStageError,
    });
  } catch (error) {
    if (!isPersistedCoordinationRecoveryError(error)) throw error;
    onStageError?.(error, Object.freeze({ kind: "native-account-memory-foundation" }));
    return recoveryRequired(memory, registry.scope);
  }

  let destroyed = false;
  const ensureHealthy = () => {
    const current = recoveryState(composition);
    if (current.blocked) {
      throw new Error("Native Account Memory coordination requires recovery");
    }
    return current;
  };
  const protectedMutations = Object.freeze({
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

  return Object.freeze({
    schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
    memory: composition.memory,
    memorySync: composition.memorySync,
    protectedMutations,
    accountMemory: composition,
    settled: () => composition.settled(),
    getSnapshot() {
      if (destroyed) throw new Error("Native Account Memory foundation is disposed");
      const current = recoveryState(composition);
      return Object.freeze({
        schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
        state: current.blocked ? "recovery-required" : "protected-local-first",
        reason: current.reason,
        syncStateScope: registry.scope,
        protectedMutationsAvailable: true,
        accountMutationsBlocked: current.blocked,
        entitlement: current.snapshot?.accountMemory?.entitlement ?? null,
        crashRecovery: current.snapshot?.accountMemory?.crashRecovery ?? null,
        cloudTransportWired: false,
        productionPromoted: false,
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      composition.destroy();
    },
  });
}
