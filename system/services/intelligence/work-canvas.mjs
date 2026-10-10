import { validatePersonalOrdaxRuntimeSnapshot } from "../../contracts/personal-ordax-store.mjs";
import {
  PERSONAL_ORDAX_ACTIVITY_SCHEMA,
  PERSONAL_ORDAX_ACTION_ATTEMPT_SCHEMA,
  PERSONAL_ORDAX_APPROVAL_SCHEMA,
  PERSONAL_ORDAX_WORK_RESULT_SCHEMA,
} from "../../contracts/personal-ordax.mjs";

// Read-only projection. The Personal OrdaX runtime is the owner of work, events,
// grants and results; this module never creates work or interprets model output
// as a receipt. Caller must obtain the snapshot from an authorized runtime.
export const INTELLIGENCE_WORK_CANVAS_SCHEMA = "ordax.intelligence-work-canvas/1";
const MAX_VISIBLE_STEPS = 32;
const MAX_VISIBLE_ACTIONS = 8;
const STATES = Object.freeze({
  queued: "working",
  running: "working",
  paused: "working",
  "waiting-approval": "requires-action",
  completed: "result",
  failed: "failed",
  cancelled: "failed",
});

function context(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Canvas requires explicit work context");
  }
  for (const key of ["ownerKind", "ownerId", "spaceId", "projectId", "workItemId"]) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`Canvas context is missing ${key}`);
    }
  }
  if (value.ownerKind !== "device" && value.ownerKind !== "account") {
    throw new TypeError("Canvas owner kind is invalid");
  }
  const expected = {
    ownerId: value.ownerKind === "device" ? null : value.ownerId,
    spaceId: value.spaceId,
    projectId: value.projectId,
    workItemId: value.workItemId,
  };
  if ((value.ownerKind === "device" && value.ownerId !== null)
    || (value.ownerKind === "account" && typeof value.ownerId !== "string")) {
    throw new TypeError("Canvas owner identity is invalid");
  }
  for (const [key, max] of [["ownerId", 160], ["spaceId", 160], ["projectId", 240], ["workItemId", 160]]) {
    const entry = expected[key];
    if (entry === null) continue;
    if (typeof entry !== "string" || !entry.trim() || entry.length > max || entry.includes("\0")) {
      throw new TypeError(`Canvas ${key} is outside bounds`);
    }
  }
  return Object.freeze({ ownerKind: value.ownerKind, ...expected });
}

function empty(scope, state = "unavailable") {
  return Object.freeze({
    schema: INTELLIGENCE_WORK_CANVAS_SCHEMA,
    state,
    workState: null,
    workItemId: scope.workItemId,
    ownerKind: scope.ownerKind,
    ownerId: scope.ownerId,
    spaceId: scope.spaceId,
    projectId: scope.projectId,
    resultId: null,
    requestId: null,
    provenance: null,
    blocks: Object.freeze([]),
    steps: Object.freeze([]),
    stepsTruncated: false,
    actionEvidence: Object.freeze([]),
    actionsTruncated: false,
    pendingApproval: null,
    completionPercent: null,
    authority: "none",
    toolExecution: false,
  });
}

