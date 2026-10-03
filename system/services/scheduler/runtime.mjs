import { randomUUID } from "node:crypto";

import {
  SCHEDULE_OCCURRENCE_SCHEMA,
  SCHEDULE_SCHEMA,
  SCHEDULER_SCHEMA,
  assertScheduleDispatch,
  assertSchedulerStore,
  validateSchedule,
  validateScheduleOccurrence,
} from "../../contracts/scheduler.mjs";

function epoch(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Scheduler clock must return epoch milliseconds");
  return value;
}

function iso(value) {
  return new Date(value).toISOString();
}

function id(value, label, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.trim();
}

function positiveLimit(value, label, max = 100) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new TypeError(`${label} is invalid`);
  return value;
}

function nextIntervalAfter(dueMs, nowMs, intervalMs) {
  const elapsed = Math.max(0, nowMs - dueMs);
  const skippedIntervals = Math.floor(elapsed / intervalMs) + 1;
  return dueMs + (skippedIntervals * intervalMs);
}

async function readSchedule(store, scheduleId) {
  const value = await store.getSchedule(id(scheduleId, "Schedule id"));
  return value == null ? null : validateSchedule(value);
}

export function createSchedulerRuntime({
  store: storeValue,
  dispatch: dispatchValue,
  now = Date.now,
  idFactory = randomUUID,
} = {}) {
  const store = assertSchedulerStore(storeValue);
  const dispatch = assertScheduleDispatch(dispatchValue);
  if (typeof now !== "function" || typeof idFactory !== "function") throw new TypeError("Scheduler requires clock and id factory");

  return Object.freeze({
    schema: SCHEDULER_SCHEMA,

    async createSchedule({
      consumerId,
      subjectId,
      ownerKind,
      ownerId = null,
      spaceId = null,
      projectId = null,
      timezone,
      recurrence,
      firstRunAt,
      maxRuns = 1,
      deduplicationKey,
    }) {
      const at = epoch(now);
      const schedule = validateSchedule({
        schema: SCHEDULE_SCHEMA,
        revision: 1,
        scheduleId: id(idFactory(), "Generated schedule id"),
        consumerId,
        subjectId,
        ownerKind,
        ownerId,
        spaceId,
        projectId,
        timezone,
        recurrence,
        nextRunAt: firstRunAt,
        lastRunAt: null,
        maxRuns,
        runCount: 0,
        enabled: true,
        deduplicationKey,
        createdAt: iso(at),
        authority: "none",
      });
      if (await store.createSchedule(schedule) !== true) throw new Error("Scheduler store refused schedule creation");
      return schedule;
    },

    async getSchedule(scheduleId) {
      return await readSchedule(store, scheduleId);
    },

    async disable(scheduleId) {
      const current = await readSchedule(store, scheduleId);
      if (current === null) throw new Error("Schedule was not found");
      if (!current.enabled) return current;
      const next = validateSchedule({
        ...current,
        revision: current.revision + 1,
        enabled: false,
        nextRunAt: null,
      });
      if (await store.compareAndSwapSchedule(current.scheduleId, current.revision, next) !== true) {
        throw new Error("Schedule changed concurrently");
      }
      return next;
    },

    async materializeDue({ limit = 32 } = {}) {
      const at = epoch(now);
      const boundedLimit = positiveLimit(limit, "Scheduler materialize limit");
      const candidates = await store.listDueSchedules(iso(at), boundedLimit);
      if (!Array.isArray(candidates) || candidates.length > boundedLimit) {
        throw new Error("Scheduler due set is invalid or unbounded");
      }
      const created = [];

      for (const raw of candidates) {
        const current = validateSchedule(raw);
        if (!current.enabled || current.nextRunAt === null || Date.parse(current.nextRunAt) > at) continue;

        const sequence = current.runCount + 1;
        const dueAt = current.nextRunAt;
        const occurrence = validateScheduleOccurrence({
          schema: SCHEDULE_OCCURRENCE_SCHEMA,
          occurrenceId: id(idFactory(), "Generated occurrence id", 256),
          scheduleId: current.scheduleId,
          consumerId: current.consumerId,
          subjectId: current.subjectId,
          sequence,
          dueAt,
          createdAt: iso(at),
          deduplicationKey: `${current.deduplicationKey}:${sequence}:${dueAt}`,
          authority: "none",
        });

        const exhausted = sequence >= current.maxRuns || current.recurrence.kind === "once";
        const nextRunAt = exhausted
          ? null
          : iso(nextIntervalAfter(Date.parse(dueAt), at, current.recurrence.intervalMs));
        const next = validateSchedule({
          ...current,
          revision: current.revision + 1,
          runCount: sequence,
          lastRunAt: dueAt,
          enabled: !exhausted,
          nextRunAt,
        });

        if (await store.commitOccurrence(current.scheduleId, current.revision, next, occurrence) === true) {
          created.push(occurrence);
        }
      }
      return Object.freeze(created);
    },

    async deliverPending({ limit = 32 } = {}) {
      const boundedLimit = positiveLimit(limit, "Scheduler delivery limit");
      const pending = await store.listPendingOccurrences(boundedLimit);
      if (!Array.isArray(pending) || pending.length > boundedLimit) {
        throw new Error("Scheduler pending occurrence set is invalid or unbounded");
      }
      const delivered = [];
      for (const raw of pending) {
        const occurrence = validateScheduleOccurrence(raw);
        let accepted = false;
        try {
          accepted = await dispatch.enqueue(occurrence) === true;
        } catch {
          accepted = false;
        }
        if (!accepted) continue;
        if (await store.ackOccurrence(occurrence.occurrenceId) === true) delivered.push(occurrence);
      }
      return Object.freeze(delivered);
    },
  });
}
