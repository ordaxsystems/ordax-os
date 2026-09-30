import {
  validatePersonalActivityEvent,
  validatePersonalActionDecision,
  validatePersonalApproval,
  validatePersonalWorkItem,
  validatePersonalWorkResult,
} from "./personal-ordax.mjs";

export const PERSONAL_ORDAX_STORE_SCHEMA = "ordax.personal-work-store/1";
export const PERSONAL_ORDAX_STORE_STATE_SCHEMA = "ordax.personal-work-store-state/1";
export const PERSONAL_ORDAX_RUNTIME_SCHEMA = "ordax.personal-runtime/1";
export const MAX_PERSONAL_WORK_ITEMS = 32;
export const MAX_PERSONAL_ACTIVITY_EVENTS = 512;
export const MAX_PERSONAL_WORK_RESULTS = 32;
export const MAX_PERSONAL_APPROVALS = 64;
export const MAX_PERSONAL_ACTION_DECISIONS = 64;
export const MAX_PERSONAL_ORDAX_STORE_BYTES = 4 * 1024 * 1024;

const encoder = new TextEncoder();
const STORE_SCOPES = new Set(["device", "session"]);
const OWNER_KINDS = new Set(["device", "account"]);
const RUNTIME_WORK_ID_RE = /^personal-work-([1-9][0-9]*)$/;

function boundedOwnerId(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Personal OrdaX owner id must be text");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new TypeError("Personal OrdaX owner id is outside bounds");
  }
  return normalized;
}

export function validatePersonalOrdaxOwner(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal OrdaX owner must be an object");
  }
  if (!OWNER_KINDS.has(value.ownerKind)) {
    throw new TypeError("Personal OrdaX owner kind is invalid");
  }
  const ownerId = value.ownerKind === "account"
    ? boundedOwnerId(value.ownerId)
    : null;
  if (value.ownerKind === "device" && value.ownerId != null) {
    throw new TypeError("Device-owned Personal OrdaX state cannot carry an account owner id");
  }
  return Object.freeze({ ownerKind: value.ownerKind, ownerId });
}

export function personalOrdaxOwnerKey(value) {
  const owner = validatePersonalOrdaxOwner(value);
  return owner.ownerKind === "device" ? "device" : `account:${owner.ownerId}`;
}

function validateNextOrdinal(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Personal OrdaX next ordinal must be a positive safe integer");
  }
  return value;
}

export function createEmptyPersonalOrdaxStoreState(ownerValue) {
  const owner = validatePersonalOrdaxOwner(ownerValue);
  return Object.freeze({
    schema: PERSONAL_ORDAX_STORE_STATE_SCHEMA,
    ownerKind: owner.ownerKind,
    ownerId: owner.ownerId,
    nextOrdinal: 1,
    workItems: Object.freeze([]),
    activities: Object.freeze([]),
    results: Object.freeze([]),
    approvals: Object.freeze([]),
    decisions: Object.freeze([]),
  });
}

