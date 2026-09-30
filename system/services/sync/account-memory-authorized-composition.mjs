import { assertIdentitySessionPort, validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
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
  const identity = assertIdentitySessionPort(identitySession);
  const entitlementSession = createAccountMemoryEntitlementSession({
    identitySession: identity,
    entitlementsPort,
    now,
  });
  const deferredIntents = createAccountMemoryDeferredIntents({
    identitySession: identity,
    memoryPort,
    createDeferredStateStore,
  });
  const memoryComposition = createAccountMemorySyncComposition({
    identitySession: identity,
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
  let lastReplayError = null;
  let lifecycleReplayPromise = Promise.resolve(null);

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
      automaticIdentityLifecycleReplay: true,
      deferredReplayHealthy: lastReplayError === null,
      productionPromoted: false,
    });
  };

  const replayCurrent = () => {
    const replay = deferredIntents.replay(memoryComposition.memorySync);
    lastReplayError = null;
    return replay;
  };

  const scheduleLifecycleReplay = () => {
    lifecycleReplayPromise = entitlementSession.settled()
      .then(() => {
        if (destroyed) return null;
        return replayCurrent();
      })
      .catch((error) => {
        lastReplayError = error;
        return null;
      });
    return lifecycleReplayPromise;
  };

  const unsubscribeIdentity = identity.subscribe((value) => {
    if (destroyed) return;
    const current = validateIdentitySessionSnapshot(value);
    if (current.state === "signed-in") scheduleLifecycleReplay();
  });
  if (typeof unsubscribeIdentity !== "function") {
    memoryComposition.destroy();
    deferredIntents.destroy();
    entitlementSession.destroy();
    throw new TypeError("Authorized Account Memory composition requires identity unsubscribe support");
  }

  const settleAndReplay = async (refresh) => {
    if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
    if (refresh) await entitlementSession.refresh();
    else await entitlementSession.settled();
    replayCurrent();
    return snapshot();
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
      if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
      await lifecycleReplayPromise;
      return settleAndReplay(false);
    },
    async refreshAuthorization() {
      return settleAndReplay(true);
    },
    async replayDeferredIntents() {
      if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
      return replayCurrent();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeIdentity();
      memoryComposition.destroy();
      deferredIntents.destroy();
      entitlementSession.destroy();
    },
  });
}
