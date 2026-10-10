import { validateIdentitySessionSnapshot } from "../../../contracts/identity-session.mjs";
import { validateSpaceSelectionSnapshot } from "../../../contracts/space-selection.mjs";
import { validatePersonalOrdaxRuntimeSnapshot } from "../../../contracts/personal-ordax-store.mjs";
import { projectPersonalWorkCanvas } from "../../../services/intelligence/work-canvas.mjs";

// Pure read-only projection of the *existing* Personal OrdaX owner. It never
// converts a conversational prompt into a task, step, approval or action.
export const ASSISTANT_WORK_STRIP_SCHEMA = "ordax.assistant-work-strip/1";
const MAX_CARDS = 3;

export function projectAssistantWorkStrip(personalSnapshot, identityValue, selectionValue) {
  const unavailable = Object.freeze({
    schema: ASSISTANT_WORK_STRIP_SCHEMA, cards: Object.freeze([]), remainingCount: 0,
  });
  if (personalSnapshot === null || identityValue === null || selectionValue === null) {
    return unavailable;
  }
  const identity = validateIdentitySessionSnapshot(identityValue);
  const selection = validateSpaceSelectionSnapshot(selectionValue);
  if (identity.state === "unavailable") return unavailable;
  const personal = validatePersonalOrdaxRuntimeSnapshot(personalSnapshot);

  let visibleSpace = null;
  if (identity.state === "signed-out") {
    if (personal.ownerKind !== "device" || personal.ownerId !== null
      || selection.state !== "unavailable") return unavailable;
  } else if (identity.state === "signed-in") {
    if (personal.ownerKind !== "account" || personal.ownerId !== identity.subjectId
      || selection.state === "unavailable" || selection.subjectId !== identity.subjectId) {
      return unavailable;
    }
    visibleSpace = selection.state === "selected" ? selection.selectedSpace.id : null;
  } else return unavailable;

  const scoped = personal.workItems.filter((item) =>
    // Projects have no active selection in this global Assistant. They stay
    // available in their authorized Personal OrdaX/Activity owner only.
    item.projectId === null && (item.spaceId === null || item.spaceId === visibleSpace)
    && (identity.state === "signed-in" || item.spaceId === null)
  );
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
  const ranked = scoped.slice().sort((a, b) =>
    priority(a) - priority(b)
      || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      || a.id.localeCompare(b.id));
  const cards = ranked.slice(0, MAX_CARDS).map((item) => {
    const canvas = projectPersonalWorkCanvas(personal, {
      ownerKind: personal.ownerKind,
      ownerId: personal.ownerId,
      spaceId: item.spaceId,
      projectId: item.projectId,
      workItemId: item.id,
    });
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
  });
}
