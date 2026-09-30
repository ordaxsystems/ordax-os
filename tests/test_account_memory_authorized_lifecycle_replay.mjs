import assert from "node:assert/strict";
import test from "node:test";

import { ENTITLEMENTS_PORT_SCHEMA } from "../system/contracts/entitlements.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createAccountMemoryAuthorizedComposition } from "../system/services/sync/account-memory-authorized-composition.mjs";

function identitySession() {
  let snapshot = { state: "signed-in", subjectId: "account-a", displayName: "A" };
  const listeners = new Set();
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    set(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

function stores() {
  const values = new Map();
  return (subjectId) => {
    if (!values.has(subjectId)) {
      let payload = null;
      values.set(subjectId, {
        schema: SYNC_STATE_STORE_SCHEMA,
        scope: "device",
        load: () => payload,
        save(value) {
          payload = value;
          return true;
        },
      });
    }
    return values.get(subjectId);
  };
}

function item(subjectId, id) {
  return {
    id,
    ownerKind: "account",
    ownerId: subjectId,
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: `local intent for ${subjectId}`,
    provenance: "user-confirmed:lifecycle-replay-test",
    sourceTimestamp: "2026-09-30T01:20:00Z",
    spaceId: null,
    projectId: null,
  };
}

function entitlement(subjectId, allowed) {
  return {
    subjectType: "account",
    subjectId,
    key: "memory.cloud.enabled",
    decision: allowed ? "allowed" : "denied",
    value: null,
    authority: "server",
    expiresAt: null,
  };
}

test("returning to an account automatically replays its deferred Memory after entitlement refresh", async () => {
  const identity = identitySession();
  const memory = createMemoryRuntime();
  const allowed = new Map([["account-a", false], ["account-b", false]]);
  let ordinal = 0;
  const composition = createAccountMemoryAuthorizedComposition({
    identitySession: identity,
    entitlementsPort: {
      schema: ENTITLEMENTS_PORT_SCHEMA,
      async resolve(request) {
        return entitlement(request.subjectId, allowed.get(request.subjectId) === true);
      },
    },
    memoryPort: memory,
    createSyncStateStore: stores(),
    createDeferredStateStore: stores(),
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}:lifecycle-replay`;
    },
  });

  await composition.settled();
  composition.memory.remember(item("account-a", "memory-a"));
  assert.equal(composition.memorySync.pendingMutations().length, 0);
  assert.equal(composition.deferredIntents.pendingIntents().length, 1);

  identity.set({ state: "signed-in", subjectId: "account-b", displayName: "B" });
  await composition.entitlementSession.settled();
  assert.equal(composition.deferredIntents.pendingIntents().length, 0);

  allowed.set("account-a", true);
  identity.set({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  await composition.entitlementSession.settled();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(composition.entitlementSession.getSnapshot().decision, "allowed");
  assert.equal(composition.deferredIntents.pendingIntents().length, 0);
  assert.equal(composition.memorySync.pendingMutations().length, 1);
  assert.equal(composition.memorySync.pendingMutations()[0].objectId, "memory-a");
  assert.equal(composition.getSnapshot().automaticIdentityLifecycleReplay, true);
  assert.equal(composition.getSnapshot().deferredReplayHealthy, true);
});
