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

function blockedMutations() {
  const fail = async () => {
    throw new Error("Native Account Memory coordination requires recovery");
  };
  return Object.freeze({
    remember: fail,
    forget: fail,
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
        return registry.open("memory", { partitionKey: subjectId });
      },
      createDeferredStateStore(subjectId) {
        return registry.open("memory-deferred", { partitionKey: subjectId });
      },
      createCrashRecoveryStateStore(subjectId) {
        return registry.open("memory-crash", { partitionKey: subjectId });
      },
      createIdempotencyKey(kind = "state") {
        ordinal += 1;
        return createIdempotencyKey(kind, ordinal);
      },
      now,
      onStageError,
    });
  } catch (error) {
    if (typeof onStageError === "function") {
      onStageError(error, Object.freeze({ kind: "native-account-memory-foundation" }));
    }
    return recoveryRequiredFoundation(registry.scope);
  }

  let destroyed = false;
  return Object.freeze({
    schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
    protectedMutations: accountMemory.protectedMutations,
    accountMemory,
    getSnapshot() {
      if (destroyed) throw new Error("Native Account Memory foundation is disposed");
      const current = accountMemory.getSnapshot();
      return Object.freeze({
        schema: NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA,
        state: "protected-local-first",
        reason: null,
        syncStateScope: registry.scope,
        protectedMutationsAvailable: true,
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
