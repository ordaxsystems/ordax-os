export const BACKGROUND_POLICY_SCHEMA = "ordax.background-policy/1";
export const BACKGROUND_RUN_SCHEMA = "ordax.background-run/1";
export const BACKGROUND_CHECKPOINT_SCHEMA = "ordax.background-checkpoint/1";
export const BACKGROUND_SNAPSHOT_SCHEMA = "ordax.background-snapshot/1";
export const BACKGROUND_EFFECT_DECISION_SCHEMA = "ordax.background-effect-decision/1";

const OWNER_KINDS = new Set(["device", "account"]);
const EFFECTS = new Set(["read", "write", "external-egress", "device-control"]);
const RUN_STATES = new Set(["active", "paused", "completed", "cancelled", "failed", "exhausted"]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function text(value, label, max = 240) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > max || value.includes("\0")) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function optionalText(value, label, max = 240) {
  return value === null || value === undefined ? null : text(value, label, max);
}

function timestamp(value, label) {
  const normalized = text(value, label, 64);
  if (Number.isNaN(Date.parse(normalized))) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function optionalTimestamp(value, label) {
  return value === null || value === undefined ? null : timestamp(value, label);
}

function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${label} is invalid`);
  return value;
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported field: ${key}`);
  }
}

function normalizeOwner(value) {
  const ownerKind = text(value.ownerKind, "Background owner kind", 16);
  if (!OWNER_KINDS.has(ownerKind)) throw new TypeError("Background owner kind is invalid");
  const ownerId = ownerKind === "account" ? text(value.ownerId, "Background owner id", 160) : null;
  if (ownerKind === "device" && value.ownerId !== null && value.ownerId !== undefined) {
    throw new TypeError("Device-owned background work must not carry an account owner id");
  }
  return { ownerKind, ownerId };
}

function normalizeUsage(value) {
  const source = object(value, "Background usage");
  exactKeys(source, new Set(["steps", "actions", "egressBytes"]), "Background usage");
  return Object.freeze({
    steps: integer(source.steps, "Background steps used", 0, 1_000_000),
    actions: integer(source.actions, "Background actions used", 0, 1_000_000),
    egressBytes: integer(source.egressBytes, "Background egress bytes used", 0, Number.MAX_SAFE_INTEGER),
  });
}

export function validateBackgroundPolicy(value) {
  const source = object(value, "Background policy");
  exactKeys(source, new Set([
    "schema", "policyId", "ownerKind", "ownerId", "workItemId", "mode",
    "allowedEffects", "limits", "restorePolicy",
  ]), "Background policy");
  if (source.schema !== BACKGROUND_POLICY_SCHEMA) throw new TypeError("Background policy schema is invalid");
  if (source.mode !== "read-only") throw new TypeError("Only read-only background mode is enabled");
  if (!Array.isArray(source.allowedEffects) || source.allowedEffects.length !== 1 || source.allowedEffects[0] !== "read") {
    throw new TypeError("Background policy must be read-only");
  }
  const limits = object(source.limits, "Background limits");
  exactKeys(limits, new Set(["maxWallClockMs", "maxSteps", "maxActions", "maxEgressBytes", "leaseMs"]), "Background limits");
  if (limits.maxActions !== 0 || limits.maxEgressBytes !== 0) {
    throw new TypeError("Read-only background policy cannot allocate action or egress budget");
  }
  if (source.restorePolicy !== "pause") throw new TypeError("Background restore policy must pause");
  return Object.freeze({
    schema: BACKGROUND_POLICY_SCHEMA,
    policyId: text(source.policyId, "Background policy id", 160),
    ...normalizeOwner(source),
    workItemId: text(source.workItemId, "Background work item id", 160),
    mode: "read-only",
    allowedEffects: Object.freeze(["read"]),
    limits: Object.freeze({
      maxWallClockMs: integer(limits.maxWallClockMs, "Background wall-clock budget", 1_000, 21_600_000),
      maxSteps: integer(limits.maxSteps, "Background step budget", 1, 10_000),
      maxActions: 0,
      maxEgressBytes: 0,
      leaseMs: integer(limits.leaseMs, "Background lease duration", 1_000, 900_000),
    }),
    restorePolicy: "pause",
    authority: "none",
    executionAuthorized: false,
  });
}

