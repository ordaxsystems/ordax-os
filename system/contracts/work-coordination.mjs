export const WORK_COORDINATION_POLICY_SCHEMA = "ordax.work-coordination-policy/1";
export const WORK_PLAN_SCHEMA = "ordax.work-plan/1";
export const WORK_TASK_SCHEMA = "ordax.work-task/1";
export const WORK_CLAIM_SCHEMA = "ordax.work-claim/1";
export const WORK_CHECKPOINT_SCHEMA = "ordax.work-checkpoint/1";
export const WORK_EVIDENCE_SCHEMA = "ordax.work-evidence/1";

export const WORK_COORDINATION_MAX_CLAIM_LEASE_MS = 15 * 60 * 1000;

const OWNER_KINDS = new Set(["device", "account"]);
const POLICY_SCOPES = new Set(["global", "project"]);
const COORDINATION_MODES = new Set(["off", "manual", "assisted", "automatic"]);
const PLAN_STATES = new Set(["active", "paused", "completed", "archived"]);
const TASK_STATES = new Set([
  "planned",
  "ready",
  "blocked",
  "in-progress",
  "review",
  "completed",
  "cancelled",
]);
const WORKER_KINDS = new Set(["human", "ai-client", "local-service"]);
const EVIDENCE_KINDS = new Set([
  "pull-request",
  "commit",
  "ci-run",
  "artifact",
  "action-receipt",
  "document",
  "physical-proof",
  "manual-verification",
]);
const EVIDENCE_VERIFICATION_STATES = new Set(["unverified", "verified", "rejected"]);
const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  "grantRef",
  "approvalId",
  "actionId",
  "toolId",
  "authoritySource",
  "effect",
  "decision",
  "executionAuthorized",
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function text(value, label, max = 256) {
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
  return value == null || value === "" ? null : text(value, label, max);
}

function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return value;
}

function timestamp(value, label, nullable = false) {
  if (value == null && nullable) return null;
  const normalized = text(value, label, 64);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  }
  return new Date(parsed).toISOString();
}

function schema(value, expected, label) {
  if (value.schema !== undefined && value.schema !== expected) {
    throw new TypeError(`${label} schema is incompatible`);
  }
}

function authorityNone(value, label) {
  if (value.authority !== "none") {
    throw new TypeError(`${label} cannot carry action authority`);
  }
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      throw new TypeError(`${label} cannot carry authority field ${field}`);
    }
  }
}

function owner(ownerKind, ownerId, label) {
  if (!OWNER_KINDS.has(ownerKind)) {
    throw new TypeError(`${label} owner kind is invalid`);
  }
  if (ownerKind === "device") {
    if (ownerId != null && ownerId !== "") {
      throw new TypeError(`${label} device owner must not use synthetic owner id`);
    }
    return Object.freeze({ ownerKind, ownerId: null });
  }
  return Object.freeze({
    ownerKind,
    ownerId: text(ownerId, `${label} owner id`, 160),
  });
}

