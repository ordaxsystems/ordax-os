import {
  SCHEDULE_WAKE_INTENT_SCHEMA,
  SCHEDULER_SNAPSHOT_SCHEMA,
  validateSchedule,
  validateSchedulerSnapshot,
  validateScheduleWakeIntent,
} from "../../contracts/scheduler.mjs";

function iso(ms) {
  return new Date(ms).toISOString();
}

function firstFutureSlot(nextMs, intervalMs, nowMs) {
  if (nextMs > nowMs) return nextMs;
  return nextMs + (Math.floor((nowMs - nextMs) / intervalMs) + 1) * intervalMs;
}

export function createSchedulerRuntime({ clockMs = () => Date.now() } = {}) {
  if (typeof clockMs !== "function") throw new TypeError("Scheduler clock must be a function");
  const schedules = new Map();

  const store = (value) => {
    const schedule = validateSchedule(value);
    schedules.set(schedule.scheduleId, schedule);
    return schedule;
  };

  const api = {
    register(input) {
      const source = validateSchedule(input);
      if (schedules.has(source.scheduleId)) throw new Error(`Duplicate schedule id: ${source.scheduleId}`);
      if (source.runCount !== 0) throw new TypeError("New schedule run count must be zero");
      if (source.nextRunAt !== null) throw new TypeError("New schedule nextRunAt must be null");
      return store({
        ...source,
        nextRunAt: source.trigger.kind === "once" ? source.trigger.at : source.trigger.anchorAt,
      });
    },

    get(scheduleId) {
      return schedules.get(scheduleId) ?? null;
    },

    list() {
      return Object.freeze([...schedules.values()].sort((a, b) => a.scheduleId.localeCompare(b.scheduleId)));
    },

    setEnabled(scheduleId, enabled) {
      if (typeof enabled !== "boolean") throw new TypeError("Schedule enabled state must be boolean");
      const current = schedules.get(scheduleId);
      if (!current) throw new Error(`Unknown schedule: ${scheduleId}`);
      if (current.runCount >= current.maxRuns && enabled) throw new Error("Exhausted schedule cannot be re-enabled");
      return store({ ...current, enabled });
    },

    remove(scheduleId) {
      return schedules.delete(scheduleId);
    },

    claimDue({ nowMs = clockMs(), limit = 32 } = {}) {
      if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError("Scheduler nowMs is invalid");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) throw new TypeError("Scheduler claim limit is invalid");
      const wakes = [];
      const ordered = [...schedules.values()].sort((a, b) => {
        const left = a.nextRunAt === null ? Number.POSITIVE_INFINITY : Date.parse(a.nextRunAt);
        const right = b.nextRunAt === null ? Number.POSITIVE_INFINITY : Date.parse(b.nextRunAt);
        return left - right || a.scheduleId.localeCompare(b.scheduleId);
      });

      for (const current of ordered) {
        if (wakes.length >= limit || !current.enabled || current.nextRunAt === null) continue;
        const nextMs = Date.parse(current.nextRunAt);
        if (nextMs > nowMs) continue;
        if (current.runCount >= current.maxRuns) {
          store({ ...current, enabled: false, nextRunAt: null });
          continue;
        }

        if (current.trigger.kind === "interval" && current.missedRunPolicy === "skip" && nowMs - nextMs >= current.trigger.intervalMs) {
          store({ ...current, nextRunAt: iso(firstFutureSlot(nextMs, current.trigger.intervalMs, nowMs)) });
          continue;
        }

        let scheduledForMs = nextMs;
        let nextRunAt = null;
        let enabled = false;
        if (current.trigger.kind === "interval") {
          if (current.missedRunPolicy === "run-once" && nowMs > nextMs) {
            const missed = Math.floor((nowMs - nextMs) / current.trigger.intervalMs);
            scheduledForMs = nextMs + missed * current.trigger.intervalMs;
          }
          nextRunAt = iso(scheduledForMs + current.trigger.intervalMs);
          enabled = current.runCount + 1 < current.maxRuns;
          if (!enabled) nextRunAt = null;
        }

        const fireOrdinal = current.runCount + 1;
        store({ ...current, runCount: fireOrdinal, nextRunAt, enabled });
        wakes.push(validateScheduleWakeIntent({
          schema: SCHEDULE_WAKE_INTENT_SCHEMA,
          scheduleId: current.scheduleId,
          ownerKind: current.ownerKind,
          ownerId: current.ownerId,
          workItemId: current.workItemId,
          scheduledFor: iso(scheduledForMs),
          claimedAt: iso(nowMs),
          fireOrdinal,
          deduplicationKey: `${current.deduplicationKey}:${fireOrdinal}`,
        }));
      }

      return Object.freeze(wakes);
    },

    snapshot() {
      return validateSchedulerSnapshot({
        schema: SCHEDULER_SNAPSHOT_SCHEMA,
        schedules: [...schedules.values()],
      });
    },

    restore(snapshotInput) {
      if (schedules.size > 0) throw new Error("Scheduler restore requires an empty runtime");
      const snapshot = validateSchedulerSnapshot(snapshotInput);
      for (const schedule of snapshot.schedules) {
        if (schedules.has(schedule.scheduleId)) throw new Error(`Duplicate schedule id: ${schedule.scheduleId}`);
        schedules.set(schedule.scheduleId, schedule);
      }
      return api.list();
    },
  };

  return Object.freeze(api);
}