export function validateBackgroundRun(value) {
  const source = object(value, "Background run");
  if (source.schema !== BACKGROUND_RUN_SCHEMA) throw new TypeError("Background run schema is invalid");
  if (!RUN_STATES.has(source.state)) throw new TypeError("Background run state is invalid");
  return Object.freeze({
    schema: BACKGROUND_RUN_SCHEMA,
    runId: text(source.runId, "Background run id", 160),
    policyId: text(source.policyId, "Background policy id", 160),
    ...normalizeOwner(source),
    workItemId: text(source.workItemId, "Background work item id", 160),
    state: source.state,
    startedAt: timestamp(source.startedAt, "Background started timestamp"),
    updatedAt: timestamp(source.updatedAt, "Background updated timestamp"),
    deadlineAt: timestamp(source.deadlineAt, "Background deadline timestamp"),
    leaseExpiresAt: optionalTimestamp(source.leaseExpiresAt, "Background lease expiry"),
    usage: normalizeUsage(source.usage),
    checkpointRevision: integer(source.checkpointRevision, "Background checkpoint revision", 0, 1_000_000),
    recoveryRequired: source.recoveryRequired === true,
    terminalReason: optionalText(source.terminalReason, "Background terminal reason", 160),
    authority: "none",
    executionAuthorized: false,
  });
}

export function validateBackgroundCheckpoint(value) {
  const source = object(value, "Background checkpoint");
  if (source.schema !== BACKGROUND_CHECKPOINT_SCHEMA) throw new TypeError("Background checkpoint schema is invalid");
  return Object.freeze({
    schema: BACKGROUND_CHECKPOINT_SCHEMA,
    runId: text(source.runId, "Background checkpoint run id", 160),
    workItemId: text(source.workItemId, "Background checkpoint work item id", 160),
    revision: integer(source.revision, "Background checkpoint revision", 1, 1_000_000),
    createdAt: timestamp(source.createdAt, "Background checkpoint timestamp"),
    cursor: optionalText(source.cursor, "Background checkpoint cursor", 160),
    summary: optionalText(source.summary, "Background checkpoint summary", 320),
    authority: "none",
  });
}

export function validateBackgroundSnapshot(value) {
  const source = object(value, "Background snapshot");
  if (source.schema !== BACKGROUND_SNAPSHOT_SCHEMA) throw new TypeError("Background snapshot schema is invalid");
  if (!Array.isArray(source.runs) || source.runs.length > 256) throw new TypeError("Background snapshot runs are invalid");
  if (!Array.isArray(source.checkpoints) || source.checkpoints.length > 256) throw new TypeError("Background snapshot checkpoints are invalid");
  return Object.freeze({
    schema: BACKGROUND_SNAPSHOT_SCHEMA,
    runs: Object.freeze(source.runs.map(validateBackgroundRun)),
    checkpoints: Object.freeze(source.checkpoints.map(validateBackgroundCheckpoint)),
    authority: "none",
  });
}

export function validateBackgroundEffectDecision(value) {
  const source = object(value, "Background effect decision");
  if (source.schema !== BACKGROUND_EFFECT_DECISION_SCHEMA) throw new TypeError("Background effect decision schema is invalid");
  if (!EFFECTS.has(source.effect)) throw new TypeError("Background effect is invalid");
  if (typeof source.allowed !== "boolean") throw new TypeError("Background effect decision must be boolean");
  return Object.freeze({
    schema: BACKGROUND_EFFECT_DECISION_SCHEMA,
    runId: text(source.runId, "Background effect run id", 160),
    effect: source.effect,
    allowed: source.allowed,
    reasonCode: text(source.reasonCode, "Background effect reason", 160),
    authority: "none",
    executionAuthorized: false,
  });
}