export function projectPersonalWorkCanvas(snapshotValue, contextValue) {
  const scope = context(contextValue);
  if (scope.workItemId === null) return empty(scope, "idle");
  if (snapshotValue === null) return empty(scope);
  // The existing store validator enforces owner partitions, unique IDs,
  // monotonic event sequences, result-work links and bounded payloads.
  const snapshot = validatePersonalOrdaxRuntimeSnapshot(snapshotValue);
  if (snapshot.ownerKind !== scope.ownerKind || snapshot.ownerId !== scope.ownerId) {
    return empty(scope);
  }
  const work = snapshot.workItems.find((item) => item.id === scope.workItemId);
  if (!work
    || work.ownerKind !== scope.ownerKind || work.ownerId !== scope.ownerId
    || work.spaceId !== scope.spaceId || work.projectId !== scope.projectId) {
    return empty(scope);
  }
  const events = snapshot.activities.filter((event) => event.workItemId === work.id);
  const result = snapshot.results.find((entry) => entry.workItemId === work.id) ?? null;
  const uncertain = snapshot.attempts.some((entry) =>
    entry.workItemId === work.id && entry.status === "uncertain");
  let state = STATES[work.state] ?? "unavailable";
  if (work.state === "completed" && result === null) state = "unavailable";
  const revoked = snapshot.approvals.some((entry) =>
    entry.workItemId === work.id && entry.status === "revoked");
  if (uncertain || revoked) state = "requires-action";
  const visible = events.slice(-MAX_VISIBLE_STEPS);
  const steps = Object.freeze(visible.map((event) => Object.freeze({
    schema: PERSONAL_ORDAX_ACTIVITY_SCHEMA,
    sequence: event.sequence,
    type: event.type,
    summary: event.summary,
    occurredAt: event.occurredAt,
    approvalId: event.approvalId,
    actionId: event.actionId,
    // Artifact refs are intentionally withheld pending resource-grant resolution.
  })));
  // This is a typed table projection of the Personal Action Attempt owner.
  // Its store validator already correlates attempts to exact approved actions,
  // grants and one matching start/finish Activity. Withhold grant, resource,
  // tool SHA and artifact references: rendering them needs a separate grant.
  const attempts = snapshot.attempts.filter((attempt) => attempt.workItemId === work.id);
  const actionEvidence = Object.freeze(attempts.slice(-MAX_VISIBLE_ACTIONS).reverse()
    .map((attempt) => Object.freeze({
      sourceSchema: PERSONAL_ORDAX_ACTION_ATTEMPT_SCHEMA,
      attemptId: attempt.id,
      actionId: attempt.actionId,
      toolId: attempt.toolId,
      status: attempt.status,
      summary: attempt.summary,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
    })));
  const pending = work.pendingApprovalId === null
    ? null
    : snapshot.approvals.find((approval) =>
      approval.workItemId === work.id
      && approval.id === work.pendingApprovalId
      && approval.status === "pending") ?? null;
  const pendingApproval = pending === null ? null : Object.freeze({
    sourceSchema: PERSONAL_ORDAX_APPROVAL_SCHEMA,
    approvalId: pending.id,
    actionId: pending.actionId,
    effect: pending.effect,
    reason: pending.reason,
    requestedAt: pending.requestedAt,
    // This is a read-only notification, never a grant to approve or execute.
  });
  const showResult = state === "result" && result !== null;
  const blocks = Object.freeze(showResult ? [Object.freeze({
    kind: "text",
    text: result.text,
    sourceSchema: PERSONAL_ORDAX_WORK_RESULT_SCHEMA,
    resultId: result.id,
    // Never parse HTML/JSON/URLs from model text into executable/privileged views.
  })] : []);
  return Object.freeze({
    schema: INTELLIGENCE_WORK_CANVAS_SCHEMA,
    state,
    workState: work.state,
    workItemId: work.id,
    ownerKind: work.ownerKind,
    ownerId: work.ownerId,
    spaceId: work.spaceId,
    projectId: work.projectId,
    resultId: showResult ? result.id : null,
    requestId: null, // Not present in ordax.personal-work-item/1.
    provenance: showResult ? Object.freeze({
      sourceSchema: PERSONAL_ORDAX_WORK_RESULT_SCHEMA,
      engineId: result.engineId,
      modelId: result.modelId,
      createdAt: result.createdAt,
    }) : null,
    blocks,
    steps,
    stepsTruncated: events.length > MAX_VISIBLE_STEPS,
    actionEvidence,
    actionsTruncated: attempts.length > MAX_VISIBLE_ACTIONS,
    pendingApproval,
    completionPercent: null, // No canonical percentage exists.
    authority: "none",
    toolExecution: false,
  });
}
