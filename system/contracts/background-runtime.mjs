export const BACKGROUND_RUNTIME_SCHEMA = "ordax.background-runtime/1";
export const BACKGROUND_STORE_SCHEMA = "ordax.background-store/1";
export const BACKGROUND_RUN_SCHEMA = "ordax.background-run/1";
export const BACKGROUND_CHECKPOINT_SCHEMA = "ordax.background-checkpoint/1";

const OWNER_KINDS = new Set(["device", "account"]);
const STATES = new Set(["queued", "running", "paused", "cancelled", "completed", "failed"]);

function text(value, label, max = 256) {
  if (typeof value !== "string" || value.includes("\0")) throw new TypeError(`${label} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new TypeError(`${label} is outside bounds`);
  return normalized;
}

function optionalText(value, label, max = 256) {
  return value == null || value === "" ? null : text(value, label, max);
}

function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${label} is outside bounds`);
  return value;
}

function timestamp(value, label, nullable = false) {
  if (value == null && nullable) return null;
  const normalized = text(value, label, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  return new Date(Date.parse(normalized)).toISOString();
}

function owner(ownerKind, ownerId) {
  if (!OWNER_KINDS.has(ownerKind)) throw new TypeError("Background owner kind is invalid");
  if (ownerKind === "device") {
    if (ownerId != null) throw new TypeError("Device background owner must not use synthetic owner id");
    return { ownerKind, ownerId: null };
  }
  return { ownerKind, ownerId: text(ownerId, "Background owner id", 160) };
}

export function validateBackgroundBudgets(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Background budgets must be an object");
  return Object.freeze({
    wallClockMs: integer(value.wallClockMs, "Background wall-clock budget", { min: 1000, max: 86_400_000 }),
    stepLimit: integer(value.stepLimit, "Background step budget", { min: 1, max: 10_000 }),
    actionLimit: integer(value.actionLimit, "Background action budget", { max: 1_000 }),
    egressBytesLimit: integer(value.egressBytesLimit, "Background egress budget", { max: 1_073_741_824 }),
  });
}

export function validateBackgroundUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Background usage must be an object");
  return Object.freeze({
    steps: integer(value.steps, "Background used steps", { max: 10_000 }),
    actions: integer(value.actions, "Background used actions", { max: 1_000 }),
    egressBytes: integer(value.egressBytes, "Background used egress bytes", { max: 1_073_741_824 }),
  });
}

export function validateBackgroundCheckpoint(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== BACKGROUND_CHECKPOINT_SCHEMA) {
    throw new TypeError("Background checkpoint is incompatible");
  }
  return Object.freeze({
    schema: BACKGROUND_CHECKPOINT_SCHEMA,
    sequence: integer(value.sequence, "Background checkpoint sequence", { min: 1 }),
    cursor: optionalText(value.cursor, "Background checkpoint cursor", 512),
    digest: text(value.digest, "Background checkpoint digest", 128),
    createdAt: timestamp(value.createdAt, "Background checkpoint createdAt"),
  });
}

function lease(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Background lease must be an object");
  const acquiredAt = timestamp(value.acquiredAt, "Background lease acquiredAt");
  const heartbeatAt = timestamp(value.heartbeatAt, "Background lease heartbeatAt");
  const expiresAt = timestamp(value.expiresAt, "Background lease expiresAt");
  if (Date.parse(heartbeatAt) < Date.parse(acquiredAt) || Date.parse(expiresAt) <= Date.parse(heartbeatAt)) {
    throw new TypeError("Background lease timestamps are inconsistent");
  }
  return Object.freeze({
    leaseId: text(value.leaseId, "Background lease id", 160),
    workerId: text(value.workerId, "Background worker id", 160),
    acquiredAt,
    heartbeatAt,
    expiresAt,
  });
}

export function validateBackgroundRun(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== BACKGROUND_RUN_SCHEMA) {
    throw new TypeError("Background run is incompatible");
  }
  if (!STATES.has(value.state)) throw new TypeError("Background run state is invalid");
  if (value.authority !== "none") throw new TypeError("Background run cannot carry action authority");

  const normalizedOwner = owner(value.ownerKind, value.ownerId ?? null);
  const budgets = validateBackgroundBudgets(value.budgets);
  const usage = validateBackgroundUsage(value.usage);
  if (usage.steps > budgets.stepLimit || usage.actions > budgets.actionLimit || usage.egressBytes > budgets.egressBytesLimit) {
    throw new TypeError("Background run usage exceeds declared budget");
  }
  const normalizedLease = lease(value.lease);
  if ((value.state === "running") !== (normalizedLease !== null)) throw new TypeError("Background lease must exist only while running");

  const createdAt = timestamp(value.createdAt, "Background run createdAt");
  const deadlineAt = timestamp(value.deadlineAt, "Background run deadlineAt");
  if (Date.parse(deadlineAt) <= Date.parse(createdAt)) throw new TypeError("Background deadline must follow creation");

  return Object.freeze({
    schema: BACKGROUND_RUN_SCHEMA,
    revision: integer(value.revision, "Background run revision", { min: 1 }),
    runId: text(value.runId, "Background run id", 160),
    consumerId: text(value.consumerId, "Background consumer id", 160),
    subjectId: text(value.subjectId, "Background subject id", 160),
    ...normalizedOwner,
    spaceId: optionalText(value.spaceId, "Background Space id", 160),
    projectId: optionalText(value.projectId, "Background project id", 160),
    state: value.state,
    budgets,
    usage,
    createdAt,
    startedAt: timestamp(value.startedAt, "Background run startedAt", true),
    deadlineAt,
    lease: normalizedLease,
    checkpoint: validateBackgroundCheckpoint(value.checkpoint),
    cancelRequestedAt: timestamp(value.cancelRequestedAt, "Background cancelRequestedAt", true),
    finishedAt: timestamp(value.finishedAt, "Background finishedAt", true),
    failureCode: optionalText(value.failureCode, "Background failure code", 160),
    authority: "none",
  });
}

export function assertBackgroundStore(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== BACKGROUND_STORE_SCHEMA
    || typeof value.create !== "function"
    || typeof value.get !== "function"
    || typeof value.compareAndSwap !== "function"
    || typeof value.listRecoverable !== "function"
  ) throw new TypeError("A compatible atomic durable Background store is required");
  return value;
}
