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

function createInboundAuthorizedMemorySync(memorySync, accountMemory, now) {
  const inboundAuthorized = () => {
    const entitlement = accountMemory.getSnapshot().entitlement;
    const sync = memorySync.getSnapshot();
    if (
      sync.subjectId === null
      || entitlement.state !== "resolved"
      || entitlement.decision !== "allowed"
      || entitlement.authority !== "server"
      || entitlement.subjectId !== sync.subjectId
    ) {
      return false;
    }
    if (entitlement.expiresAt !== null && Date.parse(entitlement.expiresAt) <= now().getTime()) {
      return false;
    }
    return true;
  };

  return Object.freeze({
    schema: memorySync.schema,
    sessionSchema: memorySync.sessionSchema,
    getSnapshot: () => memorySync.getSnapshot(),
    async applyRemoteBatch(values) {
      if (!inboundAuthorized()) {
        throw new Error("Account Memory inbound restore authorization is required");
      }
      return memorySync.applyRemoteBatch(values);
    },
    flush: (transport) => memorySync.flush(transport),
    flushCoordination: () => memorySync.flushCoordination(),
    stageUpsert: (value) => memorySync.stageUpsert(value),
    stageForget: (value) => memorySync.stageForget(value),
    pendingMutations: () => memorySync.pendingMutations(),
    pendingConflicts: () => memorySync.pendingConflicts(),
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
  const memorySync = createInboundAuthorizedMemorySync(composition.memorySync, composition, now);

  return Object.freeze({
    schema: NATIVE_ACCOUNT_MEMORY_COMPOSITION_SCHEMA,
    entitlementsPort,
    memory: composition.memory,
    memorySync,
    protectedMutations: composition.protectedMutations,
    deferredIntents: composition.deferredIntents,
    settled: () => composition.settled(),
    refreshAuthorization: () => composition.refreshAuthorization(),
    getSnapshot() {
      return Object.freeze({
        schema: NATIVE_ACCOUNT_MEMORY_COMPOSITION_SCHEMA,
        accountMemory: composition.getSnapshot(),
        entitlementEndpoint: "/account/entitlements/memory-cloud",
        syncStatePartitioning: "account-subject",
        inboundRestoreAuthorizationRequired: true,
        publicCloudMemoryEnabled: false,
      });
    },
    destroy() {
      composition.destroy();
    },
  });
}
