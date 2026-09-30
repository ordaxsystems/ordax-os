import assert from "node:assert/strict";
import test from "node:test";

import {
  MEMORY_CONFLICT_REVIEW_SCHEMA,
  createMemoryConflictReviewRuntime,
} from "../system/services/sync/memory-conflict-review.mjs";

function syncPort() {
  let conflicts = [
    { objectId: "memory-a", reason: "server-conflict", serverRevision: 7 },
    { objectId: "memory-b", reason: "reconciliation-required", serverRevision: 9 },
  ];
  const pending = [
    { objectId: "memory-a", operation: "upsert", payload: { memory: { content: "secret" } } },
  ];
  const calls = [];
  return {
    calls,
    pendingConflicts: () => Object.freeze(conflicts),
    pendingMutations: () => Object.freeze(pending),
    async resolveConflict(objectId, decision) {
      calls.push({ objectId, decision });
      conflicts = conflicts.filter((entry) => entry.objectId !== objectId);
      return Object.freeze({ status: "pending", objectId });
    },
  };
}

test("conflict review projects only bounded coordination metadata", () => {
  const sync = syncPort();
  const review = createMemoryConflictReviewRuntime(sync);
  const snapshot = review.getSnapshot();

  assert.equal(snapshot.schema, MEMORY_CONFLICT_REVIEW_SCHEMA);
  assert.equal(snapshot.conflictCount, 2);
  assert.equal(snapshot.manualResolutionCount, 1);
  assert.equal(snapshot.reconciliationRequiredCount, 1);
  assert.equal(snapshot.automaticResolution, false);
  assert.deepEqual(snapshot.conflicts[0], {
    objectId: "memory-a",
    reason: "server-conflict",
    serverRevision: 7,
    state: "manual-resolution-required",
    localIntentOperation: "upsert",
    allowedDecisions: ["preserve-local-intent", "accept-authoritative-remote"],
  });
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
  assert.deepEqual(snapshot.conflicts[1].allowedDecisions, []);
});

test("conflict review forwards only explicit supported decisions", async () => {
  const sync = syncPort();
  const review = createMemoryConflictReviewRuntime(sync);

  await review.resolve("memory-a", "preserve-local-intent");
  assert.deepEqual(sync.calls, [
    { objectId: "memory-a", decision: "preserve-local-intent" },
  ]);
  assert.equal(review.getSnapshot().conflictCount, 1);

  await assert.rejects(
    review.resolve("memory-b", "accept-authoritative-remote"),
    /awaiting authoritative remote reconciliation/,
  );
  await assert.rejects(review.resolve("memory-b", "automatic"), /decision is incompatible/);
});
