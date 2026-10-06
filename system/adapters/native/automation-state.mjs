import {
  BACKGROUND_STORE_SCHEMA,
  validateBackgroundRun,
} from "../../contracts/background-runtime.mjs";
import {
  SCHEDULER_STORE_SCHEMA,
  validateSchedule,
  validateScheduleOccurrence,
} from "../../contracts/scheduler.mjs";
import {
  createNativeBoundedJsonTransport,
  DEFAULT_NATIVE_JSON_REQUEST_TIMEOUT_MS,
} from "./bounded-json-transport.mjs";

export const AUTOMATION_STATE_ENDPOINT = "/__ordax/native/automation-state";
export const NATIVE_AUTOMATION_STATE_SCHEMA = "ordax.native-automation-state/1";
export const MAX_NATIVE_AUTOMATION_STATE_BYTES = (8 * 1024 * 1024) + 1024;
const MAX_BACKGROUND_RUNS = 1024;
const MAX_SCHEDULES = 1024;
const MAX_PENDING_OCCURRENCES = 2048;

function boundedPositiveInteger(value, label, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function validateMap(value, label, maxEntries, validateEntry, bindingKey) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const entries = Object.entries(value);
  if (entries.length > maxEntries) throw new TypeError(`${label} exceeds its entry limit`);
  const result = new Map();
  for (const [key, raw] of entries) {
    const validated = validateEntry(raw);
    if (validated[bindingKey] !== key) throw new TypeError(`${label} key binding mismatch`);
    result.set(key, validated);
  }
  return result;
}

function validateState(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length !== 5
    || value.$schema !== NATIVE_AUTOMATION_STATE_SCHEMA
    || !Number.isSafeInteger(value.generation)
    || value.generation < 0
  ) {
    throw new TypeError("Native automation state shape is invalid");
  }
  const backgroundRuns = validateMap(
    value.backgroundRuns,
    "Native automation backgroundRuns",
    MAX_BACKGROUND_RUNS,
    validateBackgroundRun,
    "runId",
  );
  const schedules = validateMap(
    value.schedules,
    "Native automation schedules",
    MAX_SCHEDULES,
    validateSchedule,
    "scheduleId",
  );
  const pendingOccurrences = validateMap(
    value.pendingOccurrences,
    "Native automation pendingOccurrences",
    MAX_PENDING_OCCURRENCES,
    validateScheduleOccurrence,
    "occurrenceId",
  );
  return Object.freeze({
    generation: value.generation,
    backgroundRuns,
    schedules,
    pendingOccurrences,
  });
}

