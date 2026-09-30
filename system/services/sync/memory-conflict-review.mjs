import {
  MEMORY_CONFLICT_DECISIONS,
} from "./memory-conflict-resolution.mjs";

export const MEMORY_CONFLICT_REVIEW_SCHEMA = "ordax.memory-conflict-review/1";

const DECISIONS = new Set(MEMORY_CONFLICT_DECISIONS);

function requireMemorySync(value) {
  if (
    !value
    || typeof value !== "object"
    || typeof value.pendingConflicts !== "function"
    || typeof value.pendingMutations !== "function"
    || typeof value.resolveConflict !== "function"
  ) {
    throw new TypeError("Memory conflict review requires a compatible account Memory sync runtime");
  }
  return value;
}

function boundedObjectId(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Memory conflict review object id is invalid");
  }
  const normalized = value.trim();
  if (!normalized || normalized !== value || normalized.length > 160) {
    throw new TypeError("Memory conflict review object id is invalid");
  }
  return normalized;
}

function projectConflict(conflict, pending) {
  const manual = conflict.reason !== "reconciliation-required";
  return Object.freeze({
    objectId: conflict.objectId,
    reason: conflict.reason,
    serverRevision: conflict.serverRevision,
    state: manual ? "manual-resolution-required" : "awaiting-authoritative-remote",
    localIntentOperation: pending?.operation ?? null,
    allowedDecisions: Object.freeze(
      manual ? [...MEMORY_CONFLICT_DECISIONS] : [],
    ),
  });
}

export function createMemoryConflictReviewRuntime(memorySync) {
  const sync = requireMemorySync(memorySync);

  const snapshot = () => {
    const pendingById = new Map(
      sync.pendingMutations().map((entry) => [entry.objectId, entry]),
    );
    const conflicts = sync.pendingConflicts().map((conflict) => (
      projectConflict(conflict, pendingById.get(conflict.objectId) ?? null)
    ));
    return Object.freeze({
      schema: MEMORY_CONFLICT_REVIEW_SCHEMA,
      conflicts: Object.freeze(conflicts),
      conflictCount: conflicts.length,
      manualResolutionCount: conflicts.filter(
        (entry) => entry.state === "manual-resolution-required",
      ).length,
      reconciliationRequiredCount: conflicts.filter(
        (entry) => entry.state === "awaiting-authoritative-remote",
      ).length,
      automaticResolution: false,
    });
  };

  return Object.freeze({
    schema: MEMORY_CONFLICT_REVIEW_SCHEMA,
    getSnapshot: snapshot,
    async resolve(objectIdValue, decision) {
      const objectId = boundedObjectId(objectIdValue);
      if (!DECISIONS.has(decision)) {
        throw new TypeError("Memory conflict review decision is incompatible");
      }
      const current = snapshot().conflicts.find((entry) => entry.objectId === objectId) ?? null;
      if (current === null) throw new Error("Memory conflict is no longer pending");
      if (!current.allowedDecisions.includes(decision)) {
        throw new Error("Memory conflict is awaiting authoritative remote reconciliation");
      }
      const result = await sync.resolveConflict(objectId, decision);
      return Object.freeze({
        result,
        snapshot: snapshot(),
      });
    },
  });
}
