import { assertIdentitySessionPort, validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
import { MEMORY_MUTATION_PORT_SCHEMA } from "../../contracts/memory-mutation.mjs";
import {
  MAX_MEMORY_SEARCH_OFFSET,
  MAX_MEMORY_SEARCH_RESULTS,
  assertMemoryPort,
  validateMemoryForgetRequest,
  validateMemoryItem,
} from "../../contracts/memory.mjs";
import { createAccountMemorySyncComposition } from "./account-memory-composition.mjs";
import { createAccountMemoryCrashRecoveryJournal } from "./account-memory-crash-recovery-journal.mjs";
import { createAccountMemoryDeferredIntents } from "./account-memory-deferred-intents.mjs";
import { createAccountMemoryEntitlementSession } from "./account-memory-entitlement-session.mjs";
import { classifyMemoryForAccountSync } from "./account-memory-runtime.mjs";

export const ACCOUNT_MEMORY_AUTHORIZED_COMPOSITION_SCHEMA = "ordax.account-memory-authorized-composition/1";
export const ACCOUNT_MEMORY_PROTECTED_MUTATIONS_SCHEMA = "ordax.account-memory-protected-mutations/1";

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

function accountIdentity(value) {
  const request = validateMemoryForgetRequest({
    id: value?.id,
    ownerKind: value?.ownerKind,
    ownerId: value?.ownerId,
  });
  if (request.ownerKind !== "account") {
    throw new TypeError("Protected Account Memory mutation requires account ownership");
  }
  return Object.freeze({
    id: request.id,
    ownerKind: "account",
    ownerId: request.ownerId,
  });
}

export function createAccountMemoryAuthorizedComposition({
  identitySession,
  entitlementsPort,
  memoryPort,
  createSyncStateStore,
  createDeferredStateStore,
  createCrashRecoveryStateStore = null,
  createIdempotencyKey,
  now = () => new Date(),
  onStageError = null,
} = {}) {
  const identity = assertIdentitySessionPort(identitySession);
  if (onStageError != null && typeof onStageError !== "function") {
    throw new TypeError("Authorized Account Memory composition onStageError must be a function");
  }
  if (createCrashRecoveryStateStore != null && typeof createCrashRecoveryStateStore !== "function") {
    throw new TypeError("Authorized Account Memory composition crash recovery store factory must be a function");
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
  let lastProtectedMutationError = null;
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

  if (
    createCrashRecoveryStateStore !== null
    && typeof memoryComposition.baseMemory.getPersistenceSnapshot !== "function"
  ) {
    memoryComposition.destroy();
    deferredIntents.destroy();
    entitlementSession.destroy();
    throw new TypeError("Protected Account Memory requires local persistence introspection");
  }

  const crashRecovery = createCrashRecoveryStateStore === null
    ? null
    : createAccountMemoryCrashRecoveryJournal({
      identitySession: identity,
      memoryPort: memoryComposition.baseMemory,
      createJournalStateStore: createCrashRecoveryStateStore,
    });

  let destroyed = false;
  let lastReplayError = null;
  let lifecycleReplayPromise = Promise.resolve(null);

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

  const requireDeferredDeviceDurability = async () => {
    try {
      const flushed = await deferredIntents.flush();
      const persistence = deferredIntents.getSnapshot().queuePersistence;
      if (flushed !== true || persistence !== "device") {
        throw new Error("Deferred Memory coordination is not device-durable");
      }
      lastDurabilityError = null;
      return true;
    } catch (error) {
      lastDurabilityError = error;
      reportStageError(error, Object.freeze({ kind: "protected-deferred-durability" }));
      throw error;
    }
  };

  const requireCanonicalDeviceDurability = async () => {
    const active = validateIdentitySessionSnapshot(identity.getSnapshot());
    if (active.state !== "signed-in") {
      lastCanonicalDurabilityError = null;
      return true;
    }
    try {
      if (typeof memoryComposition.memorySync.flushCoordination !== "function") {
        throw new Error("Account Memory canonical coordination durability is unavailable");
      }
      const confirmation = await memoryComposition.memorySync.flushCoordination();
      if (!confirmation?.confirmed || confirmation.persistence !== "device") {
        throw new Error(
          `Account Memory canonical coordination is not device-durable: ${confirmation?.reason ?? "unknown"}`,
        );
      }
      lastCanonicalDurabilityError = null;
      return true;
    } catch (error) {
      lastCanonicalDurabilityError = error;
      reportStageError(error, Object.freeze({ kind: "canonical-durability-flush" }));
      throw error;
    }
  };

  const requireLocalMemoryDeviceDurability = async () => {
    const flushed = await memoryComposition.baseMemory.flush();
    if (flushed !== true) {
      throw new Error("Local Memory persistence flush was not confirmed");
    }
    const persistence = memoryComposition.baseMemory.getPersistenceSnapshot?.();
    if (!persistence || persistence.scope !== "device" || persistence.durable !== true) {
      throw new Error("Protected Account Memory requires device-durable local Memory");
    }
    return true;
  };

  const snapshot = () => {
    if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
    return Object.freeze({
      schema: ACCOUNT_MEMORY_AUTHORIZED_COMPOSITION_SCHEMA,
      entitlement: entitlementSession.getSnapshot(),
      deferredIntents: deferredIntents.getSnapshot(),
      memory: memoryComposition.getSnapshot(),
      crashRecovery: crashRecovery?.getSnapshot() ?? null,
      authorizationEnforcedAtTransportBoundary: true,
      localFirstWhileAuthorizationUnavailable: true,
      deferredStateStoresPortableContent: false,
      automaticIdentityLifecycleReplay: true,
      localContinuityFlushIncludesCanonicalCoordination: true,
      localContinuityFlushIncludesDeferredCoordination: true,
      protectedMutationBoundaryAvailable: crashRecovery !== null,
      protectedMutationRequiresDeviceMemory: true,
      automaticCrashRecovery: false,
      protectedMutationHealthy: lastProtectedMutationError === null,
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

  const replayCurrent = async () => {
    try {
      const replay = await deferredIntents.replayDurably(memoryComposition.memorySync, {
        flushCanonical: requireCanonicalDeviceDurability,
      });
      lastReplayError = null;
      return replay;
    } catch (error) {
      lastReplayError = error;
      throw error;
    }
  };

  const scheduleLifecycleReplay = () => {
    lifecycleReplayPromise = entitlementSession.settled()
      .then(async () => {
        if (destroyed) return null;
        const replay = await replayCurrent();
        await requireCanonicalDeviceDurability();
        await flushDeferredCoordination();
        return replay;
      })
      .catch((error) => {
        if (lastDurabilityError !== error && lastCanonicalDurabilityError !== error) lastReplayError = error;
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
    crashRecovery?.destroy();
    deferredIntents.destroy();
    entitlementSession.destroy();
    throw new TypeError("Authorized Account Memory composition requires identity unsubscribe support");
  }

  const flushLocalContinuity = async () => {
    if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
    await memoryComposition.memory.flush();
    await requireCanonicalDeviceDurability();
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

  const observeProtectedStage = async (kind, value, operation, extraContext = {}) => {
    const context = Object.freeze({ kind, value, ...extraContext });
    const objectId = value?.id ?? null;
    const hadDeferredOwnership = objectId !== null
      && deferredIntents.pendingIntents().some((intent) => intent.id === objectId);

    let result;
    let observation;
    try {
      result = operation();
      observation = deferredIntents.observeStageResult(result, context);
      lastStageError = null;
    } catch (error) {
      lastStageError = error;
      reportStageError(error, context);
      throw error;
    }

    if (observation.status === "canonical-owner") {
      await requireCanonicalDeviceDurability();
      if (hadDeferredOwnership) await requireDeferredDeviceDurability();
      return Object.freeze({ result, observation });
    }
    if (observation.status === "deferred") {
      await requireDeferredDeviceDurability();
      return Object.freeze({ result, observation });
    }
    if (result.status === "local-only" && ["local-only", "unchanged"].includes(observation.status)) {
      return Object.freeze({ result, observation });
    }
    throw new Error(
      `Protected Account Memory could not transfer recovery ownership: ${result.status}/${observation.status}`,
    );
  };

  const assertProtectedAvailable = () => {
    if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
    if (crashRecovery === null) {
      throw new Error("Protected Account Memory mutation boundary is not configured");
    }
    return crashRecovery;
  };

  const protectedMutations = Object.freeze({
    schema: ACCOUNT_MEMORY_PROTECTED_MUTATIONS_SCHEMA,
    async remember(value) {
      const recovery = assertProtectedAvailable();
      const normalized = validateMemoryItem(value);
      const identityValue = accountIdentity(normalized);
      const previous = findCurrentMemoryItem(
        memoryComposition.baseMemory,
        identityValue.ownerId,
        identityValue.id,
      );
      let saved = null;
      try {
        const result = await recovery.runProtectedMutation({
          identity: identityValue,
          mutate() {
            saved = memoryComposition.baseMemory.remember(normalized);
            return saved;
          },
          flushLocal: requireLocalMemoryDeviceDurability,
          async reconcile() {
            const active = validateIdentitySessionSnapshot(identity.getSnapshot());
            if (active.state !== "signed-in" || active.subjectId !== identityValue.ownerId) {
              throw new Error("Account identity changed during protected Memory mutation");
            }
            const currentClassification = classifyMemoryForAccountSync(saved, {
              subjectId: identityValue.ownerId,
            });
            if (previous) {
              const previousClassification = classifyMemoryForAccountSync(previous, {
                subjectId: identityValue.ownerId,
              });
              if (previousClassification.eligible && !currentClassification.eligible) {
                await observeProtectedStage(
                  "delete",
                  identityValue,
                  () => memoryComposition.memorySync.stageForget(identityValue),
                  { transition: "portable-to-local-only", localItem: saved },
                );
                return true;
              }
            }
            await observeProtectedStage(
              "upsert",
              saved,
              () => memoryComposition.memorySync.stageUpsert(saved),
            );
            return true;
          },
        });
        lastProtectedMutationError = null;
        return result;
      } catch (error) {
        lastProtectedMutationError = error;
        throw error;
      }
    },
    async forget(value) {
      const recovery = assertProtectedAvailable();
      const request = validateMemoryForgetRequest(value);
      const identityValue = accountIdentity(request);
      const previous = findCurrentMemoryItem(
        memoryComposition.baseMemory,
        identityValue.ownerId,
        identityValue.id,
      );
      if (previous === null) return false;

      try {
        const result = await recovery.runProtectedMutation({
          identity: identityValue,
          mutate() {
            const forgotten = memoryComposition.baseMemory.forget(request);
            if (forgotten !== true) {
              throw new Error("Protected Account Memory forget lost its local mutation target");
            }
            return true;
          },
          flushLocal: requireLocalMemoryDeviceDurability,
          async reconcile() {
            const active = validateIdentitySessionSnapshot(identity.getSnapshot());
            if (active.state !== "signed-in" || active.subjectId !== identityValue.ownerId) {
              throw new Error("Account identity changed during protected Memory mutation");
            }
            await observeProtectedStage(
              "delete",
              identityValue,
              () => memoryComposition.memorySync.stageForget(identityValue),
            );
            return true;
          },
        });
        lastProtectedMutationError = null;
        return result;
      } catch (error) {
        lastProtectedMutationError = error;
        throw error;
      }
    },
    async recover() {
      const recovery = assertProtectedAvailable();
      try {
        await requireLocalMemoryDeviceDurability();
        const result = await recovery.recover(memoryComposition.memorySync, {
          flushCoordination: requireCanonicalDeviceDurability,
        });
        lastProtectedMutationError = null;
        return result;
      } catch (error) {
        lastProtectedMutationError = error;
        throw error;
      }
    },
    getSnapshot() {
      const recovery = assertProtectedAvailable();
      return Object.freeze({
        schema: ACCOUNT_MEMORY_PROTECTED_MUTATIONS_SCHEMA,
        journal: recovery.getSnapshot(),
        healthy: lastProtectedMutationError === null,
        requiresDeviceMemory: true,
        automaticRecovery: false,
        productionPromoted: false,
      });
    },
  });

  const mutationPort = Object.freeze({
    schema: MEMORY_MUTATION_PORT_SCHEMA,
    remember(value) {
      return protectedMutations.remember(value);
    },
    forget(value) {
      return protectedMutations.forget(value);
    },
  });

  const settleAndReplay = async (refresh) => {
    if (destroyed) throw new Error("Authorized Account Memory composition is disposed");
    if (refresh) await entitlementSession.refresh();
    else await entitlementSession.settled();
    await replayCurrent();
    await requireCanonicalDeviceDurability();
    await flushDeferredCoordination();
    return snapshot();
  };

  return Object.freeze({
    schema: ACCOUNT_MEMORY_AUTHORIZED_COMPOSITION_SCHEMA,
    memory,
    mutationPort,
    protectedMutations,
    baseMemory: memoryComposition.baseMemory,
    memorySync: memoryComposition.memorySync,
    entitlementSession,
    deferredIntents,
    crashRecovery,
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
      const replay = await replayCurrent();
      await requireCanonicalDeviceDurability();
      await flushDeferredCoordination();
      return replay;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeIdentity();
      crashRecovery?.destroy();
      memoryComposition.destroy();
      deferredIntents.destroy();
      entitlementSession.destroy();
    },
  });
}
