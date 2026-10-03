import { BACKGROUND_RUNTIME_SCHEMA, validateBackgroundBudgets } from "../../contracts/background-runtime.mjs";
import {
  SCHEDULE_DISPATCH_SCHEMA,
  assertSchedulerStore,
  validateSchedule,
  validateScheduleOccurrence,
} from "../../contracts/scheduler.mjs";

function boundedConsumerId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 160 || value.includes("\0")) {
    throw new TypeError("Schedule Background consumer id is invalid");
  }
  return value.trim();
}

function assertBackgroundRuntime(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== BACKGROUND_RUNTIME_SCHEMA
    || typeof value.createRun !== "function"
  ) {
    throw new TypeError("Schedule Background dispatch requires a compatible Background runtime");
  }
  return value;
}

function expectedOccurrenceKey(schedule, occurrence) {
  return `${schedule.deduplicationKey}:${occurrence.sequence}:${occurrence.dueAt}`;
}

function assertOccurrenceBinding(schedule, occurrence, consumerId) {
  if (schedule.consumerId !== consumerId || occurrence.consumerId !== consumerId) {
    throw new Error("Schedule occurrence consumer binding mismatch");
  }
  if (occurrence.scheduleId !== schedule.scheduleId || occurrence.subjectId !== schedule.subjectId) {
    throw new Error("Schedule occurrence work binding mismatch");
  }
  if (occurrence.sequence > schedule.runCount) {
    throw new Error("Schedule occurrence sequence is ahead of durable schedule state");
  }
  if (occurrence.deduplicationKey !== expectedOccurrenceKey(schedule, occurrence)) {
    throw new Error("Schedule occurrence idempotency binding mismatch");
  }
}

export function createBackgroundScheduleDispatch({
  schedulerStore: schedulerStoreValue,
  backgroundRuntime: backgroundRuntimeValue,
  consumerId: consumerIdValue,
  budgets: budgetValue,
} = {}) {
  const schedulerStore = assertSchedulerStore(schedulerStoreValue);
  const backgroundRuntime = assertBackgroundRuntime(backgroundRuntimeValue);
  const consumerId = boundedConsumerId(consumerIdValue);
  const budgets = validateBackgroundBudgets(budgetValue);

  return Object.freeze({
    schema: SCHEDULE_DISPATCH_SCHEMA,

    async enqueue(occurrenceValue) {
      const occurrence = validateScheduleOccurrence(occurrenceValue);
      if (occurrence.consumerId !== consumerId) {
        throw new Error("Schedule occurrence targets a different Background consumer");
      }

      const rawSchedule = await schedulerStore.getSchedule(occurrence.scheduleId);
      if (rawSchedule == null) throw new Error("Schedule occurrence lost its durable schedule");
      const schedule = validateSchedule(rawSchedule);
      assertOccurrenceBinding(schedule, occurrence, consumerId);

      const run = await backgroundRuntime.createRun({
        consumerId: schedule.consumerId,
        subjectId: schedule.subjectId,
        ownerKind: schedule.ownerKind,
        ownerId: schedule.ownerId,
        spaceId: schedule.spaceId,
        projectId: schedule.projectId,
        budgets,
        idempotencyKey: occurrence.deduplicationKey,
      });
      if (run.authority !== "none") {
        throw new Error("Background Schedule dispatch cannot create action authority");
      }
      return true;
    },
  });
}