export function validatePersonalOrdaxStoreState(value, expectedOwnerValue = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal OrdaX store state must be an object");
  }
  if (value.schema !== PERSONAL_ORDAX_STORE_STATE_SCHEMA) {
    throw new TypeError("Personal OrdaX store state schema is incompatible");
  }
  const owner = validatePersonalOrdaxOwner(value);
  if (expectedOwnerValue !== null) {
    const expected = validatePersonalOrdaxOwner(expectedOwnerValue);
    if (owner.ownerKind !== expected.ownerKind || owner.ownerId !== expected.ownerId) {
      throw new TypeError("Personal OrdaX store state belongs to a different owner");
    }
  }
  if (!Array.isArray(value.workItems) || value.workItems.length > MAX_PERSONAL_WORK_ITEMS) {
    throw new TypeError("Personal OrdaX work items exceed their per-owner bound");
  }
  if (!Array.isArray(value.activities) || value.activities.length > MAX_PERSONAL_ACTIVITY_EVENTS) {
    throw new TypeError("Personal OrdaX activity events exceed their per-owner bound");
  }
  const rawResults = value.results ?? [];
  if (!Array.isArray(rawResults) || rawResults.length > MAX_PERSONAL_WORK_RESULTS) {
    throw new TypeError("Personal OrdaX work results exceed their per-owner bound");
  }
  const rawApprovals = value.approvals ?? [];
  if (!Array.isArray(rawApprovals) || rawApprovals.length > MAX_PERSONAL_APPROVALS) {
    throw new TypeError("Personal OrdaX approvals exceed their per-owner bound");
  }
  const rawDecisions = value.decisions ?? [];
  if (!Array.isArray(rawDecisions) || rawDecisions.length > MAX_PERSONAL_ACTION_DECISIONS) {
    throw new TypeError("Personal OrdaX action decisions exceed their per-owner bound");
  }

  const workItems = Object.freeze(value.workItems.map(validatePersonalWorkItem));
  const workIds = new Set(workItems.map((item) => item.id));
  if (workIds.size !== workItems.length) {
    throw new TypeError("Personal OrdaX work ids must be unique inside an owner partition");
  }
  for (const item of workItems) {
    if (item.ownerKind !== owner.ownerKind || item.ownerId !== owner.ownerId) {
      throw new TypeError("Personal OrdaX work cannot cross its store owner partition");
    }
  }

  const workById = new Map(workItems.map((item) => [item.id, item]));
  const highestRuntimeOrdinal = workItems.reduce((highest, item) => {
    const match = RUNTIME_WORK_ID_RE.exec(item.id);
    if (!match) return highest;
    const ordinal = Number(match[1]);
    if (!Number.isSafeInteger(ordinal)) {
      throw new TypeError("Personal OrdaX runtime work id ordinal is invalid");
    }
    return Math.max(highest, ordinal);
  }, 0);
  const nextOrdinal = validateNextOrdinal(value.nextOrdinal);
  if (nextOrdinal <= highestRuntimeOrdinal) {
    throw new TypeError("Personal OrdaX next ordinal must exceed retained runtime work ids");
  }

  const activities = Object.freeze(value.activities.map(validatePersonalActivityEvent));
  const lastSequence = new Map();
  const lastOccurredAt = new Map();
  for (const event of activities) {
    const work = workById.get(event.workItemId);
    if (!work) {
      throw new TypeError("Personal OrdaX activity cannot reference missing work");
    }
    const previous = lastSequence.get(event.workItemId) ?? 0;
    if (event.sequence <= previous) {
      throw new TypeError("Personal OrdaX activity sequence must increase per work item");
    }
    if (Date.parse(event.occurredAt) < Date.parse(work.createdAt)) {
      throw new TypeError("Personal OrdaX activity cannot precede work creation");
    }
    const previousOccurredAt = lastOccurredAt.get(event.workItemId);
    if (previousOccurredAt && Date.parse(event.occurredAt) < Date.parse(previousOccurredAt)) {
      throw new TypeError("Personal OrdaX activity time must not regress per work item");
    }
    lastSequence.set(event.workItemId, event.sequence);
    lastOccurredAt.set(event.workItemId, event.occurredAt);
  }

  const results = Object.freeze(rawResults.map(validatePersonalWorkResult));
  const resultIds = new Set();
  const resultWorkIds = new Set();
  for (const result of results) {
    if (resultIds.has(result.id)) {
      throw new TypeError("Personal OrdaX work result ids must be unique inside an owner partition");
    }
    if (resultWorkIds.has(result.workItemId)) {
      throw new TypeError("Personal OrdaX work may have only one retained result");
    }
    const work = workById.get(result.workItemId);
    if (!work) {
      throw new TypeError("Personal OrdaX work result cannot reference missing work");
    }
    if (work.state !== "completed") {
      throw new TypeError("Personal OrdaX work result requires completed work");
    }
    const resultTime = Date.parse(result.createdAt);
    if (resultTime < Date.parse(work.createdAt) || resultTime > Date.parse(work.updatedAt)) {
      throw new TypeError("Personal OrdaX work result time must fall inside the work lifecycle");
    }
    resultIds.add(result.id);
    resultWorkIds.add(result.workItemId);
  }

  const approvals = Object.freeze(rawApprovals.map(validatePersonalApproval));
  const approvalById = new Map();
  const approvalByAction = new Map();
  for (const approval of approvals) {
    if (approvalById.has(approval.id)) {
      throw new TypeError("Personal OrdaX approval ids must be unique inside an owner partition");
    }
    const work = workById.get(approval.workItemId);
    if (!work) {
      throw new TypeError("Personal OrdaX approval cannot reference missing work");
    }
    const actionKey = `${approval.workItemId}\0${approval.actionId}`;
    if (approvalByAction.has(actionKey)) {
      throw new TypeError("Personal OrdaX action may have only one retained approval");
    }
    if (Date.parse(approval.requestedAt) < Date.parse(work.createdAt)) {
      throw new TypeError("Personal OrdaX approval cannot precede work creation");
    }
    if (approval.resolvedAt !== null && Date.parse(approval.resolvedAt) > Date.parse(work.updatedAt)) {
      throw new TypeError("Personal OrdaX approval cannot resolve after the work update boundary");
    }
    if (approval.executedAt !== null && Date.parse(approval.executedAt) > Date.parse(work.updatedAt)) {
      throw new TypeError("Personal OrdaX approval cannot execute after the work update boundary");
    }
    approvalById.set(approval.id, approval);
    approvalByAction.set(actionKey, approval);
  }

  for (const work of workItems) {
    const pending = approvals.filter(
      (approval) => approval.workItemId === work.id && approval.status === "pending",
    );
    if (work.state === "waiting-approval") {
      if (pending.length !== 1 || pending[0].id !== work.pendingApprovalId) {
        throw new TypeError("waiting-approval work must reference exactly one pending approval");
      }
    } else if (pending.length !== 0) {
      throw new TypeError("pending approval requires work in waiting-approval state");
    }
  }

  const approvalRequestedCounts = new Map(approvals.map((approval) => [approval.id, 0]));
  const approvalResolvedCounts = new Map(approvals.map((approval) => [approval.id, 0]));
  for (const event of activities) {
    if (event.approvalId === null) continue;
    const approval = approvalById.get(event.approvalId);
    if (!approval || approval.workItemId !== event.workItemId) {
      throw new TypeError("Personal OrdaX activity references a missing or foreign approval");
    }
    if (event.type === "approval-requested") {
      if (Date.parse(event.occurredAt) !== Date.parse(approval.requestedAt)) {
        throw new TypeError("approval-requested activity must match the approval request time");
      }
      approvalRequestedCounts.set(approval.id, approvalRequestedCounts.get(approval.id) + 1);
    } else if (event.type === "approval-resolved") {
      if (
        approval.resolvedAt === null
        || Date.parse(event.occurredAt) !== Date.parse(approval.resolvedAt)
      ) {
        throw new TypeError("approval-resolved activity must match the approval resolution time");
      }
      approvalResolvedCounts.set(approval.id, approvalResolvedCounts.get(approval.id) + 1);
    }
  }
  for (const approval of approvals) {
    if (approvalRequestedCounts.get(approval.id) !== 1) {
      throw new TypeError("Personal OrdaX approval requires exactly one approval-requested activity");
    }
    const expectedResolved = approval.status === "pending" ? 0 : 1;
    if (approvalResolvedCounts.get(approval.id) !== expectedResolved) {
      throw new TypeError("Personal OrdaX approval resolution Activity graph is inconsistent");
    }
  }

  for (const approval of approvals) {
    if (approval.status !== "executed") continue;
    const finished = activities.filter((event) =>
      event.workItemId === approval.workItemId
      && event.approvalId === approval.id
      && event.actionId === approval.actionId
      && event.type === "action-finished"
      && Date.parse(event.occurredAt) === Date.parse(approval.executedAt)
    );
    if (finished.length !== 1) {
      throw new TypeError("executed Personal OrdaX approval requires one matching final action Activity");
    }
  }

  const decisions = Object.freeze(rawDecisions.map(validatePersonalActionDecision));
  const decisionByAction = new Map();
  for (const actionDecision of decisions) {
    const work = workById.get(actionDecision.workItemId);
    if (!work) {
      throw new TypeError("Personal OrdaX action decision cannot reference missing work");
    }
    const actionKey = `${actionDecision.workItemId}\0${actionDecision.actionId}`;
    if (decisionByAction.has(actionKey)) {
      throw new TypeError("Personal OrdaX action may have only one retained terminal decision");
    }
    const approval = approvalByAction.get(actionKey);
    if (!approval || approval.status === "pending" || approval.status === "cancelled") {
      throw new TypeError("Personal OrdaX terminal action decision requires a resolved approval");
    }
    if (actionDecision.effect !== approval.effect) {
      throw new TypeError("Personal OrdaX action decision effect must match its approval");
    }
    if (Date.parse(actionDecision.decidedAt) !== Date.parse(approval.resolvedAt)) {
      throw new TypeError("Personal OrdaX action decision time must match approval resolution");
    }
    if (approval.status === "approved" || approval.status === "executed" || approval.status === "revoked") {
      if (actionDecision.decision !== "allow" || actionDecision.grantRef !== approval.grantRef) {
        throw new TypeError("approved Personal OrdaX action requires the matching allow decision");
      }
    } else if (actionDecision.decision !== "deny") {
      throw new TypeError("denied Personal OrdaX action requires a deny decision");
    }
    decisionByAction.set(actionKey, actionDecision);
  }
  for (const approval of approvals) {
    const actionKey = `${approval.workItemId}\0${approval.actionId}`;
    if (
      (approval.status === "approved" || approval.status === "executed" || approval.status === "revoked" || approval.status === "denied")
      && !decisionByAction.has(actionKey)
    ) {
      throw new TypeError("resolved Personal OrdaX approval requires its terminal action decision");
    }
  }

  const resultByRef = new Map(results.map((result) => [`result:${result.id}`, result]));
  const resultReferenceCounts = new Map(results.map((result) => [result.id, 0]));
  for (const event of activities) {
    for (const artifactRef of event.artifactRefs) {
      if (!artifactRef.startsWith("result:")) continue;
      const result = resultByRef.get(artifactRef);
      if (!result) {
        throw new TypeError("Personal OrdaX activity references a missing work result");
      }
      if (event.type !== "completed" || result.workItemId !== event.workItemId) {
        throw new TypeError("Personal OrdaX work result must be referenced by its completed activity");
      }
      resultReferenceCounts.set(result.id, resultReferenceCounts.get(result.id) + 1);
    }
  }
  for (const result of results) {
    if (resultReferenceCounts.get(result.id) !== 1) {
      throw new TypeError("Personal OrdaX work result requires exactly one completed activity reference");
    }
  }

  const snapshot = Object.freeze({
    schema: PERSONAL_ORDAX_STORE_STATE_SCHEMA,
    ownerKind: owner.ownerKind,
    ownerId: owner.ownerId,
    nextOrdinal,
    workItems,
    activities,
    results,
    approvals,
    decisions,
  });
  if (encoder.encode(JSON.stringify(snapshot)).byteLength > MAX_PERSONAL_ORDAX_STORE_BYTES) {
    throw new TypeError("Personal OrdaX owner partition exceeds its serialized byte limit");
  }
  return snapshot;
}

