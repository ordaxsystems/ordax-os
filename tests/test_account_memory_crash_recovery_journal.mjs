import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { MEMORY_SYNC_RUNTIME_SCHEMA } from "../system/services/sync/account-memory-runtime.mjs";
import { createAccountMemoryCrashRecoveryJournal } from "../system/services/sync/account-memory-crash-recovery-journal.mjs";

function identitySession(subjectId = "account-a") {
  const snapshot = { state: "signed-in", subjectId, displayName: "A" };
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
  };
}

function durableStore(events = []) {
  let payload = null;
  return {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "device",
    load: () => payload,
    save(value) {
      payload = value;
      events.push("journal-save");
      return true;
    },
    async flush() {
      events.push("journal-flush");
      return true;
    },
    read: () => payload,
  };
}


function sessionJournalStore({ withFlush = true } = {}) {
  let payload = null;
  const store = {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "session",
    load: () => payload,
    save(value) {
      payload = value;
      return true;
    },
  };
  if (withFlush) {
    store.flush = async () => true;
  }
  return store;
}

function item(overrides = {}) {
  return {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "private portable content that must never enter the crash journal",
    provenance: "user-confirmed:crash-journal-test",
    sourceTimestamp: "2026-09-30T02:30:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function syncRuntime({ authorizationAllowed = true } = {}) {
  const staged = [];
  return {
    staged,
    runtime: Object.freeze({
      schema: MEMORY_SYNC_RUNTIME_SCHEMA,
      stageUpsert(value) {
        if (!authorizationAllowed) return Object.freeze({ status: "blocked", reason: "authorization-required" });
        staged.push({ operation: "upsert", value });
        return Object.freeze({ status: "pending", objectId: value.id });
      },
      stageForget(value) {
        if (!authorizationAllowed) return Object.freeze({ status: "blocked", reason: "authorization-required" });
        staged.push({ operation: "delete", value });
        return Object.freeze({ status: "pending", objectId: value.id });
      },
      pendingMutations() {
        return Object.freeze([]);
      },
      pendingConflicts() {
        return Object.freeze([]);
      },
    }),
  };
}

function journal(memory, store) {
  return createAccountMemoryCrashRecoveryJournal({
    identitySession: identitySession(),
    memoryPort: memory,
    createJournalStateStore: () => store,
  });
}

test("protected mutation durably arms identity-only journal before local mutation", async () => {
  const events = [];
  const memory = createMemoryRuntime();
  const store = durableStore(events);
  const recovery = journal(memory, store);

  const result = await recovery.runProtectedMutation({
    identity: { id: "memory-a", ownerKind: "account", ownerId: "account-a" },
    mutate() {
      events.push("mutate");
      return memory.remember(item());
    },
    async flushLocal() {
      events.push("local-flush");
      await memory.flush();
    },
    async reconcile() {
      events.push("coordination-flush");
      return true;
    },
  });

  assert.equal(result.id, "memory-a");
  assert.deepEqual(events.slice(0, 3), ["journal-save", "journal-flush", "mutate"]);
  assert.ok(events.indexOf("local-flush") < events.indexOf("coordination-flush"));
  assert.equal(recovery.pendingIdentities().length, 0);
  assert.doesNotMatch(store.read(), /private portable content/);
});

test("local persistence failure keeps the armed identity for reboot recovery", async () => {
  const memory = createMemoryRuntime();
  const store = durableStore();
  const recovery = journal(memory, store);

  await assert.rejects(
    recovery.runProtectedMutation({
      identity: { id: "memory-a", ownerKind: "account", ownerId: "account-a" },
      mutate() {
        return memory.remember(item());
      },
      async flushLocal() {
        throw new Error("local persistence unavailable");
      },
      async reconcile() {
        throw new Error("must not run");
      },
    }),
    /local persistence unavailable/,
  );

  assert.equal(recovery.pendingIdentities().length, 1);
  assert.match(store.read(), /memory-a/);
  assert.doesNotMatch(store.read(), /private portable content/);
});

test("reboot recovery stages the canonical local item and clears only after coordination durability", async () => {
  const memory = createMemoryRuntime();
  memory.remember(item({ content: "state that survived reboot" }));
  const store = durableStore();
  const first = journal(memory, store);
  await first.armDurably({ id: "memory-a", ownerKind: "account", ownerId: "account-a" });

  const recovered = journal(memory, store);
  const sync = syncRuntime();
  let coordinationFlushes = 0;
  const result = await recovered.recover(sync.runtime, {
    async flushCoordination() {
      coordinationFlushes += 1;
      return true;
    },
  });

  assert.equal(result.attempted, 1);
  assert.equal(result.transferred, 1);
  assert.equal(result.retained, 0);
  assert.equal(coordinationFlushes, 1);
  assert.equal(sync.staged.length, 1);
  assert.equal(sync.staged[0].operation, "upsert");
  assert.equal(sync.staged[0].value.content, "state that survived reboot");
  assert.equal(recovered.pendingIdentities().length, 0);
});

test("reboot recovery reconciles absent or restricted local state as a tombstone", async () => {
  for (const current of [null, item({ sensitivity: "restricted", content: "local only" })]) {
    const memory = createMemoryRuntime();
    if (current) memory.remember(current);
    const store = durableStore();
    const first = journal(memory, store);
    await first.armDurably({ id: "memory-a", ownerKind: "account", ownerId: "account-a" });

    const recovered = journal(memory, store);
    const sync = syncRuntime();
    await recovered.recover(sync.runtime, { flushCoordination: async () => true });

    assert.equal(sync.staged.length, 1);
    assert.equal(sync.staged[0].operation, "delete");
    assert.deepEqual(sync.staged[0].value, {
      id: "memory-a",
      ownerKind: "account",
      ownerId: "account-a",
    });
    assert.equal(recovered.pendingIdentities().length, 0);
  }
});

test("authorization block or unconfirmed coordination keeps journal ownership", async () => {
  const memory = createMemoryRuntime();
  memory.remember(item());
  const store = durableStore();
  const first = journal(memory, store);
  await first.armDurably({ id: "memory-a", ownerKind: "account", ownerId: "account-a" });

  const blocked = journal(memory, store);
  const blockedSync = syncRuntime({ authorizationAllowed: false });
  const blockedResult = await blocked.recover(blockedSync.runtime, {
    async flushCoordination() {
      throw new Error("must not flush blocked coordination");
    },
  });
  assert.equal(blockedResult.transferred, 0);
  assert.equal(blockedResult.retained, 1);

  const allowed = journal(memory, store);
  const allowedSync = syncRuntime();
  await assert.rejects(
    allowed.recover(allowedSync.runtime, { flushCoordination: async () => false }),
    /coordination durability was not confirmed/,
  );
  assert.equal(allowed.pendingIdentities().length, 1);
});

test("journal snapshot explicitly records identity-only non-promoted boundary", async () => {
  const memory = createMemoryRuntime();
  const store = durableStore();
  const recovery = journal(memory, store);
  await recovery.armDurably({ id: "memory-a", ownerKind: "account", ownerId: "account-a" });

  const snapshot = recovery.getSnapshot();
  assert.equal(snapshot.subjectId, "account-a");
  assert.equal(snapshot.pendingIdentityCount, 1);
  assert.equal(snapshot.journalPersistence, "device");
  assert.equal(snapshot.storesPortableContent, false);
  assert.equal(snapshot.durabilityConfirmationAvailable, true);
  assert.equal(snapshot.productionPromoted, false);
});


test("protected mutation never starts from a session-only crash journal", async () => {
  const memory = createMemoryRuntime();
  const recovery = journal(memory, sessionJournalStore());
  let mutated = false;

  await assert.rejects(
    recovery.runProtectedMutation({
      identity: { id: "memory-a", ownerKind: "account", ownerId: "account-a" },
      mutate() {
        mutated = true;
        return memory.remember(item());
      },
      async flushLocal() {
        return true;
      },
      async reconcile() {
        return true;
      },
    }),
    /not device-durable/,
  );

  assert.equal(mutated, false);
  assert.equal(
    memory.search({
      ownerKind: "account",
      ownerId: "account-a",
      scopes: ["account"],
      includeRestricted: true,
      limit: 8,
      offset: 0,
    }).length,
    0,
  );
});

test("protected mutation requires an explicit journal flush boundary", async () => {
  const memory = createMemoryRuntime();
  const recovery = journal(memory, sessionJournalStore({ withFlush: false }));
  let mutated = false;

  await assert.rejects(
    recovery.runProtectedMutation({
      identity: { id: "memory-a", ownerKind: "account", ownerId: "account-a" },
      mutate() {
        mutated = true;
        return memory.remember(item());
      },
      async flushLocal() {
        return true;
      },
      async reconcile() {
        return true;
      },
    }),
    /requires explicit durability confirmation/,
  );

  assert.equal(mutated, false);
});
