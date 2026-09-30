import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SYNC_STATE_STORE_SCHEMA } from "../system/contracts/sync-state-store.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
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

function store({ scope = "device", withFlush = true } = {}) {
  let payload = null;
  const value = {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope,
    load: () => payload,
    save(next) {
      payload = next;
      return true;
    },
  };
  if (withFlush) {
    value.flush = async () => true;
  }
  return value;
}

function recovery(journalStore) {
  return createAccountMemoryCrashRecoveryJournal({
    identitySession: identitySession(),
    memoryPort: createMemoryRuntime(),
    createJournalStateStore: () => journalStore,
  });
}

const identity = Object.freeze({ id: "memory-a", ownerKind: "account", ownerId: "account-a" });

test("protected mutation cannot begin when journal store has no durability confirmation", async () => {
  const journal = recovery(store({ withFlush: false }));
  let mutated = false;

  await assert.rejects(
    journal.runProtectedMutation({
      identity,
      mutate() {
        mutated = true;
        return true;
      },
      flushLocal: async () => true,
      reconcile: async () => true,
    }),
    /requires explicit durability confirmation/,
  );

  assert.equal(mutated, false);
  assert.equal(journal.pendingIdentities().length, 0);
});

test("protected mutation cannot begin when confirmed journal remains session-scoped", async () => {
  const journal = recovery(store({ scope: "session" }));
  let mutated = false;

  await assert.rejects(
    journal.runProtectedMutation({
      identity,
      mutate() {
        mutated = true;
        return true;
      },
      flushLocal: async () => true,
      reconcile: async () => true,
    }),
    /is not device-durable/,
  );

  assert.equal(mutated, false);
  assert.equal(journal.pendingIdentities().length, 0);
});