export async function createNativeAutomationStores(
  windowRef = globalThis.window,
  { requestTimeoutMs = DEFAULT_NATIVE_JSON_REQUEST_TIMEOUT_MS } = {},
) {
  const transport = createNativeBoundedJsonTransport(windowRef, {
    maxResponseBytes: MAX_NATIVE_AUTOMATION_STATE_BYTES,
    maxRequestBytes: MAX_NATIVE_AUTOMATION_STATE_BYTES,
    requestTimeoutMs,
    label: "Native automation",
  });

  const readState = async () => {
    return await transport.request(
      AUTOMATION_STATE_ENDPOINT,
      { method: "GET", operation: "state load" },
      async (response) => {
        if (!response.ok) {
          transport.cancel(response);
          throw new Error(`Native automation state unavailable: ${response.status}`);
        }
        return validateState(await transport.readJson(response));
      },
    );
  };

  const mutate = async (requestValue) => {
    const body = JSON.stringify(requestValue);
    return await transport.request(
      AUTOMATION_STATE_ENDPOINT,
      {
        method: "POST",
        operation: "state mutation",
        headers: { "Content-Type": "application/json" },
        body,
      },
      async (response) => {
        if (response.status === 409) {
          transport.cancel(response);
          return false;
        }
        if (!response.ok) {
          transport.cancel(response);
          throw new Error(`Native automation mutation failed: ${response.status}`);
        }
        const result = await transport.readJson(response);
        if (
          !result
          || typeof result !== "object"
          || Array.isArray(result)
          || Object.keys(result).length !== 1
          || result.ok !== true
        ) {
          throw new Error("Native automation mutation response shape is invalid");
        }
        return true;
      },
    );
  };

  // Probe and validate the durable owner before exposing either store.
  await readState();

  const backgroundStore = Object.freeze({
    schema: BACKGROUND_STORE_SCHEMA,
    async create(runValue) {
      const run = validateBackgroundRun(runValue);
      return await mutate({ action: "background-create", run });
    },
    async get(runId) {
      const state = await readState();
      return state.backgroundRuns.get(runId) ?? null;
    },
    async compareAndSwap(runId, expectedRevision, nextValue) {
      const run = validateBackgroundRun(nextValue);
      if (run.runId !== runId) throw new TypeError("Background CAS run binding mismatch");
      return await mutate({
        action: "background-cas",
        runId,
        expectedRevision,
        run,
      });
    },
    async listRecoverable() {
      const state = await readState();
      return Object.freeze(
        [...state.backgroundRuns.values()]
          .filter((run) => !["completed", "failed", "cancelled"].includes(run.state)),
      );
    },
  });

  const schedulerStore = Object.freeze({
    schema: SCHEDULER_STORE_SCHEMA,
    async createSchedule(scheduleValue) {
      const schedule = validateSchedule(scheduleValue);
      return await mutate({ action: "schedule-create", schedule });
    },
    async getSchedule(scheduleId) {
      const state = await readState();
      return state.schedules.get(scheduleId) ?? null;
    },
    async compareAndSwapSchedule(scheduleId, expectedRevision, nextValue) {
      const schedule = validateSchedule(nextValue);
      if (schedule.scheduleId !== scheduleId) throw new TypeError("Schedule CAS binding mismatch");
      return await mutate({
        action: "schedule-cas",
        scheduleId,
        expectedRevision,
        schedule,
      });
    },
    async listDueSchedules(nowIso, limit) {
      const boundedLimit = boundedPositiveInteger(limit, "Scheduler due limit", 100);
      const now = Date.parse(nowIso);
      if (!Number.isFinite(now)) throw new TypeError("Scheduler due timestamp is invalid");
      const state = await readState();
      return Object.freeze(
        [...state.schedules.values()]
          .filter((schedule) => schedule.enabled && schedule.nextRunAt !== null && Date.parse(schedule.nextRunAt) <= now)
          .sort((left, right) => (
            Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt)
            || left.scheduleId.localeCompare(right.scheduleId)
          ))
          .slice(0, boundedLimit),
      );
    },
    async commitOccurrence(scheduleId, expectedRevision, nextScheduleValue, occurrenceValue) {
      const schedule = validateSchedule(nextScheduleValue);
      const occurrence = validateScheduleOccurrence(occurrenceValue);
      if (schedule.scheduleId !== scheduleId || occurrence.scheduleId !== scheduleId) {
        throw new TypeError("Schedule occurrence commit binding mismatch");
      }
      return await mutate({
        action: "schedule-commit-occurrence",
        scheduleId,
        expectedRevision,
        schedule,
        occurrence,
      });
    },
    async listPendingOccurrences(limit) {
      const boundedLimit = boundedPositiveInteger(limit, "Scheduler pending limit", 100);
      const state = await readState();
      return Object.freeze(
        [...state.pendingOccurrences.values()]
          .sort((left, right) => (
            Date.parse(left.createdAt) - Date.parse(right.createdAt)
            || left.occurrenceId.localeCompare(right.occurrenceId)
          ))
          .slice(0, boundedLimit),
      );
    },
    async ackOccurrence(occurrenceId) {
      return await mutate({ action: "occurrence-ack", occurrenceId });
    },
  });

  return Object.freeze({ backgroundStore, schedulerStore });
}
