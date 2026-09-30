import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { MEMORY_PORT_SCHEMA } from "../system/contracts/memory.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { MEMORY_SYNC_RUNTIME_SCHEMA } from "../system/services/sync/account-memory-runtime.mjs";
import { createAccountMemoryCrashRecoveryJournal } from "../system/services/sync/account-memory-crash-recovery-journal.mjs";
import { createAccountMemoryProtectedMutationPort } from "../system/services/sync/account-memory-protected-mutation-port.mjs";

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

function memoryPort(events = [], { flushResult = true } = {}) {
  const runtime = createMemoryRuntime();
  return {
    runtime,
    port: Object.freeze({
      schema: MEMORY_PORT_SCHEMA,
      search: (value) => runtime.search(value),
      remember(value) {
        events.push("memory-remember");
        return runtime.remember(value);
      },
      forget(value) {
        events.push("memory-forget");
        return runtime.forget(value);
      },
      async flush() {
        events.push("memory-flush");
        await runtime.flush();
        return flushResult;
      },
    }),
  };
}

function syncRuntime(events = [], { authorizationAllowed = true } = {}) {
  const staged = [];
  return {
    staged,
    runtime: Object.freeze({
      schema: MEMORY_SYNC_RUNTIME_SCHEMA,
      getSnapshot: () => Object.freeze({ subjectId: "account-a" }),
      stageUpsert(value) {
        events.push("stage-upsert");
        if (!authorizationAllowed) return Object.freeze({ status: "blocked", reason: "authorization-required" });
        staged.push({ operation: "upsert", value });
        return Object.freeze({ status: "pending", objectId: value.id });
      },
      stageForget(value) {
        events.push("stage-delete");
        if (!authorizationAllowed) return Object.freeze({ status: "blocked", reason: "authorization-required" });
        staged.push({ operation: "delete", value });
        return Object.freeze({ status: "pending", objectId: value.id });
      },
      pendingMutations: () => Object.freeze([]),
      pendingConflicts: () => Object.freeze([]),
    }),
  };
}

function item(overrides = {}) {
  return {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "portable account memory",
    provenance: "user-confirmed:protected-mutation-test",
    sourceTimestamp: "2026-09-30T03:00:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function setup({ flushResult = true, authorizationAllowed = true, coordinationResult = true } = {}) {
  const events = [];
  const memory = memoryPort(events, { flushResult });
  const store = durableStore(events);
  const journal = createAccountMemoryCrashRecoveryJournal({
    identitySession: identitySession(),
    memoryPort: memory.port,
    createJournalStateStore: () => store,
  });
  const sync = syncRuntime(events, { authorizationAllowed });
  const port = createAccountMemoryProtectedMutationPort({
    memoryPort: memory.port,
    memorySync: sync.runtime,
    crashRecoveryJournal: journal,
    async flushCoordination() {
      events.push("coordination-flush");
      return coordinationResult;
    },
  });
  return { events, memory, store, journal, sync, port };
}

test("protected remember arms journal before mutation and clears only after durable coordination", async () => {
  const { events, journal, sync, port } = setup();
  const remembered = await port.remember(item());

  assert.equal(remembered.id, "memory-a");
  assert.deepEqual(events.slice(0, 3), ["journal-save", "journal-flush", "memory-remember"]);
  assert.ok(events.indexOf("memory-flush") < events.indexOf("stage-upsert"));
  assert.ok(events.indexOf("stage-upsert") < events.indexOf("coordination-flush"));
  assert.ok(events.indexOf("coordination-flush") < events.lastIndexOf("journal-save"));
  assert.equal(journal.pendingIdentities().length, 0);
  assert.equal(sync.staged[0].operation, "upsert");
});

test("local durability false fails closed before account sync staging", async () => {
  const { journal, sync, port } = setup({ flushResult: false });
  await assert.rejects(port.remember(item()), /Local Memory durability was not confirmed/);
  assert.equal(sync.staged.length, 0);
  assert.equal(journal.pendingIdentities().length, 1);
});

test("authorization unavailable preserves recovery ownership after local persistence", async () => {
  const { journal, memory, port } = setup({ authorizationAllowed: false });
  await assert.rejects(port.remember(item()), /requires account sync authorization/);
  assert.equal(memory.runtime.search({ ownerKind: "account", ownerId: "account-a", limit: 8, offset: 0 }).length, 1);
  assert.equal(journal.pendingIdentities().length, 1);
});

test("coordination durability false keeps the journal armed", async () => {
  const { journal, sync, port } = setup({ coordinationResult: false });
  await assert.rejects(port.remember(item()), /Account Memory coordination durability was not confirmed/);
  assert.equal(sync.staged.length, 1);
  assert.equal(journal.pendingIdentities().length, 1);
});

test("restricted current state reconciles as delete rather than portable upsert", async () => {
  const { sync, port } = setup();
  await port.remember(item({ sensitivity: "restricted", content: "local only" }));
  assert.equal(sync.staged.length, 1);
  assert.equal(sync.staged[0].operation, "delete");
  assert.deepEqual(sync.staged[0].value, { id: "memory-a", ownerKind: "account", ownerId: "account-a" });
});

test("forget of a missing local item does not arm a journal or manufacture a tombstone", async () => {
  const { events, journal, sync, port } = setup();
  const result = await port.forget({ id: "missing", ownerKind: "account", ownerId: "account-a" });
  assert.equal(result, false);
  assert.equal(sync.staged.length, 0);
  assert.equal(journal.pendingIdentities().length, 0);
  assert.deepEqual(events, []);
});

test("forget persists local deletion before staging the tombstone", async () => {
  const { events, memory, sync, port } = setup();
  memory.runtime.remember(item());
  const result = await port.forget({ id: "memory-a", ownerKind: "account", ownerId: "account-a" });
  assert.equal(result, true);
  assert.ok(events.indexOf("memory-forget") < events.indexOf("memory-flush"));
  assert.ok(events.indexOf("memory-flush") < events.indexOf("stage-delete"));
  assert.equal(sync.staged[0].operation, "delete");
});