function uniqueTextArray(value, label, {
  maxItems = 32,
  maxChars = 240,
  allowEmpty = true,
} = {}) {
  if (value == null && allowEmpty) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > maxItems || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const normalized = value.map((entry) => text(entry, label, maxChars));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${label} must contain unique values`);
  }
  return Object.freeze(normalized);
}

function evidenceRequirements(value) {
  const requirements = uniqueTextArray(value, "Work task evidence requirements", {
    maxItems: EVIDENCE_KINDS.size,
    maxChars: 64,
  });
  for (const requirement of requirements) {
    if (!EVIDENCE_KINDS.has(requirement)) {
      throw new TypeError("Work task evidence requirement is invalid");
    }
  }
  return requirements;
}

function notifications(value) {
  object(value, "Work coordination notification preferences");
  const keys = [
    "approvalRequired",
    "taskBlocked",
    "workCompleted",
    "staleClaim",
    "conflictAvoided",
    "routineProgress",
  ];
  const normalized = {};
  for (const key of keys) {
    if (typeof value[key] !== "boolean") {
      throw new TypeError(`Work coordination notification preference ${key} must be boolean`);
    }
    normalized[key] = value[key];
  }
  return Object.freeze(normalized);
}

export function validateWorkCoordinationPolicy(value) {
  object(value, "Work coordination policy");
  schema(value, WORK_COORDINATION_POLICY_SCHEMA, "Work coordination policy");
  authorityNone(value, "Work coordination policy");
  if (!POLICY_SCOPES.has(value.scope)) {
    throw new TypeError("Work coordination policy scope is invalid");
  }
  if (!COORDINATION_MODES.has(value.mode)) {
    throw new TypeError("Work coordination mode is invalid");
  }
  if (value.userConfigured !== true) {
    throw new TypeError("Work coordination policy must be explicitly user configured");
  }
  if (value.backgroundExecution === true) {
    throw new TypeError("Work coordination policy cannot enable background execution");
  }
  const projectId = optionalText(value.projectId, "Work coordination project id", 240);
  if (value.scope === "project" && projectId === null) {
    throw new TypeError("Project-scoped Work coordination policy requires project id");
  }
  if (value.scope === "global" && projectId !== null) {
    throw new TypeError("Global Work coordination policy cannot target a project");
  }
  const automaticConfirmedAt = timestamp(
    value.automaticConfirmedAt,
    "Work coordination automaticConfirmedAt",
    true,
  );
  if (value.mode === "automatic" && automaticConfirmedAt === null) {
    throw new TypeError("Automatic Work coordination requires explicit confirmation timestamp");
  }
  if (value.mode !== "automatic" && automaticConfirmedAt !== null) {
    throw new TypeError("automaticConfirmedAt is only valid for automatic Work coordination");
  }

  return Object.freeze({
    schema: WORK_COORDINATION_POLICY_SCHEMA,
    scope: value.scope,
    projectId,
    mode: value.mode,
    userConfigured: true,
    notifications: notifications(value.notifications),
    backgroundExecution: false,
    authority: "none",
    configuredAt: timestamp(value.configuredAt, "Work coordination configuredAt"),
    automaticConfirmedAt,
  });
}

export function validateWorkPlan(value) {
  object(value, "Work plan");
  schema(value, WORK_PLAN_SCHEMA, "Work plan");
  authorityNone(value, "Work plan");
  if (!PLAN_STATES.has(value.state)) {
    throw new TypeError("Work plan state is invalid");
  }
  const normalizedOwner = owner(value.ownerKind, value.ownerId ?? null, "Work plan");
  const createdAt = timestamp(value.createdAt, "Work plan createdAt");
  const updatedAt = timestamp(value.updatedAt, "Work plan updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new TypeError("Work plan updatedAt cannot precede createdAt");
  }

  return Object.freeze({
    schema: WORK_PLAN_SCHEMA,
    revision: integer(value.revision, "Work plan revision", { min: 1 }),
    id: text(value.id, "Work plan id", 160),
    ...normalizedOwner,
    spaceId: optionalText(value.spaceId, "Work plan Space id", 160),
    projectId: optionalText(value.projectId, "Work plan project id", 240),
    workItemId: optionalText(value.workItemId, "Work plan Personal Work item id", 160),
    title: text(value.title, "Work plan title", 240),
    objective: text(value.objective, "Work plan objective", 4096),
    state: value.state,
    taskIds: uniqueTextArray(value.taskIds, "Work plan task ids", { maxItems: 512, maxChars: 160 }),
    authority: "none",
    createdAt,
    updatedAt,
  });
}

export function validateWorkTask(value) {
  object(value, "Work task");
  schema(value, WORK_TASK_SCHEMA, "Work task");
  authorityNone(value, "Work task");
  if (!TASK_STATES.has(value.state)) {
    throw new TypeError("Work task state is invalid");
  }

  const id = text(value.id, "Work task id", 160);
  const dependsOnTaskIds = uniqueTextArray(value.dependsOnTaskIds, "Work task dependencies", {
    maxItems: 64,
    maxChars: 160,
  });
  if (dependsOnTaskIds.includes(id)) {
    throw new TypeError("Work task cannot depend on itself");
  }
  const blockedReason = optionalText(value.blockedReason, "Work task blocked reason", 1024);
  if (value.state === "blocked" && blockedReason === null) {
    throw new TypeError("Blocked Work task requires a reason");
  }
  if (value.state !== "blocked" && blockedReason !== null) {
    throw new TypeError("Work task blocked reason is only valid while blocked");
  }

  const createdAt = timestamp(value.createdAt, "Work task createdAt");
  const updatedAt = timestamp(value.updatedAt, "Work task updatedAt");
  const completedAt = timestamp(value.completedAt, "Work task completedAt", true);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new TypeError("Work task updatedAt cannot precede createdAt");
  }
  if (value.state === "completed" && completedAt === null) {
    throw new TypeError("Completed Work task requires completedAt");
  }
  if (value.state !== "completed" && completedAt !== null) {
    throw new TypeError("Only completed Work task may carry completedAt");
  }
  if (completedAt !== null && Date.parse(completedAt) < Date.parse(createdAt)) {
    throw new TypeError("Work task completion cannot precede creation");
  }

  return Object.freeze({
    schema: WORK_TASK_SCHEMA,
    revision: integer(value.revision, "Work task revision", { min: 1 }),
    id,
    planId: text(value.planId, "Work task plan id", 160),
    title: text(value.title, "Work task title", 240),
    objective: text(value.objective, "Work task objective", 4096),
    state: value.state,
    dependsOnTaskIds,
    evidenceRequirements: evidenceRequirements(value.evidenceRequirements),
    blockedReason,
    authority: "none",
    createdAt,
    updatedAt,
    completedAt,
  });
}

export function validateWorkClaim(value) {
  object(value, "Work claim");
  schema(value, WORK_CLAIM_SCHEMA, "Work claim");
  authorityNone(value, "Work claim");
  if (!WORKER_KINDS.has(value.workerKind)) {
    throw new TypeError("Work claim worker kind is invalid");
  }

  const acquiredAt = timestamp(value.acquiredAt, "Work claim acquiredAt");
  const heartbeatAt = timestamp(value.heartbeatAt, "Work claim heartbeatAt");
  const expiresAt = timestamp(value.expiresAt, "Work claim expiresAt");
  const acquiredMs = Date.parse(acquiredAt);
  const heartbeatMs = Date.parse(heartbeatAt);
  const expiresMs = Date.parse(expiresAt);
  if (heartbeatMs < acquiredMs || expiresMs <= heartbeatMs) {
    throw new TypeError("Work claim lease timestamps are inconsistent");
  }
  if (expiresMs - heartbeatMs > WORK_COORDINATION_MAX_CLAIM_LEASE_MS) {
    throw new TypeError("Work claim lease exceeds maximum duration");
  }

  return Object.freeze({
    schema: WORK_CLAIM_SCHEMA,
    id: text(value.id, "Work claim id", 160),
    planId: text(value.planId, "Work claim plan id", 160),
    taskId: text(value.taskId, "Work claim task id", 160),
    planRevision: integer(value.planRevision, "Work claim plan revision", { min: 1 }),
    taskRevision: integer(value.taskRevision, "Work claim task revision", { min: 1 }),
    workerKind: value.workerKind,
    workerRef: text(value.workerRef, "Work claim worker ref", 240),
    clientRef: optionalText(value.clientRef, "Work claim client ref", 240),
    sessionRef: optionalText(value.sessionRef, "Work claim session ref", 240),
    leaseId: text(value.leaseId, "Work claim lease id", 160),
    acquiredAt,
    heartbeatAt,
    expiresAt,
    authority: "none",
  });
}

export function validateWorkCheckpoint(value) {
  object(value, "Work checkpoint");
  schema(value, WORK_CHECKPOINT_SCHEMA, "Work checkpoint");
  authorityNone(value, "Work checkpoint");

  return Object.freeze({
    schema: WORK_CHECKPOINT_SCHEMA,
    planId: text(value.planId, "Work checkpoint plan id", 160),
    taskId: text(value.taskId, "Work checkpoint task id", 160),
    taskRevision: integer(value.taskRevision, "Work checkpoint task revision", { min: 1 }),
    claimId: text(value.claimId, "Work checkpoint claim id", 160),
    leaseId: text(value.leaseId, "Work checkpoint lease id", 160),
    sequence: integer(value.sequence, "Work checkpoint sequence", { min: 1 }),
    summary: text(value.summary, "Work checkpoint summary", 2048),
    resumeRef: optionalText(value.resumeRef, "Work checkpoint resume ref", 512),
    artifactRefs: uniqueTextArray(value.artifactRefs, "Work checkpoint artifact refs", {
      maxItems: 32,
      maxChars: 512,
    }),
    authority: "none",
    createdAt: timestamp(value.createdAt, "Work checkpoint createdAt"),
  });
}

export function validateWorkEvidence(value) {
  object(value, "Work evidence");
  schema(value, WORK_EVIDENCE_SCHEMA, "Work evidence");
  authorityNone(value, "Work evidence");
  if (!EVIDENCE_KINDS.has(value.kind)) {
    throw new TypeError("Work evidence kind is invalid");
  }
  if (!EVIDENCE_VERIFICATION_STATES.has(value.verification)) {
    throw new TypeError("Work evidence verification state is invalid");
  }

  const observedAt = timestamp(value.observedAt, "Work evidence observedAt");
  const verifiedAt = timestamp(value.verifiedAt, "Work evidence verifiedAt", true);
  if (value.verification === "unverified" && verifiedAt !== null) {
    throw new TypeError("Unverified Work evidence cannot carry verifiedAt");
  }
  if (value.verification !== "unverified" && verifiedAt === null) {
    throw new TypeError("Verified or rejected Work evidence requires verifiedAt");
  }
  if (verifiedAt !== null && Date.parse(verifiedAt) < Date.parse(observedAt)) {
    throw new TypeError("Work evidence verification cannot precede observation");
  }

  const digestSha256 = optionalText(value.digestSha256, "Work evidence SHA-256", 64);
  if (digestSha256 !== null && !/^[0-9a-f]{64}$/.test(digestSha256)) {
    throw new TypeError("Work evidence SHA-256 is invalid");
  }

  return Object.freeze({
    schema: WORK_EVIDENCE_SCHEMA,
    id: text(value.id, "Work evidence id", 160),
    planId: text(value.planId, "Work evidence plan id", 160),
    taskId: text(value.taskId, "Work evidence task id", 160),
    taskRevision: integer(value.taskRevision, "Work evidence task revision", { min: 1 }),
    kind: value.kind,
    reference: text(value.reference, "Work evidence reference", 1024),
    summary: optionalText(value.summary, "Work evidence summary", 1024),
    digestSha256,
    verification: value.verification,
    producerRef: optionalText(value.producerRef, "Work evidence producer ref", 240),
    observedAt,
    verifiedAt,
    authority: "none",
  });
}
