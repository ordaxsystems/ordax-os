export const PERSONAL_ORDAX_WORK_ITEM_SCHEMA = "ordax.personal-work-item/1";
export const PERSONAL_ORDAX_ACTIVITY_SCHEMA = "ordax.personal-activity/1";
export const PERSONAL_ORDAX_ACTION_DECISION_SCHEMA = "ordax.personal-action-decision/1";
export const PERSONAL_ORDAX_APPROVAL_SCHEMA = "ordax.personal-approval/1";
export const PERSONAL_ORDAX_WORK_RESULT_SCHEMA = "ordax.personal-work-result/1";
export const PERSONAL_ORDAX_ACTION_ATTEMPT_SCHEMA = "ordax.personal-action-attempt/1";
export const PERSONAL_ORDAX_MAX_RESULT_CHARS = 65536;
export const PERSONAL_ORDAX_MAX_GOAL_CHARS = 4096;

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
const SHA256_RE = /^[0-9a-f]{64}$/;
const DECISIONS = new Set(["allow", "approval-required", "deny"]);
const APPROVAL_STATUSES = new Set(["pending", "approved", "executed", "revoked", "denied", "cancelled"]);
const ACTION_ATTEMPT_STATUSES = new Set(["started", "succeeded", "failed", "uncertain"]);
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

  const createdAt = timestamp(value.createdAt, "personal work createdAt");
  const updatedAt = timestamp(value.updatedAt, "personal work updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new TypeError("personal work updatedAt cannot precede createdAt");
  }

  return Object.freeze({
    schema: PERSONAL_ORDAX_WORK_ITEM_SCHEMA,
    id: boundedText(value.id, "personal work id", 160),
    ownerKind: owner.ownerKind,
    ownerId: owner.ownerId,
    goal: boundedText(value.goal, "personal work goal", PERSONAL_ORDAX_MAX_GOAL_CHARS),
    state: value.state,
    spaceId: optionalText(value.spaceId, "personal work Space id", 160),
    projectId: optionalText(value.projectId, "personal work project id", 240),
    pendingApprovalId,
    backgroundExecution: false,
    contextRefs: boundedReferences(value.contextRefs, "personal work context refs"),
    createdAt,
    updatedAt,
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

export function validatePersonalApproval(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal OrdaX approval must be an object");
  }
  if (value.schema !== undefined && value.schema !== PERSONAL_ORDAX_APPROVAL_SCHEMA) {
    throw new TypeError("Personal OrdaX approval schema is incompatible");
  }
  if (!EFFECTS.has(value.effect) || !APPROVAL_STATUSES.has(value.status)) {
    throw new TypeError("personal approval effect/status is invalid");
  }

  const requestedAt = timestamp(value.requestedAt, "personal approval requestedAt");
  const resolvedAt = value.resolvedAt == null
    ? null
    : timestamp(value.resolvedAt, "personal approval resolvedAt");
  const grantRef = optionalText(value.grantRef, "personal approval grant ref", 240);
  const executedAt = value.executedAt == null
    ? null
    : timestamp(value.executedAt, "personal approval executedAt");
  const toolArtifactSha256 = boundedText(value.toolArtifactSha256, "personal approval tool artifact sha256", 64);
  if (!SHA256_RE.test(toolArtifactSha256)) {
    throw new TypeError("personal approval tool artifact sha256 is invalid");
  }

  if (value.status === "pending" && (resolvedAt !== null || grantRef !== null || executedAt !== null)) {
    throw new TypeError("pending approval cannot already be resolved, executed or carry a grant");
  }
  if (value.status !== "pending" && resolvedAt === null) {
    throw new TypeError("resolved approval requires resolvedAt");
  }
  if (resolvedAt !== null && Date.parse(resolvedAt) < Date.parse(requestedAt)) {
    throw new TypeError("approval resolution cannot precede its request");
  }
  if ((value.status === "approved" || value.status === "executed") && value.effect !== "read" && grantRef === null) {
    throw new TypeError("approved or executed sensitive action requires an explicit grant reference");
  }
  if ((value.status === "approved" || value.status === "revoked") && executedAt !== null) {
    throw new TypeError("approved or revoked action cannot be marked executed");
  }
  if (value.status === "revoked" && grantRef === null) {
    throw new TypeError("revoked approval must retain its revoked grant reference for audit");
  }
  if (value.status === "executed" && executedAt === null) {
    throw new TypeError("executed approval requires executedAt");
  }
  if (executedAt !== null && resolvedAt !== null && Date.parse(executedAt) < Date.parse(resolvedAt)) {
    throw new TypeError("approval execution cannot precede approval resolution");
  }
  if ((value.status === "denied" || value.status === "cancelled") && (grantRef !== null || executedAt !== null)) {
    throw new TypeError("denied or cancelled approval cannot carry execution state");
  }

  return Object.freeze({
    schema: PERSONAL_ORDAX_APPROVAL_SCHEMA,
    id: boundedText(value.id, "personal approval id", 200),
    workItemId: boundedText(value.workItemId, "personal approval work item id", 160),
    actionId: boundedText(value.actionId, "personal approval action id", 128),
    toolId: boundedText(value.toolId, "personal approval tool id", 96),
    toolArtifactSha256,
    effect: value.effect,
    resourceRef: optionalText(value.resourceRef, "personal approval resource ref", 512),
    status: value.status,
    reason: boundedText(value.reason, "personal approval reason", 512),
    grantRef,
    requestedAt,
    resolvedAt,
    executedAt,
  });
}

export function validatePersonalActionAttempt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal OrdaX action attempt must be an object");
  }
  if (
    value.schema !== undefined
    && value.schema !== PERSONAL_ORDAX_ACTION_ATTEMPT_SCHEMA
  ) {
    throw new TypeError("Personal OrdaX action attempt schema is incompatible");
  }
  if (!EFFECTS.has(value.effect) || !ACTION_ATTEMPT_STATUSES.has(value.status)) {
    throw new TypeError("personal action attempt effect/status is invalid");
  }
  const toolArtifactSha256 = boundedText(
    value.toolArtifactSha256,
    "personal action attempt tool artifact sha256",
    64,
  );
  if (!SHA256_RE.test(toolArtifactSha256)) {
    throw new TypeError("personal action attempt tool artifact sha256 is invalid");
  }
  const startedAt = timestamp(value.startedAt, "personal action attempt startedAt");
  const finishedAt = value.finishedAt == null
    ? null
    : timestamp(value.finishedAt, "personal action attempt finishedAt");
  if (value.status === "started" && finishedAt !== null) {
    throw new TypeError("started Personal OrdaX action attempt cannot already be finished");
  }
  if (value.status !== "started" && finishedAt === null) {
    throw new TypeError("terminal Personal OrdaX action attempt requires finishedAt");
  }
  if (finishedAt !== null && Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new TypeError("Personal OrdaX action attempt cannot finish before it starts");
  }
  const summary = value.summary == null || value.summary === ""
    ? null
    : boundedText(value.summary, "personal action attempt summary", 1024);
  const artifactRefs = boundedReferences(
    value.artifactRefs,
    "personal action attempt artifact refs",
    16,
  );
  if (value.status === "started" && (summary !== null || artifactRefs.length > 0)) {
    throw new TypeError("started Personal OrdaX action attempt cannot carry an outcome");
  }
  if (value.status !== "succeeded" && artifactRefs.length > 0) {
    throw new TypeError("only succeeded Personal OrdaX action attempt may retain artifacts");
  }
  const resourceRef = optionalText(
    value.resourceRef,
    "personal action attempt resource ref",
    512,
  );
  const grantRef = optionalText(value.grantRef, "personal action attempt grant ref", 240);
  if (value.effect !== "read" && (resourceRef === null || grantRef === null)) {
    throw new TypeError("sensitive Personal OrdaX action attempt requires exact resource and grant references");
  }
  return Object.freeze({
    schema: PERSONAL_ORDAX_ACTION_ATTEMPT_SCHEMA,
    id: boundedText(value.id, "personal action attempt id", 240),
    workItemId: boundedText(value.workItemId, "personal action attempt work item id", 160),
    approvalId: boundedText(value.approvalId, "personal action attempt approval id", 200),
    actionId: boundedText(value.actionId, "personal action attempt action id", 160),
    toolId: boundedText(value.toolId, "personal action attempt tool id", 96),
    toolArtifactSha256,
    effect: value.effect,
    resourceRef,
    grantRef,
    status: value.status,
    summary,
    artifactRefs,
    startedAt,
    finishedAt,
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
    approvalId: optionalText(value.approvalId, "personal action approval id", 200),
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

export function validatePersonalWorkResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal OrdaX work result must be an object");
  }
  if (value.schema !== undefined && value.schema !== PERSONAL_ORDAX_WORK_RESULT_SCHEMA) {
    throw new TypeError("Personal OrdaX work result schema is incompatible");
  }
  if (value.kind !== "intelligence-response") {
    throw new TypeError("Personal OrdaX work result kind is invalid");
  }
  if (value.authority !== "none") {
    throw new TypeError("Personal OrdaX work result cannot carry action authority");
  }

  return Object.freeze({
    schema: PERSONAL_ORDAX_WORK_RESULT_SCHEMA,
    id: boundedText(value.id, "personal work result id", 200),
    workItemId: boundedText(value.workItemId, "personal work result work item id", 160),
    kind: "intelligence-response",
    text: boundedText(
      value.text,
      "personal work result text",
      PERSONAL_ORDAX_MAX_RESULT_CHARS,
    ),
    engineId: boundedText(value.engineId, "personal work result engine id", 80),
    modelId: boundedText(value.modelId, "personal work result model id", 160),
    authority: "none",
    artifactRefs: boundedReferences(value.artifactRefs, "personal work result artifact refs", 16),
    createdAt: timestamp(value.createdAt, "personal work result createdAt"),
  });
}

