import assert from "node:assert/strict";
import test from "node:test";

import {
  MEMORY_SYNC_MUTATION_SCHEMA,
  MEMORY_SYNC_OBJECT_SCHEMA_VERSION,
  MEMORY_SYNC_PAYLOAD_SCHEMA,
  MEMORY_SYNC_RESOLVER_VERSION,
} from "../system/services/sync/account-memory-runtime.mjs";
import {
  MEMORY_CONFLICT_RESOLUTION_SCHEMA,
  resolveMemorySyncConflict,
} from "../system/services/sync/memory-conflict-resolution.mjs";

const SUBJECT = "account-subject-a";
const OBJECT_ID = "memory/bWVtb3J5LTE";

function pendingMutation(overrides = {}) {
  return {
    $schema: MEMORY_SYNC_MUTATION_SCHEMA,
    operation: "upsert",
    objectId: OBJECT_ID,
    dataClass: "memory",
    objectSchemaVersion: MEMORY_SYNC_OBJECT_SCHEMA_VERSION,
    resolverVersion: MEMORY_SYNC_RESOLVER_VERSION,
    baseServerRevision: 3,
    idempotencyKey: "memory:pending:1",
    payload: {
      schema: MEMORY_SYNC_PAYLOAD_SCHEMA,
      memory: {
        id: "memory-1",
        ownerKind: "account",
        ownerId: SUBJECT,
        scope: "account",
        kind: "fact",
        sensitivity: "private",
        content: "preferência local explícita",
        provenance: "user-confirmed:test",
        sourceTimestamp: "2026-09-29T16:00:00Z",
        spaceId: null,
        projectId: null,
      },
    },
    ...overrides,
  };
}

function conflict(overrides = {}) {
  return {
    objectId: OBJECT_ID,
    reason: "server-conflict",
    serverRevision: 7,
    ...overrides,
  };
}

test("preserve-local-intent is an explicit manual rebase onto the authoritative server revision", () => {
  let calls = 0;
  const resolution = resolveMemorySyncConflict({
    conflict: conflict(),
    pendingMutation: pendingMutation(),
    decision: "preserve-local-intent",
    subjectId: SUBJECT,
    createIdempotencyKey(kind) {
      calls += 1;
      assert.equal(kind, "memory-conflict-preserve-local");
      return "memory:resolved:1";
    },
  });

  assert.equal(resolution.schema, MEMORY_CONFLICT_RESOLUTION_SCHEMA);
  assert.equal(resolution.automatic, false);
  assert.equal(resolution.appliesRemoteState, false);
  assert.equal(resolution.requiresRemoteReconciliation, false);
  assert.equal(resolution.discardPendingIntent, false);
  assert.equal(resolution.replacementMutation.baseServerRevision, 7);
  assert.equal(resolution.replacementMutation.idempotencyKey, "memory:resolved:1");
  assert.equal(resolution.replacementMutation.payload.memory.content, "preferência local explícita");
  assert.equal(calls, 1);
});

test("accept-authoritative-remote never applies provider state and explicitly requires reconciliation", () => {
  const resolution = resolveMemorySyncConflict({
    conflict: conflict(),
    pendingMutation: pendingMutation(),
    decision: "accept-authoritative-remote",
    subjectId: SUBJECT,
  });

  assert.equal(resolution.automatic, false);
  assert.equal(resolution.appliesRemoteState, false);
  assert.equal(resolution.replacementMutation, null);
  assert.equal(resolution.discardPendingIntent, true);
  assert.equal(resolution.requiresRemoteReconciliation, true);
  assert.equal(resolution.authoritativeServerRevision, 7);
});

test("conflict resolution rejects implicit choices, identity mismatch and stale conflict revision", () => {
  assert.throws(() => resolveMemorySyncConflict({
    conflict: conflict(),
    pendingMutation: pendingMutation(),
    decision: "last-write-wins",
    subjectId: SUBJECT,
  }), /decision is incompatible/);

  assert.throws(() => resolveMemorySyncConflict({
    conflict: conflict({ objectId: "memory/b3RoZXI" }),
    pendingMutation: pendingMutation(),
    decision: "accept-authoritative-remote",
    subjectId: SUBJECT,
  }), /identities do not match/);

  assert.throws(() => resolveMemorySyncConflict({
    conflict: conflict({ serverRevision: 2 }),
    pendingMutation: pendingMutation(),
    decision: "accept-authoritative-remote",
    subjectId: SUBJECT,
  }), /older than the pending mutation base/);
});

test("preserve-local-intent reuses canonical Memory mutation validation and rejects cross-account payload", () => {
  assert.throws(() => resolveMemorySyncConflict({
    conflict: conflict(),
    pendingMutation: pendingMutation({
      payload: {
        schema: MEMORY_SYNC_PAYLOAD_SCHEMA,
        memory: {
          ...pendingMutation().payload.memory,
          ownerId: "different-account",
        },
      },
    }),
    decision: "preserve-local-intent",
    subjectId: SUBJECT,
    createIdempotencyKey: () => "memory:resolved:2",
  }), /not eligible|active account/);
});
