import {
  BACKGROUND_STORE_SCHEMA,
  validateBackgroundRun,
} from "../../contracts/background-runtime.mjs";
import {
  SCHEDULER_STORE_SCHEMA,
  validateSchedule,
  validateScheduleOccurrence,
} from "../../contracts/scheduler.mjs";

export const AUTOMATION_STATE_ENDPOINT = "/__ordax/native/automation-state";
export const NATIVE_AUTOMATION_STATE_SCHEMA = "ordax.native-automation-state/1";
export const MAX_NATIVE_AUTOMATION_STATE_BYTES = (8 * 1024 * 1024) + 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const MAX_BACKGROUND_RUNS = 1024;
const MAX_SCHEDULES = 1024;
const MAX_PENDING_OCCURRENCES = 2048;

const encoder = new TextEncoder();

function boundedPositiveInteger(value, label, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requestTimeoutMs(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 300_000) {
    throw new TypeError("Native automation request timeout must be between 100 and 300000 milliseconds");
  }
  return value;
}

function declaredContentLength(response) {
  const raw = response?.headers?.get?.("content-length");
  if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function cancelResponseBody(response) {
  const body = response?.body;
  if (!body || typeof body.cancel !== "function") return;
  try {
    const cancellation = body.cancel();
    if (cancellation && typeof cancellation.catch === "function") void cancellation.catch(() => {});
  } catch {
    // The HTTP status already decides this mutation. Body cancellation failure
    // must not replace that decision.
  }
}

async function readBoundedJson(response) {
  const declared = declaredContentLength(response);
  if (declared !== null && declared > MAX_NATIVE_AUTOMATION_STATE_BYTES) {
    throw new Error("Native automation response exceeds its byte limit");
  }

  if (!response?.body || typeof response.body.getReader !== "function") {
    throw new Error("Native automation response does not expose a bounded stream");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!(value instanceof Uint8Array)) {
      try { await reader.cancel(); } catch {}
      throw new Error("Native automation response body is invalid");
    }
    total += value.byteLength;
    if (total > MAX_NATIVE_AUTOMATION_STATE_BYTES) {
      try { await reader.cancel(); } catch {}
      throw new Error("Native automation response exceeds its byte limit");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Native automation response is not valid UTF-8");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Native automation response is not valid JSON");
  }
}

async function fetchWithTimeout(fetchImpl, url, options, milliseconds, label, consume) {
  const controller = new AbortController();
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${milliseconds}ms`));
    }, milliseconds);
  });
  const operation = (async () => {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    return await consume(response);
  })();
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
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
  { requestTimeoutMs: requestedTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {},
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native automation stores require window.fetch");
  }
  const fetchImpl = windowRef.fetch.bind(windowRef);
  const requestTimeout = requestTimeoutMs(requestedTimeoutMs);

  const readState = async () => {
    return await fetchWithTimeout(
      fetchImpl,
      AUTOMATION_STATE_ENDPOINT,
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      },
      requestTimeout,
      "Native automation state load",
      async (response) => {
        if (!response.ok) {
          cancelResponseBody(response);
          throw new Error(`Native automation state unavailable: ${response.status}`);
        }
        return validateState(await readBoundedJson(response));
      },
    );
  };

  const mutate = async (request) => {
    const body = JSON.stringify(request);
    if (encoder.encode(body).byteLength > MAX_NATIVE_AUTOMATION_STATE_BYTES) {
      throw new Error("Native automation mutation exceeds its byte limit");
    }
    return await fetchWithTimeout(
      fetchImpl,
      AUTOMATION_STATE_ENDPOINT,
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body,
      },
      requestTimeout,
      "Native automation state mutation",
      async (response) => {
        if (response.status === 409) {
          cancelResponseBody(response);
          return false;
        }
        if (!response.ok) {
          cancelResponseBody(response);
          throw new Error(`Native automation mutation failed: ${response.status}`);
        }
        const result = await readBoundedJson(response);
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
