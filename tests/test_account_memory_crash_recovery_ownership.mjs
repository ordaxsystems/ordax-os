import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { MEMORY_SYNC_RUNTIME_SCHEMA } from "../system/services/sync/account-memory-runtime.mjs";
import { createAccountMemoryCrashRecoveryJournal } from "../system/services/sync/account-memory-crash-recovery-journal.mjs";

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

function switchableIdentitySession(initialSubjectId = "account-a") {
  let snapshot = { state: "signed-in", subjectId: initialSubjectId, displayName: initialSubjectId };
  const listeners = new Set();
  return {
    port: {
      schema: IDENTITY_SESSION_SCHEMA,
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        listener(snapshot);
        return () => listeners.delete(listener);
      },
    },
    setSubject(subjectId) {
      snapshot = { state: "signed-in", subjectId, displayName: subjectId };
      for (const listener of listeners) listener(snapshot);
    },
  };
}

function durableStore() {
  let payload = null;
  return {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: "device",
    load: () => payload,
    save(value) {
      payload = value;
      return true;
    },
    async flush() {
      return true;
    },
  };
}

function memoryItem(overrides = {}) {
  return {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "portable before privacy transition",
    provenance: "user-confirmed:crash-ownership-test",
    sourceTimestamp: "2026-09-30T03:00:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function syncRuntime({ pending = [], conflicts = [] } = {}) {
  const staged = [];
  return {
    staged,
    runtime: {
      schema: MEMORY_SYNC_RUNTIME_SCHEMA,
      stageUpsert(value) {
        staged.push({ operation: "upsert", value });
        return { status: "pending", objectId: value.id };
      },
      stageForget(value) {
        staged.push({ operation: "delete", value });
        return { status: "pending", objectId: value.id };
      },
      pendingMutations() {
        return pending;
      },
      pendingConflicts() {
        return conflicts;
      },
    },
  };
}

function journal(memory, store) {
  return createAccountMemoryCrashRecoveryJournal({
    identitySession: identitySession(),
    memoryPort: memory,
    createJournalStateStore: () => store,
  });
}

test("matching pending upsert owns crash recovery without regenerating mutation", async () => {
  const memory = createMemoryRuntime();
  const current = memory.remember(memoryItem());
  const store = durableStore();
  const recovery = journal(memory, store);
  await recovery.armDurably({ id: current.id, ownerKind: "account", ownerId: "account-a" });
  const sync = syncRuntime({
    pending: [{
      objectId: current.id,
      operation: "upsert",
      payload: { memory: current },
    }],
  });
  let flushes = 0;

  const result = await recovery.recover(sync.runtime, {
    async flushCoordination() {
      flushes += 1;
      return true;
    },
  });

  assert.equal(result.transferred, 1);
  assert.equal(result.retained, 0);
  assert.equal(flushes, 1);
  assert.equal(sync.staged.length, 0);
});

test("stale pending upsert cannot own recovery after current Memory becomes restricted", async () => {
  const memory = createMemoryRuntime();
  const portable = memory.remember(memoryItem());
  memory.remember(memoryItem({
    sensitivity: "restricted",
    content: "must stay local after reboot",
    sourceTimestamp: "2026-09-30T03:01:00Z",
  }));
  const store = durableStore();
  const recovery = journal(memory, store);
  await recovery.armDurably({ id: portable.id, ownerKind: "account", ownerId: "account-a" });
  const sync = syncRuntime({
    pending: [{
      objectId: portable.id,
      operation: "upsert",
      payload: { memory: portable },
    }],
  });

  const result = await recovery.recover(sync.runtime, {
    flushCoordination: async () => true,
  });

  assert.equal(result.transferred, 1);
  assert.equal(result.retained, 0);
  assert.equal(sync.staged.length, 1);
  assert.equal(sync.staged[0].operation, "delete");
  assert.deepEqual(sync.staged[0].value, {
    id: "memory-a",
    ownerKind: "account",
    ownerId: "account-a",
  });
});

test("same-identity protected mutations serialize journal ownership", async () => {
  const memory = createMemoryRuntime();
  const recovery = journal(memory, durableStore());
  const identity = { id: "memory-a", ownerKind: "account", ownerId: "account-a" };
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = recovery.runProtectedMutation({
    identity,
    mutate() {
      events.push("first-mutate");
      return memory.remember(memoryItem({ content: "first" }));
    },
    async flushLocal() {
      events.push("first-flush");
      return true;
    },
    async reconcile() {
      events.push("first-reconcile-start");
      await firstGate;
      events.push("first-reconcile-end");
      return true;
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  const second = recovery.runProtectedMutation({
    identity,
    mutate() {
      events.push("second-mutate");
      return memory.remember(memoryItem({ content: "second", sourceTimestamp: "2026-09-30T03:02:00Z" }));
    },
    async flushLocal() {
      events.push("second-flush");
      return true;
    },
    async reconcile() {
      events.push("second-reconcile");
      return true;
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.includes("second-mutate"), false);
  assert.equal(recovery.getSnapshot().activeProtectedMutationCount, 1);

  releaseFirst();
  await Promise.all([first, second]);

  assert.ok(events.indexOf("first-reconcile-end") < events.indexOf("second-mutate"));
  assert.equal(recovery.pendingIdentities().length, 0);
  assert.equal(recovery.getSnapshot().activeProtectedMutationCount, 0);
});

test("recovery waits for protected mutation ownership to settle", async () => {
  const memory = createMemoryRuntime();
  const recovery = journal(memory, durableStore());
  const identity = { id: "memory-a", ownerKind: "account", ownerId: "account-a" };
  const sync = syncRuntime();
  let releaseMutation;
  const mutationGate = new Promise((resolve) => {
    releaseMutation = resolve;
  });

  const mutation = recovery.runProtectedMutation({
    identity,
    mutate() {
      return memory.remember(memoryItem());
    },
    async flushLocal() {
      return true;
    },
    async reconcile() {
      await mutationGate;
      return true;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const recovering = recovery.recover(sync.runtime, {
    flushCoordination: async () => true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sync.staged.length, 0);

  releaseMutation();
  await mutation;
  const result = await recovering;

  assert.equal(result.attempted, 0);
  assert.equal(result.retained, 0);
  assert.equal(sync.staged.length, 0);
});

test("protected mutation clears only the subject journal that it armed", async () => {
  const memory = createMemoryRuntime();
  const session = switchableIdentitySession("account-b");
  const stores = new Map([
    ["account-a", durableStore()],
    ["account-b", durableStore()],
  ]);
  const recovery = createAccountMemoryCrashRecoveryJournal({
    identitySession: session.port,
    memoryPort: memory,
    createJournalStateStore: (subjectId) => stores.get(subjectId),
  });
  const sharedId = "same-id-across-accounts";

  await recovery.armDurably({ id: sharedId, ownerKind: "account", ownerId: "account-b" });
  assert.equal(recovery.pendingIdentities().length, 1);

  session.setSubject("account-a");
  let releaseReconcile;
  const reconcileGate = new Promise((resolve) => {
    releaseReconcile = resolve;
  });
  const mutation = recovery.runProtectedMutation({
    identity: { id: sharedId, ownerKind: "account", ownerId: "account-a" },
    mutate() {
      return memory.remember(memoryItem({
        id: sharedId,
        ownerId: "account-a",
        content: "account A value",
      }));
    },
    async flushLocal() {
      return true;
    },
    async reconcile() {
      await reconcileGate;
      return true;
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  session.setSubject("account-b");
  assert.equal(recovery.pendingIdentities().length, 1);
  releaseReconcile();
  await mutation;

  assert.equal(recovery.pendingIdentities().length, 1);
  assert.equal(recovery.pendingIdentities()[0].ownerId, "account-b");
  assert.equal(recovery.pendingIdentities()[0].id, sharedId);

  session.setSubject("account-a");
  assert.equal(recovery.pendingIdentities().length, 0);
});
