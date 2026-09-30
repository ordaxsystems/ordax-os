export const PERSONAL_ORDAX_WORK_ITEM_SCHEMA = "ordax.personal-work-item/1";
export const PERSONAL_ORDAX_ACTIVITY_SCHEMA = "ordax.personal-activity/1";
export const PERSONAL_ORDAX_ACTION_DECISION_SCHEMA = "ordax.personal-action-decision/1";

const OWNER_KINDS = new Set(["device", "account"]);
const WORK_STATES = new Set([
  "queued",
  "running",
  "waiting-approval",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
const ACTIVITY_TYPES = new Set([
  "queued",
  "started",
  "progress",
  "approval-requested",
  "approval-resolved",
  "action-started",
  "action-finished",
  "paused",
  "resumed",
  "completed",
  "failed",
  "cancelled",
]);
const EFFECTS = new Set(["read", "write", "external-egress", "device-control"]);
const DECISIONS = new Set(["allow", "approval-required", "deny"]);
const AUTHORITY_SOURCES = new Set([
  "system-policy",
  "user-grant",
  "intelligence-tool-grant",
  "device-capability-grant",
]);
const FORBIDDEN_AUTHORITY_SOURCES = new Set([
  "prompt",
  "model",
  "profile",
  "profile-pack",
  "memory",
  "project-content",
]);

function boundedText(value, label, max = 256) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function optionalText(value, label, max = 256) {
  if (value == null || value === "") return null;
  return boundedText(value, label, max);
}

function timestamp(value, label) {
  const text = boundedText(value, label, 64);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  }
  return new Date(parsed).toISOString();
}

function boundedReferences(value, label, maxItems = 32) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const refs = value.map((entry) => boundedText(entry, label, 240));
  if (new Set(refs).size !== refs.length) {
    throw new TypeError(`${label} must contain unique values`);
  }
  return Object.freeze(refs);
}

function validateOwner(value) {
  const ownerKind = value.ownerKind;
  if (!OWNER_KINDS.has(ownerKind)) {
    throw new TypeError("personal work owner kind is invalid");
  }
  const ownerId = optionalText(value.ownerId, "personal work owner id", 160);
  if (ownerKind === "account" && ownerId === null) {
    throw new TypeError("account-owned personal work requires an owner id");
  }
  if (ownerKind === "device" && ownerId !== null) {
    throw new TypeError("device-owned personal work must not invent an account owner id");
  }
  return Object.freeze({ ownerKind, ownerId });
}

export function validatePersonalWorkItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal OrdaX work item must be an object");
  }
  const owner = validateOwner(value);
  if (!WORK_STATES.has(value.state)) {
    throw new TypeError("personal work state is invalid");
  }
  if (value.backgroundExecution === true) {
    throw new TypeError("background execution is not enabled by the foundation contract");
  }

  const pendingApprovalId = optionalText(
    value.pendingApprovalId,
    "personal work pending approval id",
    160,
  );
  if (value.state === "waiting-approval" && pendingApprovalId === null) {
    throw new TypeError("waiting-approval work requires a pending approval id");
  }
  if (value.state !== "waiting-approval" && pendingApprovalId !== null) {
    throw new TypeError("pending approval id is only valid while waiting for approval");
  }

  return Object.freeze({
    schema: PERSONAL_ORDAX_WORK_ITEM_SCHEMA,
    id: boundedText(value.id, "personal work id", 160),
    ownerKind: owner.ownerKind,
    ownerId: owner.ownerId,
    goal: boundedText(value.goal, "personal work goal", 4096),
    state: value.state,
    spaceId: optionalText(value.spaceId, "personal work Space id", 160),
    projectId: optionalText(value.projectId, "personal work project id", 240),
    pendingApprovalId,
    backgroundExecution: false,
    contextRefs: boundedReferences(value.contextRefs, "personal work context refs"),
    createdAt: timestamp(value.createdAt, "personal work createdAt"),
    updatedAt: timestamp(value.updatedAt, "personal work updatedAt"),
  });
}

export function validatePersonalActivityEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal OrdaX activity event must be an object");
  }
  if (!ACTIVITY_TYPES.has(value.type)) {
    throw new TypeError("personal activity type is invalid");
  }
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) {
    throw new TypeError("personal activity sequence is invalid");
  }

  const approvalId = optionalText(value.approvalId, "personal activity approval id", 160);
  const actionId = optionalText(value.actionId, "personal activity action id", 160);
  if (
    (value.type === "approval-requested" || value.type === "approval-resolved")
    && approvalId === null
  ) {
    throw new TypeError("approval activity requires an approval id");
  }
  if (
    (value.type === "action-started" || value.type === "action-finished")
    && actionId === null
  ) {
    throw new TypeError("action activity requires an action id");
  }

  return Object.freeze({
    schema: PERSONAL_ORDAX_ACTIVITY_SCHEMA,
    workItemId: boundedText(value.workItemId, "personal activity work item id", 160),
    sequence: value.sequence,
    type: value.type,
    summary: boundedText(value.summary, "personal activity summary", 1024),
    approvalId,
    actionId,
    artifactRefs: boundedReferences(value.artifactRefs, "personal activity artifact refs", 16),
    occurredAt: timestamp(value.occurredAt, "personal activity occurredAt"),
  });
}

export function validatePersonalActionDecision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal OrdaX action decision must be an object");
  }
  if (!EFFECTS.has(value.effect) || !DECISIONS.has(value.decision)) {
    throw new TypeError("personal action effect/decision is invalid");
  }
  if (FORBIDDEN_AUTHORITY_SOURCES.has(value.authoritySource)) {
    throw new TypeError("content cannot create Personal OrdaX action authority");
  }
  if (!AUTHORITY_SOURCES.has(value.authoritySource)) {
    throw new TypeError("personal action authority source is invalid");
  }

  const grantRef = optionalText(value.grantRef, "personal action grant ref", 240);
  if (
    value.decision === "allow"
    && value.effect !== "read"
    && value.authoritySource === "system-policy"
  ) {
    throw new TypeError("sensitive actions cannot be allowed by default system policy");
  }
  if (
    value.decision === "allow"
    && value.effect !== "read"
    && grantRef === null
  ) {
    throw new TypeError("allowed sensitive actions require an explicit grant reference");
  }

  return Object.freeze({
    schema: PERSONAL_ORDAX_ACTION_DECISION_SCHEMA,
    workItemId: boundedText(value.workItemId, "personal action work item id", 160),
    actionId: boundedText(value.actionId, "personal action id", 160),
    effect: value.effect,
    decision: value.decision,
    authoritySource: value.authoritySource,
    grantRef,
    reason: boundedText(value.reason, "personal action reason", 512),
    decidedAt: timestamp(value.decidedAt, "personal action decidedAt"),
  });
}

export function canExecutePersonalAction(value) {
  const decision = validatePersonalActionDecision(value);
  return decision.decision === "allow";
}
