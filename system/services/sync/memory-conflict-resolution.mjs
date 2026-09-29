import { validateMemorySyncMutation } from "./account-memory-runtime.mjs";

export const MEMORY_CONFLICT_RESOLUTION_SCHEMA = "ordax.memory-conflict-resolution/1";
export const MEMORY_CONFLICT_DECISIONS = Object.freeze([
  "preserve-local-intent",
  "accept-authoritative-remote",
]);

const DECISIONS = new Set(MEMORY_CONFLICT_DECISIONS);
const CONFLICT_REASONS = new Set([
  "same-revision-divergence",
  "concurrent-remote-update",
  "server-conflict",
  "local-change-during-flight",
]);

function requireConflict(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Memory conflict resolution requires a conflict object");
  }
  if (typeof value.objectId !== "string" || value.objectId.includes("\0")) {
    throw new TypeError("Memory conflict object id is invalid");
  }
  const objectId = value.objectId.trim();
  if (!objectId || objectId !== value.objectId || objectId.length > 160) {
    throw new TypeError("Memory conflict object id is invalid");
  }
  if (!CONFLICT_REASONS.has(value.reason)) {
    throw new TypeError("Memory conflict reason is incompatible");
  }
  if (!Number.isSafeInteger(value.serverRevision) || value.serverRevision < 1) {
    throw new TypeError("Memory conflict server revision must be a positive safe integer");
  }
  return Object.freeze({
    objectId,
    reason: value.reason,
    serverRevision: value.serverRevision,
  });
}

function requireDecision(value) {
  if (!DECISIONS.has(value)) {
    throw new TypeError("Memory conflict decision is incompatible");
  }
  return value;
}

function requireIdempotencyFactory(value) {
  if (typeof value !== "function") {
    throw new TypeError("Memory conflict resolution requires createIdempotencyKey()");
  }
  return value;
}

export function resolveMemorySyncConflict({
  conflict,
  pendingMutation,
  decision,
  subjectId,
  createIdempotencyKey,
} = {}) {
  const normalizedConflict = requireConflict(conflict);
  const selectedDecision = requireDecision(decision);
  const pending = validateMemorySyncMutation(pendingMutation, { subjectId });

  if (pending.objectId !== normalizedConflict.objectId) {
    throw new Error("Memory conflict and pending mutation identities do not match");
  }
  if (pending.baseServerRevision > normalizedConflict.serverRevision) {
    throw new Error("Memory conflict revision is older than the pending mutation base");
  }

  if (selectedDecision === "accept-authoritative-remote") {
    return Object.freeze({
      schema: MEMORY_CONFLICT_RESOLUTION_SCHEMA,
      decision: selectedDecision,
      objectId: normalizedConflict.objectId,
      authoritativeServerRevision: normalizedConflict.serverRevision,
      replacementMutation: null,
      discardPendingIntent: true,
      requiresRemoteReconciliation: true,
      appliesRemoteState: false,
      automatic: false,
    });
  }

  const nextKey = requireIdempotencyFactory(createIdempotencyKey);
  const replacementMutation = validateMemorySyncMutation({
    ...pending,
    baseServerRevision: normalizedConflict.serverRevision,
    idempotencyKey: nextKey("memory-conflict-preserve-local"),
  }, { subjectId });

  return Object.freeze({
    schema: MEMORY_CONFLICT_RESOLUTION_SCHEMA,
    decision: selectedDecision,
    objectId: normalizedConflict.objectId,
    authoritativeServerRevision: normalizedConflict.serverRevision,
    replacementMutation,
    discardPendingIntent: false,
    requiresRemoteReconciliation: false,
    appliesRemoteState: false,
    automatic: false,
  });
}