export function assertPersonalOrdaxStore(store) {
  if (!store || typeof store !== "object" || store.schema !== PERSONAL_ORDAX_STORE_SCHEMA) {
    throw new TypeError("A compatible Personal OrdaX store is required");
  }
  if (!STORE_SCOPES.has(store.scope)) {
    throw new TypeError("Personal OrdaX store scope must be device or session");
  }
  for (const method of ["load", "save"]) {
    if (typeof store[method] !== "function") {
      throw new TypeError(`Personal OrdaX store must implement ${method}()`);
    }
  }
  return store;
}

export function validatePersonalOrdaxRuntimeSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal OrdaX runtime snapshot must be an object");
  }
  if (value.schema !== PERSONAL_ORDAX_RUNTIME_SCHEMA) {
    throw new TypeError("Personal OrdaX runtime snapshot schema is incompatible");
  }
  if (!STORE_SCOPES.has(value.persistence)) {
    throw new TypeError("Personal OrdaX runtime persistence is invalid");
  }
  const state = validatePersonalOrdaxStoreState({
    schema: PERSONAL_ORDAX_STORE_STATE_SCHEMA,
    ownerKind: value.ownerKind,
    ownerId: value.ownerId,
    nextOrdinal: value.nextOrdinal,
    workItems: value.workItems,
    activities: value.activities,
    results: value.results,
    approvals: value.approvals,
    decisions: value.decisions,
  });
  return Object.freeze({
    schema: PERSONAL_ORDAX_RUNTIME_SCHEMA,
    persistence: value.persistence,
    ownerKind: state.ownerKind,
    ownerId: state.ownerId,
    nextOrdinal: state.nextOrdinal,
    workItems: state.workItems,
    activities: state.activities,
    results: state.results,
    approvals: state.approvals,
    decisions: state.decisions,
  });
}
