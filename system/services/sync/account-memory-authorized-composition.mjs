import { createAccountMemorySyncComposition } from "./account-memory-composition.mjs";
import { createAccountMemoryEntitlementSession } from "./account-memory-entitlement-session.mjs";

export const ACCOUNT_MEMORY_AUTHORIZED_COMPOSITION_SCHEMA = "ordax.account-memory-authorized-composition/1";

export function createAccountMemoryAuthorizedComposition({
  identitySession,
  entitlementsPort,
  memoryPort,
  createSyncStateStore,
  createIdempotencyKey,
  now = () => new Date(),
  onStageError = null,
} = {}) {
  const entitlementSession = createAccountMemoryEntitlementSession({
    identitySession,
    entitlementsPort,
    now,
  });
  const memoryComposition = createAccountMemorySyncComposition({
    identitySession,
    memoryPort,
    createSyncStateStore,
    authorizeSync(descriptor) {
      return entitlementSession.authorize(descriptor);
    },
    createIdempotencyKey,
    onStageError,
  });

  let destroyed = false;

  const snapshot = () => {
    if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
    return Object.freeze({
      schema: ACCOUNT_MEMORY_AUTHORIZED_COMPOSITION_SCHEMA,
      entitlement: entitlementSession.getSnapshot(),
      memory: memoryComposition.getSnapshot(),
      authorizationEnforcedAtTransportBoundary: true,
      localFirstWhileAuthorizationUnavailable: true,
      productionPromoted: false,
    });
  };

  return Object.freeze({
    schema: ACCOUNT_MEMORY_AUTHORIZED_COMPOSITION_SCHEMA,
    memory: memoryComposition.memory,
    baseMemory: memoryComposition.baseMemory,
    memorySync: memoryComposition.memorySync,
    entitlementSession,
    getSnapshot: snapshot,
    async settled() {
      if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
      await entitlementSession.settled();
      return snapshot();
    },
    async refreshAuthorization() {
      if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
      await entitlementSession.refresh();
      return snapshot();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      memoryComposition.destroy();
      entitlementSession.destroy();
    },
  });
}
