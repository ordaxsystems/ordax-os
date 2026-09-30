import assert from "node:assert/strict";
import test from "node:test";

import { ENTITLEMENTS_PORT_SCHEMA } from "../system/contracts/entitlements.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createAccountMemoryAuthorizedComposition } from "../system/services/sync/account-memory-authorized-composition.mjs";

function identitySession() {
  const snapshot = { state: "signed-in", subjectId: "account-a", displayName: "A" };
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
  };
}

function stateStore() {
  let payload = null;
  return {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "device",
    load: () => payload,
    save(value) {
      payload = value;
      return true;
    },
  };
}

function flushableDeferredFactory() {
  const stores = new Map();
  let failFlush = false;
  let flushes = 0;
  const factory = (subjectId) => {
    if (!stores.has(subjectId)) {
      let payload = null;
      stores.set(subjectId, {
        schema: SYNC_STATE_STORE_SCHEMA,
        scope: "device",
        load: () => payload,
        save(value) {
          payload = value;
          return true;
        },
        async flush() {
          flushes += 1;
          if (failFlush) throw new Error("deferred durable flush failed");
          return true;
        },
      });
    }
    return stores.get(subjectId);
  };
  factory.fail = (value) => { failFlush = value; };
  factory.flushCount = () => flushes;
  return factory;
}

function item(id = "memory-a") {
  return {
    id,
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "portable preference",
    provenance: "user-confirmed:local-continuity-flush-test",
    sourceTimestamp: "2026-09-30T02:00:00Z",
    spaceId: null,
    projectId: null,
  };
}

function compositionWith(deferredFactory, errors = []) {
  let ordinal = 0;
  return createAccountMemoryAuthorizedComposition({
    identitySession: identitySession(),
    entitlementsPort: Object.freeze({
      schema: ENTITLEMENTS_PORT_SCHEMA,
      async resolve(request) {
        return Object.freeze({
          subjectType: "account",
          subjectId: request.subjectId,
          key: "memory.cloud.enabled",
          decision: "denied",
          value: null,
          authority: "server",
          expiresAt: null,
        });
      },
    }),
    memoryPort: createMemoryRuntime(),
    createSyncStateStore: () => stateStore(),
    createDeferredStateStore: deferredFactory,
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}:continuity-flush`;
    },
    onStageError(error, context) {
      errors.push({ error, context });
    },
  });
}

test("local continuity flush confirms Memory plus deferred coordination without cloud transport", async () => {
  const deferred = flushableDeferredFactory();
  const composition = compositionWith(deferred);

  await composition.settled();
  const baselineFlushes = deferred.flushCount();
  composition.memory.remember(item());
  assert.equal(composition.memorySync.pendingMutations().length, 0);
  assert.equal(composition.deferredIntents.pendingIntents().length, 1);

  assert.equal(await composition.memory.flush(), true);
  assert.equal(deferred.flushCount(), baselineFlushes + 1);
  assert.equal(composition.memorySync.pendingMutations().length, 0);
  assert.equal(composition.getSnapshot().localContinuityFlushIncludesDeferredCoordination, true);
  assert.equal(composition.getSnapshot().deferredDurabilityHealthy, true);
});

test("local continuity flush fails closed when deferred coordination cannot become durable", async () => {
  const errors = [];
  const deferred = flushableDeferredFactory();
  const composition = compositionWith(deferred, errors);

  await composition.settled();
  composition.memory.remember(item());
  deferred.fail(true);

  await assert.rejects(composition.memory.flush(), /deferred durable flush failed/);
  const failed = composition.getSnapshot();
  assert.equal(failed.deferredStageHealthy, true);
  assert.equal(failed.deferredDurabilityHealthy, false);
  assert.equal(failed.deferredReplayHealthy, true);
  assert.equal(failed.deferredCoordinationHealthy, false);
  assert.equal(failed.deferredCoordinationFailurePhase, "durability");
  assert.equal(errors.at(-1).context.kind, "durability-flush");

  deferred.fail(false);
  assert.equal(await composition.memory.flush(), true);
  const recovered = composition.getSnapshot();
  assert.equal(recovered.deferredDurabilityHealthy, true);
  assert.equal(recovered.deferredCoordinationHealthy, true);
  assert.equal(recovered.deferredCoordinationFailurePhase, null);
});
