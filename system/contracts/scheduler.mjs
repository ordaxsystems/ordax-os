export const SCHEDULE_SCHEMA = "ordax.schedule/1";
export const SCHEDULE_WAKE_INTENT_SCHEMA = "ordax.schedule-wake-intent/1";
export const SCHEDULER_SNAPSHOT_SCHEMA = "ordax.scheduler-snapshot/1";

const OWNER_KINDS = new Set(["device", "account"]);
const MISSED_POLICIES = new Set(["run-once", "skip"]);

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

function normalizeOwner(value) {
  const ownerKind = text(value.ownerKind, "Schedule owner kind", 16);
  if (!OWNER_KINDS.has(ownerKind)) throw new TypeError("Schedule owner kind is invalid");
  const ownerId = ownerKind === "account" ? text(value.ownerId, "Schedule owner id", 160) : null;
  if (ownerKind === "device" && value.ownerId !== null && value.ownerId !== undefined) {
    throw new TypeError("Device-owned schedule must not carry an account owner id");
  }
  return { ownerKind, ownerId };
}

function normalizeTrigger(value) {
  const source = object(value, "Schedule trigger");
  if (source.kind === "once") {
    return Object.freeze({ kind: "once", at: timestamp(source.at, "Schedule trigger timestamp") });
  }
  if (source.kind === "interval") {
    return Object.freeze({
      kind: "interval",
      anchorAt: timestamp(source.anchorAt, "Schedule interval anchor"),
      intervalMs: integer(source.intervalMs, "Schedule interval", 60_000, 2_592_000_000),
    });
  }
  throw new TypeError("Schedule trigger kind is invalid");
}

export function validateSchedule(value) {
  const source = object(value, "Schedule");
  if (source.schema !== SCHEDULE_SCHEMA) throw new TypeError("Schedule schema is invalid");
  const trigger = normalizeTrigger(source.trigger);
  if (!MISSED_POLICIES.has(source.missedRunPolicy)) throw new TypeError("Schedule missed-run policy is invalid");
  if (trigger.kind === "once" && source.missedRunPolicy !== "run-once") {
    throw new TypeError("One-shot schedules must use run-once missed-run policy");
  }
  const maxRuns = integer(source.maxRuns, "Schedule max runs", 1, 1_000_000);
  const runCount = integer(source.runCount ?? 0, "Schedule run count", 0, 1_000_000);
  if (runCount > maxRuns) throw new TypeError("Schedule run count cannot exceed max runs");
  const nextRunAt = optionalTimestamp(source.nextRunAt, "Schedule next run timestamp");
  const enabled = source.enabled === true;
  if (runCount === maxRuns && (enabled || nextRunAt !== null)) {
    throw new TypeError("Exhausted schedule must be disabled and have no next run");
  }
  return Object.freeze({
    schema: SCHEDULE_SCHEMA,
    scheduleId: text(source.scheduleId, "Schedule id", 160),
    ...normalizeOwner(source),
    workItemId: text(source.workItemId, "Schedule work item id", 160),
    enabled,
    timezone: text(source.timezone, "Schedule timezone", 128),
    trigger,
    missedRunPolicy: source.missedRunPolicy,
    maxRuns,
    runCount,
    nextRunAt,
    deduplicationKey: text(source.deduplicationKey, "Schedule deduplication key", 160),
    authority: "none",
  });
}

export function validateScheduleWakeIntent(value) {
  const source = object(value, "Schedule wake intent");
  if (source.schema !== SCHEDULE_WAKE_INTENT_SCHEMA) throw new TypeError("Schedule wake intent schema is invalid");
  return Object.freeze({
    schema: SCHEDULE_WAKE_INTENT_SCHEMA,
    scheduleId: text(source.scheduleId, "Wake schedule id", 160),
    ...normalizeOwner(source),
    workItemId: text(source.workItemId, "Wake work item id", 160),
    scheduledFor: timestamp(source.scheduledFor, "Wake scheduled timestamp"),
    claimedAt: timestamp(source.claimedAt, "Wake claimed timestamp"),
    fireOrdinal: integer(source.fireOrdinal, "Wake ordinal", 1, 1_000_000),
    deduplicationKey: text(source.deduplicationKey, "Wake deduplication key", 200),
    authority: "none",
    backgroundAuthorized: false,
    approvalAuthorized: false,
    executionAuthorized: false,
  });
}

export function validateSchedulerSnapshot(value) {
  const source = object(value, "Scheduler snapshot");
  if (source.schema !== SCHEDULER_SNAPSHOT_SCHEMA) throw new TypeError("Scheduler snapshot schema is invalid");
  if (!Array.isArray(source.schedules) || source.schedules.length > 1_024) {
    throw new TypeError("Scheduler snapshot schedules are invalid");
  }
  return Object.freeze({
    schema: SCHEDULER_SNAPSHOT_SCHEMA,
    schedules: Object.freeze(source.schedules.map(validateSchedule)),
    authority: "none",
  });
}
