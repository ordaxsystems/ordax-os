import { validatePersonalOrdaxRuntimeSnapshot } from "../../contracts/personal-ordax-store.mjs";
import { projectPersonalWorkCanvas } from "../../services/intelligence/work-canvas.mjs";

export function projectPersonalActivitySnapshot(value) {
  const snapshot = validatePersonalOrdaxRuntimeSnapshot(value);
  const activitiesByWork = new Map();
  for (const event of snapshot.activities) {
    const list = activitiesByWork.get(event.workItemId) ?? [];
    list.push(event);
    activitiesByWork.set(event.workItemId, list);
  }
  const resultByWork = new Map(
    snapshot.results.map((result) => [result.workItemId, result]),
  );
  const approvalById = new Map(
    snapshot.approvals.map((approval) => [approval.id, approval]),
  );
  const approvedApprovalByWork = new Map();
  for (const approval of snapshot.approvals) {
    if (approval.status === "approved") approvedApprovalByWork.set(approval.workItemId, approval);
  }
  const attemptsByWork = new Map();
  for (const attempt of snapshot.attempts) {
    const list = attemptsByWork.get(attempt.workItemId) ?? [];
    list.push(attempt);
    attemptsByWork.set(attempt.workItemId, list);
  }
  const decisionsByWork = new Map();
  for (const decision of snapshot.decisions) {
    const list = decisionsByWork.get(decision.workItemId) ?? [];
    list.push(decision);
    decisionsByWork.set(decision.workItemId, list);
  }

  return Object.freeze({
    ownerKind: snapshot.ownerKind,
    ownerId: snapshot.ownerId,
    persistence: snapshot.persistence,
    work: Object.freeze(snapshot.workItems.map((item) => Object.freeze({
      item,
      // Personal OrdaX is the only owner of this snapshot. Explicit IDs ensure
      // that this projection cannot select another work item or invent context.
      canvas: projectPersonalWorkCanvas(snapshot, {
        ownerKind: snapshot.ownerKind,
        ownerId: snapshot.ownerId,
        spaceId: item.spaceId,
        projectId: item.projectId,
        workItemId: item.id,
      }),
      activities: Object.freeze([...(activitiesByWork.get(item.id) ?? [])]),
      result: resultByWork.get(item.id) ?? null,
      pendingApproval: item.pendingApprovalId === null
        ? null
        : approvalById.get(item.pendingApprovalId) ?? null,
      approvedApproval: approvedApprovalByWork.get(item.id) ?? null,
      decisions: Object.freeze([...(decisionsByWork.get(item.id) ?? [])]),
      attempts: Object.freeze([...(attemptsByWork.get(item.id) ?? [])]),
      latestAttempt: (attemptsByWork.get(item.id) ?? []).at(-1) ?? null,
    }))),
  });
}
