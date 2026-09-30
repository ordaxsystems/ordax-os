import { assertIdentitySessionPort, validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
import { assertMemoryPort } from "../../contracts/memory.mjs";
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
  if (onStageError != null && typeof onStageError !== "function") {
    throw new TypeError("Authorized Account Memory composition onStageError must be a function");
  }
  const reportStageError = onStageError ?? (() => {});
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

  let lastStageError = null;
  let lastCanonicalDurabilityError = null;
  let lastDurabilityError = null;
  const memoryComposition = createAccountMemorySyncComposition({
    identitySession: identity,
    memoryPort,
    createSyncStateStore,
    authorizeSync(descriptor) {
      return entitlementSession.authorize(descriptor);
    },
    createIdempotencyKey,
    onStageError(error, context) {
      lastStageError = error;
      reportStageError(error, context);
    },
    onStageResult(result, context) {
      deferredIntents.observeStageResult(result, context);
      lastStageError = null;
    },
  });

  let destroyed = false;
  let lastReplayError = null;
  let lifecycleReplayPromise = Promise.resolve(null);

  const flushCanonicalCoordination = async () => {
    try {
      await memoryComposition.memorySync.flushCoordinationState();
      lastCanonicalDurabilityError = null;
      return true;
    } catch (error) {
      lastCanonicalDurabilityError = error;
      reportStageError(error, Object.freeze({ kind: "canonical-durability-flush" }));
      throw error;
    }
  };

  const flushDeferredCoordination = async () => {
    try {
      await deferredIntents.flush();
      lastDurabilityError = null;
      return true;
    } catch (error) {
      lastDurabilityError = error;
      reportStageError(error, Object.freeze({ kind: "durability-flush" }));
      throw error;
    }
  };

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
      localContinuityFlushIncludesCanonicalCoordination: true,
      localContinuityFlushIncludesDeferredCoordination: true,
      canonicalDurabilityHealthy: lastCanonicalDurabilityError === null,
      localContinuityDurabilityHealthy: lastCanonicalDurabilityError === null
        && lastDurabilityError === null,
      deferredStageHealthy: lastStageError === null,
      deferredDurabilityHealthy: lastDurabilityError === null,
      deferredReplayHealthy: lastReplayError === null,
      deferredCoordinationHealthy: lastStageError === null
        && lastDurabilityError === null
        && lastReplayError === null,
      deferredCoordinationFailurePhase: lastStageError !== null
        ? "stage"
        : (lastDurabilityError !== null
          ? "durability"
          : (lastReplayError !== null ? "replay" : null)),
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
      .then(async () => {
        if (destroyed) return null;
        const replay = replayCurrent();
        await flushCanonicalCoordination();
        await flushDeferredCoordination();
        return replay;
      })
      .catch((error) => {
        if (lastDurabilityError !== error) lastReplayError = error;
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

  const flushLocalContinuity = async () => {
    if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
    await memoryComposition.memory.flush();
    await flushCanonicalCoordination();
    await flushDeferredCoordination();
    return true;
  };

  const memory = Object.freeze({
    schema: memoryComposition.memory.schema,
    search(value) {
      return memoryComposition.memory.search(value);
    },
    remember(value) {
      return memoryComposition.memory.remember(value);
    },
    forget(value) {
      return memoryComposition.memory.forget(value);
    },
    flush: flushLocalContinuity,
  });
  assertMemoryPort(memory);

  const settleAndReplay = async (refresh) => {
    if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
    if (refresh) await entitlementSession.refresh();
    else await entitlementSession.settled();
    replayCurrent();
    await flushCanonicalCoordination();
    await flushDeferredCoordination();
    return snapshot();
  };

  return Object.freeze({
    schema: ACCOUNT_MEMORY_AUTHORIZED_COMPOSITION_SCHEMA,
    memory,
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
      const replay = replayCurrent();
      await flushCanonicalCoordination();
      await flushDeferredCoordination();
      return replay;
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
