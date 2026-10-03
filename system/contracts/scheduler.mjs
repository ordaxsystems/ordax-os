export const SCHEDULER_SCHEMA = "ordax.scheduler/1";
export const SCHEDULER_STORE_SCHEMA = "ordax.scheduler-store/1";
export const SCHEDULE_SCHEMA = "ordax.schedule/1";
export const SCHEDULE_OCCURRENCE_SCHEMA = "ordax.schedule-occurrence/1";
export const SCHEDULE_DISPATCH_SCHEMA = "ordax.schedule-dispatch/1";

const OWNER_KINDS = new Set(["device", "account"]);
const RECURRENCE_KINDS = new Set(["once", "fixed-interval"]);

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

function validateTimezone(value) {
  const timezone = text(value, "Schedule timezone", 96);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new TypeError("Schedule timezone is invalid");
  }
  return timezone;
}

function validateRecurrence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !RECURRENCE_KINDS.has(value.kind)) {
    throw new TypeError("Schedule recurrence is invalid");
  }
  if (value.kind === "once") return Object.freeze({ kind: "once", intervalMs: null });
  return Object.freeze({
    kind: "fixed-interval",
    intervalMs: integer(value.intervalMs, "Schedule interval", { min: 60_000, max: 2_592_000_000 }),
  });
}

function validateOwner(ownerKind, ownerId) {
  if (!OWNER_KINDS.has(ownerKind)) throw new TypeError("Schedule owner kind is invalid");
  if (ownerKind === "device") {
    if (ownerId != null) throw new TypeError("Device schedule must not have synthetic owner id");
    return { ownerKind, ownerId: null };
  }
  return { ownerKind, ownerId: text(ownerId, "Schedule owner id", 160) };
}

export function validateSchedule(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== SCHEDULE_SCHEMA) {
    throw new TypeError("Schedule is incompatible");
  }
  if (value.authority !== "none") throw new TypeError("Schedule cannot carry action authority");
  const normalizedOwner = validateOwner(value.ownerKind, value.ownerId ?? null);
  const recurrence = validateRecurrence(value.recurrence);
  const maxRuns = integer(value.maxRuns, "Schedule max runs", { min: 1, max: 1_000_000 });
  const runCount = integer(value.runCount, "Schedule run count", { max: maxRuns });
  const enabled = value.enabled === true;
  if (enabled && runCount >= maxRuns) throw new TypeError("Exhausted schedule cannot remain enabled");

  return Object.freeze({
    schema: SCHEDULE_SCHEMA,
    revision: integer(value.revision, "Schedule revision", { min: 1 }),
    scheduleId: text(value.scheduleId, "Schedule id", 160),
    consumerId: text(value.consumerId, "Schedule consumer id", 160),
    subjectId: text(value.subjectId, "Schedule subject id", 160),
    ...normalizedOwner,
    spaceId: optionalText(value.spaceId, "Schedule Space id", 160),
    projectId: optionalText(value.projectId, "Schedule project id", 160),
    timezone: validateTimezone(value.timezone),
    recurrence,
    nextRunAt: timestamp(value.nextRunAt, "Schedule nextRunAt", !enabled),
    lastRunAt: timestamp(value.lastRunAt, "Schedule lastRunAt", true),
    maxRuns,
    runCount,
    enabled,
    deduplicationKey: text(value.deduplicationKey, "Schedule deduplication key", 160),
    createdAt: timestamp(value.createdAt, "Schedule createdAt"),
    authority: "none",
  });
}

export function validateScheduleOccurrence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== SCHEDULE_OCCURRENCE_SCHEMA) {
    throw new TypeError("Schedule occurrence is incompatible");
  }
  if (value.authority !== "none") throw new TypeError("Schedule occurrence cannot carry action authority");
  return Object.freeze({
    schema: SCHEDULE_OCCURRENCE_SCHEMA,
    occurrenceId: text(value.occurrenceId, "Schedule occurrence id", 256),
    scheduleId: text(value.scheduleId, "Schedule occurrence schedule id", 160),
    consumerId: text(value.consumerId, "Schedule occurrence consumer id", 160),
    subjectId: text(value.subjectId, "Schedule occurrence subject id", 160),
    sequence: integer(value.sequence, "Schedule occurrence sequence", { min: 1 }),
    dueAt: timestamp(value.dueAt, "Schedule occurrence dueAt"),
    createdAt: timestamp(value.createdAt, "Schedule occurrence createdAt"),
    deduplicationKey: text(value.deduplicationKey, "Schedule occurrence deduplication key", 256),
    authority: "none",
  });
}

export function assertSchedulerStore(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== SCHEDULER_STORE_SCHEMA
    || typeof value.createSchedule !== "function"
    || typeof value.getSchedule !== "function"
    || typeof value.listDueSchedules !== "function"
    || typeof value.commitOccurrence !== "function"
    || typeof value.listPendingOccurrences !== "function"
    || typeof value.ackOccurrence !== "function"
  ) throw new TypeError("A compatible durable Scheduler store is required");
  return value;
}

export function assertScheduleDispatch(value) {
  if (!value || typeof value !== "object" || value.schema !== SCHEDULE_DISPATCH_SCHEMA || typeof value.enqueue !== "function") {
    throw new TypeError("A compatible Schedule dispatch port is required");
  }
  return value;
}
