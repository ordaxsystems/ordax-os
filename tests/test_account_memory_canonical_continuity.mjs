import assert from "node:assert/strict";
import test from "node:test";

import { ENTITLEMENTS_PORT_SCHEMA } from "../system/contracts/entitlements.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { MEMORY_STORE_SCHEMA } from "../system/contracts/memory-store.mjs";
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

function memoryStore(events) {
  let snapshot = null;
  return {
    schema: MEMORY_STORE_SCHEMA,
    scope: "device",
    load: () => snapshot,
    save(value) {
      snapshot = value;
      events.push("memory-save");
      return true;
    },
    async flush() {
      events.push("memory-flush");
      return true;
    },
  };
}

function stateFactory(label, events) {
  let failFlush = false;
  const stores = new Map();
  const factory = (subjectId) => {
    if (!stores.has(subjectId)) {
      let payload = null;
      stores.set(subjectId, {
        schema: SYNC_STATE_STORE_SCHEMA,
        scope: "device",
        load: () => payload,
        save(value) {
          payload = value;
          events.push(`${label}-save`);
          return true;
        },
        async flush() {
          events.push(`${label}-flush`);
          if (failFlush) throw new Error(`${label} flush failed`);
          return true;
        },
      });
    }
    return stores.get(subjectId);
  };
  factory.failFlush = (value) => { failFlush = value; };
  return factory;
}

function item() {
  return {
    id: "memory-continuity",
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "canonical continuity proof",
    provenance: "user-confirmed:canonical-continuity-test",
    sourceTimestamp: "2026-09-30T03:10:00Z",
    spaceId: null,
    projectId: null,
  };
}

async function harness() {
  const events = [];
  const errors = [];
  const sync = stateFactory("sync", events);
  const deferred = stateFactory("deferred", events);
  let ordinal = 0;
  const composition = createAccountMemoryAuthorizedComposition({
    identitySession: identitySession(),
    entitlementsPort: {
      schema: ENTITLEMENTS_PORT_SCHEMA,
      async resolve(request) {
        return {
          subjectType: "account",
          subjectId: request.subjectId,
          key: "memory.cloud.enabled",
          decision: "allowed",
          value: null,
          authority: "server",
          expiresAt: null,
        };
      },
    },
    memoryPort: createMemoryRuntime({ store: memoryStore(events) }),
    createSyncStateStore: sync,
    createDeferredStateStore: deferred,
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}:canonical-continuity`;
    },
    onStageError(error, context) {
      errors.push({ error, context });
    },
  });
  await composition.settled();
  events.splice(0);
  return { composition, deferred, errors, events, sync };
}

test("local continuity confirms Memory then canonical then deferred durability", async () => {
  const { composition, events } = await harness();
  composition.memory.remember(item());
  events.splice(0);

  assert.equal(await composition.memory.flush(), true);

  assert.deepEqual(events, ["memory-flush", "sync-flush", "deferred-flush"]);
  const snapshot = composition.getSnapshot();
  assert.equal(snapshot.localContinuityFlushIncludesCanonicalCoordination, true);
  assert.equal(snapshot.localContinuityFlushIncludesDeferredCoordination, true);
  assert.equal(snapshot.canonicalDurabilityHealthy, true);
  assert.equal(snapshot.localContinuityDurabilityHealthy, true);
});

test("canonical durability failure stops before deferred confirmation and health recovers only after success", async () => {
  const { composition, deferred, errors, events, sync } = await harness();
  composition.memory.remember(item());
  events.splice(0);
  sync.failFlush(true);

  await assert.rejects(composition.memory.flush(), /sync flush failed/);

  assert.deepEqual(events, ["memory-flush", "sync-flush"]);
  let snapshot = composition.getSnapshot();
  assert.equal(snapshot.canonicalDurabilityHealthy, false);
  assert.equal(snapshot.localContinuityDurabilityHealthy, false);
  assert.equal(errors.at(-1).context.kind, "canonical-durability-flush");

  sync.failFlush(false);
  events.splice(0);
  assert.equal(await composition.memory.flush(), true);
  assert.deepEqual(events, ["memory-flush", "sync-flush", "deferred-flush"]);
  snapshot = composition.getSnapshot();
  assert.equal(snapshot.canonicalDurabilityHealthy, true);
  assert.equal(snapshot.localContinuityDurabilityHealthy, true);
  assert.equal(typeof deferred, "function");
});
