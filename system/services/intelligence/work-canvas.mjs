import { validatePersonalOrdaxRuntimeSnapshot } from "../../contracts/personal-ordax-store.mjs";
import {
  PERSONAL_ORDAX_ACTIVITY_SCHEMA,
  PERSONAL_ORDAX_WORK_RESULT_SCHEMA,
} from "../../contracts/personal-ordax.mjs";

// Read-only projection. The Personal OrdaX runtime is the owner of work, events,
// grants and results; this module never creates work or interprets model output
// as a receipt. Caller must obtain the snapshot from an authorized runtime.
export const INTELLIGENCE_WORK_CANVAS_SCHEMA = "ordax.intelligence-work-canvas/1";
const MAX_VISIBLE_STEPS = 32;
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
  if (uncertain) state = "requires-action";
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
    completionPercent: null, // No canonical percentage exists.
    authority: "none",
    toolExecution: false,
  });
}
