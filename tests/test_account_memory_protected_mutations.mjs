import assert from "node:assert/strict";
import test from "node:test";

import { ENTITLEMENTS_PORT_SCHEMA } from "../system/contracts/entitlements.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { MEMORY_STORE_SCHEMA } from "../system/contracts/memory-store.mjs";
import { MEMORY_MUTATION_PORT_SCHEMA } from "../system/contracts/memory-mutation.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createAccountMemoryAuthorizedComposition } from "../system/services/sync/account-memory-authorized-composition.mjs";

function identitySession(subjectId = "account-a") {
  let snapshot = { state: "signed-in", subjectId, displayName: "A" };
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

function deviceMemoryStore(events = []) {
  let snapshot = null;
  let failFlush = false;
  return {
    schema: MEMORY_STORE_SCHEMA,
    scope: "device",
    load() {
      return snapshot;
    },
    save(value) {
      events.push("memory-save");
      snapshot = value;
      return true;
    },
    async flush() {
      events.push("memory-flush");
      if (failFlush) throw new Error("memory flush failed");
      return true;
    },
    setFailFlush(value) {
      failFlush = value;
    },
    read() {
      return snapshot;
    },
  };
}

function stateStoreFactory(label, events = [], initialScope = "device") {
  const stores = new Map();
  const factory = (subjectId) => {
    if (!stores.has(subjectId)) {
      let payload = null;
      let scope = initialScope;
      let failSave = false;
      let failFlush = false;
      const writes = [];
      stores.set(subjectId, {
        schema: SYNC_STATE_STORE_SCHEMA,
        get scope() {
          return scope;
        },
        load() {
          return payload;
        },
        save(value) {
          events.push(`${label}-save`);
          writes.push(value);
          if (failSave) return false;
          payload = value;
          return true;
        },
        async flush() {
          events.push(`${label}-flush`);
          if (failFlush) throw new Error(`${label} flush failed`);
          return true;
        },
        setFailSave(value) {
          failSave = value;
        },
        setFailFlush(value) {
          failFlush = value;
        },
        setScope(value) {
          scope = value;
        },
        read() {
          return payload;
        },
        writes,
      });
    }
    return stores.get(subjectId);
  };
  factory.stores = stores;
  return factory;
}

function entitlement(subjectId, allowed) {
  return Object.freeze({
    subjectType: "account",
    subjectId,
    key: "memory.cloud.enabled",
    decision: allowed ? "allowed" : "denied",
    value: null,
    authority: "server",
    expiresAt: null,
  });
}

function memoryItem(id = "memory-a", overrides = {}) {
  return {
    id,
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: `protected content ${id}`,
    provenance: "user-confirmed:protected-mutation-test",
    sourceTimestamp: "2026-09-30T02:40:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function find(memory, id = "memory-a") {
  return memory.search({
    ownerKind: "account",
    ownerId: "account-a",
    scopes: ["account"],
    includeRestricted: true,
    limit: 20,
    offset: 0,
  }).find((entry) => entry.id === id) ?? null;
}

function createHarness({
  events = [],
  allowed = { value: true },
  memoryStore = deviceMemoryStore(events),
  syncStores = stateStoreFactory("sync", events),
  deferredStores = stateStoreFactory("deferred", events),
  journalStores = stateStoreFactory("journal", events),
  identity = identitySession(),
} = {}) {
  const memory = memoryStore === null
    ? createMemoryRuntime()
    : createMemoryRuntime({ store: memoryStore });
  let ordinal = 0;
  const composition = createAccountMemoryAuthorizedComposition({
    identitySession: identity,
    entitlementsPort: {
      schema: ENTITLEMENTS_PORT_SCHEMA,
      async resolve(request) {
        return entitlement(request.subjectId, allowed.value === true);
      },
    },
    memoryPort: memory,
    createSyncStateStore: syncStores,
    createDeferredStateStore: deferredStores,
    createCrashRecoveryStateStore: journalStores,
    createIdempotencyKey(kind) {
      ordinal += 1;
      return `memory:${kind}:${ordinal}:protected-boundary`;
    },
  });
  return {
    identity,
    memory,
    memoryStore,
    syncStores,
    deferredStores,
    journalStores,
    composition,
  };
}

async function settledHarness(options = {}) {
  const harness = createHarness(options);
  await harness.composition.settled();
  options.events?.splice(0);
  return harness;
}

test("authorized composition exposes protected Account Memory through the generic mutation port", async () => {
  const harness = await settledHarness();

  assert.equal(harness.composition.mutationPort.schema, MEMORY_MUTATION_PORT_SCHEMA);
  const saved = await harness.composition.mutationPort.remember(memoryItem("memory-port"));
  assert.equal(saved.id, "memory-port");
  assert.equal(harness.composition.memorySync.pendingMutations().length, 1);
  assert.equal(harness.composition.crashRecovery.pendingIdentities().length, 0);

  assert.equal(await harness.composition.mutationPort.forget({
    id: "memory-port",
    ownerKind: "account",
    ownerId: "account-a",
  }), true);
  assert.equal(harness.composition.crashRecovery.pendingIdentities().length, 0);
});

test("authorized protected remember arms journal before local mutation and clears only after canonical durability", async () => {
  const events = [];
  const harness = await settledHarness({ events });

  const saved = await harness.composition.protectedMutations.remember(memoryItem());

  assert.equal(saved.id, "memory-a");
  assert.deepEqual(events, [
    "journal-save",
    "journal-flush",
    "memory-save",
    "memory-flush",
    "sync-save",
    "sync-flush",
    "journal-save",
    "journal-flush",
  ]);
  assert.equal(harness.composition.memorySync.pendingMutations().length, 1);
  assert.equal(harness.composition.memorySync.pendingMutations()[0].operation, "upsert");
  assert.equal(harness.composition.deferredIntents.pendingIntents().length, 0);
  assert.equal(harness.composition.crashRecovery.pendingIdentities().length, 0);

  const firstJournalWrite = harness.journalStores.stores.get("account-a").writes[0];
  assert.match(firstJournalWrite, /memory-a/);
  assert.doesNotMatch(firstJournalWrite, /protected content/);
  assert.equal(harness.composition.getSnapshot().protectedMutationHealthy, true);
});

test("denied entitlement transfers protected ownership to durable identity-only deferred state", async () => {
  const events = [];
  const allowed = { value: false };
  const harness = await settledHarness({ events, allowed });

  await harness.composition.protectedMutations.remember(memoryItem());

  assert.deepEqual(events, [
    "journal-save",
    "journal-flush",
    "memory-save",
    "memory-flush",
    "deferred-save",
    "deferred-flush",
    "journal-save",
    "journal-flush",
  ]);
  assert.equal(harness.composition.memorySync.pendingMutations().length, 0);
  assert.equal(harness.composition.deferredIntents.pendingIntents().length, 1);
  assert.equal(harness.composition.deferredIntents.pendingIntents()[0].operation, "upsert");
  assert.equal(harness.composition.crashRecovery.pendingIdentities().length, 0);

  const deferredPayload = harness.deferredStores.stores.get("account-a").read();
  assert.match(deferredPayload, /memory-a/);
  assert.doesNotMatch(deferredPayload, /protected content/);
});

test("rejected canonical sync-state save keeps crash journal ownership and surfaces unhealthy state", async () => {
  const events = [];
  const harness = await settledHarness({ events });
  harness.syncStores.stores.get("account-a").setFailSave(true);

  await assert.rejects(
    harness.composition.protectedMutations.remember(memoryItem()),
    /canonical coordination is not device-durable: last-save-rejected/,
  );

  assert.equal(find(harness.memory)?.id, "memory-a");
  assert.equal(harness.composition.memorySync.pendingMutations().length, 1);
  assert.equal(harness.composition.crashRecovery.pendingIdentities().length, 1);
  assert.equal(harness.composition.getSnapshot().protectedMutationHealthy, false);
  assert.equal(events.filter((entry) => entry === "sync-save").length, 2);
  assert.equal(events.includes("journal-flush"), true);
});

test("session-only local Memory fails closed after journal arm and never stages account sync", async () => {
  const events = [];
  const harness = await settledHarness({ events, memoryStore: null });

  await assert.rejects(
    harness.composition.protectedMutations.remember(memoryItem()),
    /requires device-durable local Memory/,
  );

  assert.equal(find(harness.memory)?.id, "memory-a");
  assert.equal(harness.composition.memorySync.pendingMutations().length, 0);
  assert.equal(harness.composition.deferredIntents.pendingIntents().length, 0);
  assert.equal(harness.composition.crashRecovery.pendingIdentities().length, 1);
  assert.deepEqual(events, ["journal-save", "journal-flush"]);
});

test("restart recovery rebuilds canonical intent from device Memory and then clears journal", async () => {
  const events = [];
  const allowed = { value: true };
  const memoryStore = deviceMemoryStore(events);
  const syncStores = stateStoreFactory("sync", events);
  const deferredStores = stateStoreFactory("deferred", events);
  const journalStores = stateStoreFactory("journal", events);
  const first = await settledHarness({
    events,
    allowed,
    memoryStore,
    syncStores,
    deferredStores,
    journalStores,
  });
  syncStores.stores.get("account-a").setFailSave(true);

  await assert.rejects(
    first.composition.protectedMutations.remember(memoryItem()),
    /last-save-rejected/,
  );
  assert.equal(first.composition.crashRecovery.pendingIdentities().length, 1);
  first.composition.destroy();

  syncStores.stores.get("account-a").setFailSave(false);
  events.splice(0);
  const second = await settledHarness({
    events,
    allowed,
    memoryStore,
    syncStores,
    deferredStores,
    journalStores,
  });
  events.splice(0);

  const recovered = await second.composition.protectedMutations.recover();

  assert.equal(recovered.transferred, 1);
  assert.equal(recovered.retained, 0);
  assert.equal(second.composition.memorySync.pendingMutations().length, 1);
  assert.equal(second.composition.memorySync.pendingMutations()[0].operation, "upsert");
  assert.equal(second.composition.crashRecovery.pendingIdentities().length, 0);
  assert.equal(find(second.memory)?.content, "protected content memory-a");
  assert.deepEqual(events, [
    "memory-flush",
    "sync-save",
    "sync-flush",
    "journal-save",
    "journal-flush",
  ]);
});

test("protected forget of a missing item does not arm journal or manufacture tombstone", async () => {
  const events = [];
  const harness = await settledHarness({ events });

  const removed = await harness.composition.protectedMutations.forget({
    id: "missing",
    ownerKind: "account",
    ownerId: "account-a",
  });

  assert.equal(removed, false);
  assert.equal(harness.composition.memorySync.pendingMutations().length, 0);
  assert.equal(harness.composition.deferredIntents.pendingIntents().length, 0);
  assert.equal(harness.composition.crashRecovery.pendingIdentities().length, 0);
  assert.deepEqual(events, []);
});

test("portable to restricted transition supersedes stale pending upsert with durable delete", async () => {
  const events = [];
  const allowed = { value: true };
  const harness = await settledHarness({ events, allowed });

  await harness.composition.protectedMutations.remember(memoryItem());
  assert.equal(harness.composition.memorySync.pendingMutations()[0].operation, "upsert");

  allowed.value = false;
  await harness.composition.refreshAuthorization();
  await harness.composition.protectedMutations.remember(memoryItem("memory-a", {
    sensitivity: "restricted",
    content: "must remain local only",
    sourceTimestamp: "2026-09-30T02:41:00Z",
  }));

  assert.equal(find(harness.memory)?.sensitivity, "restricted");
  assert.equal(harness.composition.memorySync.pendingMutations()[0].operation, "upsert");
  assert.equal(harness.composition.deferredIntents.pendingIntents().length, 1);
  assert.equal(harness.composition.deferredIntents.pendingIntents()[0].operation, "delete");

  allowed.value = true;
  await harness.composition.refreshAuthorization();

  assert.equal(harness.composition.deferredIntents.pendingIntents().length, 0);
  assert.equal(harness.composition.memorySync.pendingMutations().length, 1);
  assert.equal(harness.composition.memorySync.pendingMutations()[0].operation, "delete");
  assert.deepEqual(harness.composition.memorySync.pendingMutations()[0].payload.memoryIdentity, {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
  });
});

test("durable deferred replay retains ownership on canonical persistence failure and retries exact state", async () => {
  const events = [];
  const allowed = { value: false };
  const harness = await settledHarness({ events, allowed });

  await harness.composition.protectedMutations.remember(memoryItem());
  assert.equal(harness.composition.deferredIntents.pendingIntents().length, 1);

  harness.syncStores.stores.get("account-a").setFailSave(true);
  allowed.value = true;
  await assert.rejects(
    harness.composition.refreshAuthorization(),
    /canonical coordination is not device-durable: last-save-rejected/,
  );
  assert.equal(harness.composition.deferredIntents.pendingIntents().length, 1);
  assert.equal(harness.composition.memorySync.pendingMutations().length, 1);

  const failedPayload = harness.syncStores.stores.get("account-a").writes.at(-1);
  harness.syncStores.stores.get("account-a").setFailSave(false);
  await harness.composition.refreshAuthorization();

  assert.equal(harness.composition.deferredIntents.pendingIntents().length, 0);
  assert.equal(harness.composition.memorySync.pendingMutations().length, 1);
  assert.equal(harness.composition.memorySync.pendingMutations()[0].operation, "upsert");
  const successfulPayload = harness.syncStores.stores.get("account-a").read();
  assert.equal(successfulPayload, failedPayload);
});
