import { validateIdentitySessionSnapshot } from "../../../contracts/identity-session.mjs";
import { validateSpaceSelectionSnapshot } from "../../../contracts/space-selection.mjs";
import {
  PERSONAL_ORDAX_RUNTIME_SCHEMA,
  validatePersonalOrdaxRuntimeSnapshot,
} from "../../../contracts/personal-ordax-store.mjs";
import { projectPersonalWorkCanvas } from "../../../services/intelligence/work-canvas.mjs";

// Pure read-only projection of the *existing* Personal OrdaX owner. It never
// converts a conversational prompt into a task, step, approval or action.
export const ASSISTANT_WORK_STRIP_SCHEMA = "ordax.assistant-work-strip/1";
const MAX_CARDS = 3;

// Shared authorization fence for the Native Assistant's read-only cards
// and an explicit, user-initiated foreground Work request. No persisted
// Assistant-owned state or implied project selection is introduced.
export function resolveAssistantWorkScope(personalSnapshot, identityValue, selectionValue) {
  if (personalSnapshot === null || identityValue === null || selectionValue === null) return null;
  const identity = validateIdentitySessionSnapshot(identityValue);
  const selection = validateSpaceSelectionSnapshot(selectionValue);
  if (identity.state === "unavailable") return null;
  const personal = validatePersonalOrdaxRuntimeSnapshot(personalSnapshot);

  let visibleSpace = null;
  if (identity.state === "signed-out") {
    if (personal.ownerKind !== "device" || personal.ownerId !== null
      || selection.state !== "unavailable") return null;
  } else if (identity.state === "signed-in") {
    if (personal.ownerKind !== "account" || personal.ownerId !== identity.subjectId
      || selection.state === "unavailable" || selection.subjectId !== identity.subjectId) {
      return null;
    }
    visibleSpace = selection.state === "selected" ? selection.selectedSpace.id : null;
  } else return null;

  return Object.freeze({
    ownerKind: personal.ownerKind, ownerId: personal.ownerId,
    spaceId: visibleSpace, projectId: null,
  });
}

export function projectAssistantWorkStrip(personalSnapshot, identityValue, selectionValue) {
  const unavailable = Object.freeze({
    schema: ASSISTANT_WORK_STRIP_SCHEMA, cards: Object.freeze([]), remainingCount: 0,
  });
  const scope = resolveAssistantWorkScope(personalSnapshot, identityValue, selectionValue);
  if (scope === null) return unavailable;
  const personal = validatePersonalOrdaxRuntimeSnapshot(personalSnapshot);
  const visibleSpace = scope.spaceId;
  const scoped = personal.workItems.filter((item) =>
    // The global Assistant has no project selection. Only explicit owner and
    // Space scopes can contribute to *either* cards or status measurements.
    item.projectId === null && (item.spaceId === null || item.spaceId === visibleSpace)
    && (scope.ownerKind === "account" || item.spaceId === null)
  );
  const scopedCanvases = scoped.map((item) => Object.freeze({
    item,
    canvas: projectPersonalWorkCanvas(personal, {
      ownerKind: personal.ownerKind,
      ownerId: personal.ownerId,
      spaceId: item.spaceId,
      projectId: item.projectId,
      workItemId: item.id,
    }),
  }));
  // Counts come from the same validated Work Canvas projection as the cards,
  // across ALL visible Work (not merely the three cards on screen).
  // A completed Work missing its canonical Result is "unavailable", not success.
  const categories = Object.freeze([
    "requires-action", "working", "result", "failed", "unavailable",
  ]);
  const counts = new Map(categories.map((kind) => [kind, 0]));
  for (const { canvas } of scopedCanvases) {
    counts.set(canvas.state, counts.get(canvas.state) + 1);
  }
  const overview = Object.freeze({
    sourceSchema: PERSONAL_ORDAX_RUNTIME_SCHEMA,
    total: scopedCanvases.length,
    groups: Object.freeze(categories.map((kind) => Object.freeze({
      kind, count: counts.get(kind),
    }))),
    completionPercent: null,
    authority: "none",
  });
  // Priority affects only presentation, never Work state or permissions.
  // A real outstanding approval / uncertain execution must not be hidden
  // behind newer completed responses under the three-card display limit.
  const actionRequired = new Set([
    ...personal.attempts.filter((attempt) => attempt.status === "uncertain")
      .map((attempt) => attempt.workItemId),
    ...personal.approvals.filter((approval) => approval.status === "revoked")
      .map((approval) => approval.workItemId),
  ]);
  const priority = (work) => {
    if (work.state === "waiting-approval" || actionRequired.has(work.id)) return 0;
    if (work.state === "queued" || work.state === "running" || work.state === "paused") return 1;
    if (work.state === "failed" || work.state === "cancelled") return 2;
    return 3; // Completed work is still available, but cannot hide pending action.
  };
  const ranked = scopedCanvases.slice().sort((a, b) =>
    priority(a.item) - priority(b.item)
      || Date.parse(b.item.updatedAt) - Date.parse(a.item.updatedAt)
      || a.item.id.localeCompare(b.item.id));
  const cards = ranked.slice(0, MAX_CARDS).map(({ item, canvas }) => {
    return Object.freeze({
      workItemId: item.id,
      spaceId: item.spaceId,
      goal: item.goal,
      state: canvas.state,
      workState: canvas.workState,
      steps: Object.freeze(canvas.steps.slice(-5)),
      stepsTruncated: canvas.stepsTruncated || canvas.steps.length > 5,
      actionEvidence: canvas.actionEvidence,
      actionsTruncated: canvas.actionsTruncated,
      pendingApproval: canvas.pendingApproval,
      result: canvas.blocks.length === 1 ? canvas.blocks[0] : null,
      resultId: canvas.resultId,
      provenance: canvas.provenance,
      completionPercent: null,
      authority: "none",
    });
  });
  return Object.freeze({
    schema: ASSISTANT_WORK_STRIP_SCHEMA,
    cards: Object.freeze(cards),
    remainingCount: Math.max(0, ranked.length - cards.length),
    overview,
  });
}
