import { createAccountMemorySyncComposition } from "./account-memory-composition.mjs";
import { createAccountMemoryDeferredIntents } from "./account-memory-deferred-intents.mjs";
import { createAccountMemoryEntitlementSession } from "./account-memory-entitlement-session.mjs";

export const ACCOUNT_MEMORY_AUTHORIZED_COMPOSITION_SCHEMA = "ordax.account-memory-authorized-composition/1";

export function createAccountMemoryAuthorizedComposition({
  identitySession,
  entitlementsPort,
  memoryPort,
  createSyncStateStore,
  createDeferredStateStore,
  createIdempotencyKey,
  now = () => new Date(),
  onStageError = null,
} = {}) {
  const entitlementSession = createAccountMemoryEntitlementSession({
    identitySession,
    entitlementsPort,
    now,
  });
  const deferredIntents = createAccountMemoryDeferredIntents({
    identitySession,
    memoryPort,
    createDeferredStateStore,
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
    onStageResult(result, context) {
      deferredIntents.observeStageResult(result, context);
    },
  });

  let destroyed = false;

  const snapshot = () => {
    if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
    return Object.freeze({
      schema: ACCOUNT_MEMORY_AUTHORIZED_COMPOSITION_SCHEMA,
      entitlement: entitlementSession.getSnapshot(),
      deferredIntents: deferredIntents.getSnapshot(),
      memory: memoryComposition.getSnapshot(),
      authorizationEnforcedAtTransportBoundary: true,
      localFirstWhileAuthorizationUnavailable: true,
      deferredStateStoresPortableContent: false,
      productionPromoted: false,
    });
  };

  const settleAndReplay = async (refresh) => {
    if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
    if (refresh) await entitlementSession.refresh();
    else await entitlementSession.settled();
    const replay = deferredIntents.replay(memoryComposition.memorySync);
    return Object.freeze({ snapshot: snapshot(), replay });
  };

  return Object.freeze({
    schema: ACCOUNT_MEMORY_AUTHORIZED_COMPOSITION_SCHEMA,
    memory: memoryComposition.memory,
    baseMemory: memoryComposition.baseMemory,
    memorySync: memoryComposition.memorySync,
    entitlementSession,
    deferredIntents,
    getSnapshot: snapshot,
    async settled() {
      return (await settleAndReplay(false)).snapshot;
    },
    async refreshAuthorization() {
      return (await settleAndReplay(true)).snapshot;
    },
    async replayDeferredIntents() {
      if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
      return deferredIntents.replay(memoryComposition.memorySync);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      memoryComposition.destroy();
      deferredIntents.destroy();
      entitlementSession.destroy();
    },
  });
}
