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
