import assert from "node:assert/strict";
import test from "node:test";

import { BACKGROUND_STORE_SCHEMA } from "../system/contracts/background-runtime.mjs";
import {
  SCHEDULER_STORE_SCHEMA,
  SCHEDULE_OCCURRENCE_SCHEMA,
} from "../system/contracts/scheduler.mjs";
import { createBackgroundRuntime } from "../system/services/background/runtime.mjs";
import { createBackgroundScheduleDispatch } from "../system/services/scheduler/background-dispatch.mjs";
import { createSchedulerRuntime } from "../system/services/scheduler/runtime.mjs";

function createBackgroundStore() {
  const rows = new Map();
  return {
    schema: BACKGROUND_STORE_SCHEMA,
    create(run) {
      if (rows.has(run.runId)) return false;
      rows.set(run.runId, structuredClone(run));
      return true;
    },
    get(runId) {
      return rows.has(runId) ? structuredClone(rows.get(runId)) : null;
    },
    compareAndSwap(runId, expectedRevision, next) {
      const current = rows.get(runId);
      if (!current || current.revision !== expectedRevision) return false;
      rows.set(runId, structuredClone(next));
      return true;
    },
    listRecoverable() {
      return [...rows.values()]
        .filter((run) => !["completed", "failed", "cancelled"].includes(run.state))
        .map((run) => structuredClone(run));
    },
    values() {
      return [...rows.values()].map((run) => structuredClone(run));
    },
  };
}

function createSchedulerStore({ rejectAckCount = 0 } = {}) {
  const schedules = new Map();
  const pending = new Map();
  let remainingAckRejections = rejectAckCount;
  return {
    schema: SCHEDULER_STORE_SCHEMA,
    createSchedule(schedule) {
      if (schedules.has(schedule.scheduleId)) return false;
      schedules.set(schedule.scheduleId, structuredClone(schedule));
      return true;
    },
    getSchedule(scheduleId) {
      return schedules.has(scheduleId) ? structuredClone(schedules.get(scheduleId)) : null;
    },
    compareAndSwapSchedule(scheduleId, expectedRevision, next) {
      const current = schedules.get(scheduleId);
      if (!current || current.revision !== expectedRevision) return false;
      schedules.set(scheduleId, structuredClone(next));
      return true;
    },
    listDueSchedules(nowIso, limit) {
      const now = Date.parse(nowIso);
      return [...schedules.values()]
        .filter((schedule) => schedule.enabled && Date.parse(schedule.nextRunAt) <= now)
        .slice(0, limit)
        .map((schedule) => structuredClone(schedule));
    },
    commitOccurrence(scheduleId, expectedRevision, nextSchedule, occurrence) {
      const current = schedules.get(scheduleId);
      if (!current || current.revision !== expectedRevision || pending.has(occurrence.occurrenceId)) return false;
      schedules.set(scheduleId, structuredClone(nextSchedule));
      pending.set(occurrence.occurrenceId, structuredClone(occurrence));
      return true;
    },
    listPendingOccurrences(limit) {
      return [...pending.values()].slice(0, limit).map((entry) => structuredClone(entry));
    },
    ackOccurrence(occurrenceId) {
      if (remainingAckRejections > 0) {
        remainingAckRejections -= 1;
        return false;
      }
      return pending.delete(occurrenceId);
    },
  };
}

function harness({ rejectAckCount = 0 } = {}) {
  const now = Date.parse("2026-10-03T15:00:00.000Z");
  let scheduleSequence = 0;
  let backgroundSequence = 0;
  const backgroundStore = createBackgroundStore();
  const schedulerStore = createSchedulerStore({ rejectAckCount });
  const backgroundRuntime = createBackgroundRuntime({
    store: backgroundStore,
    now: () => now,
    idFactory: () => `background-${++backgroundSequence}`,
  });
  const dispatch = createBackgroundScheduleDispatch({
    schedulerStore,
    backgroundRuntime,
    consumerId: "personal-ordax",
    budgets: {
      wallClockMs: 120_000,
      stepLimit: 8,
      actionLimit: 0,
      egressBytesLimit: 0,
    },
  });
  const scheduler = createSchedulerRuntime({
    store: schedulerStore,
    dispatch,
    now: () => now,
    idFactory: () => `schedule-generated-${++scheduleSequence}`,
  });
  return { scheduler, schedulerStore, backgroundStore, dispatch };
}

async function createDueSchedule(scheduler) {
  return await scheduler.createSchedule({
    consumerId: "personal-ordax",
    subjectId: "work-1",
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-1",
    projectId: "project-1",
    timezone: "America/Bahia",
    recurrence: { kind: "once" },
    firstRunAt: "2026-10-03T15:00:00.000Z",
    maxRuns: 1,
    deduplicationKey: "work-1-research",
  });
}

test("Scheduler occurrence creates one authority-free Background run with inherited scope", async () => {
  const h = harness();
  await createDueSchedule(h.scheduler);
  const [occurrence] = await h.scheduler.materializeDue();
  const delivered = await h.scheduler.deliverPending();

  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].occurrenceId, occurrence.occurrenceId);
  const [run] = h.backgroundStore.values();
  assert.ok(run);
  assert.equal(run.authority, "none");
  assert.equal(run.consumerId, "personal-ordax");
  assert.equal(run.subjectId, "work-1");
  assert.equal(run.ownerKind, "account");
  assert.equal(run.ownerId, "user-1");
  assert.equal(run.spaceId, "space-1");
  assert.equal(run.projectId, "project-1");
  assert.deepEqual(run.budgets, {
    wallClockMs: 120_000,
    stepLimit: 8,
    actionLimit: 0,
    egressBytesLimit: 0,
  });
  assert.match(run.runId, /^idem-[0-9a-f]{64}$/);
});

test("outbox retry after failed ack reuses the same Background run", async () => {
  const h = harness({ rejectAckCount: 1 });
  await createDueSchedule(h.scheduler);
  const [occurrence] = await h.scheduler.materializeDue();

  assert.equal((await h.scheduler.deliverPending()).length, 0);
  const [firstRun] = h.backgroundStore.values();
  assert.ok(firstRun);
  assert.equal(h.backgroundStore.values().length, 1);

  const delivered = await h.scheduler.deliverPending();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].deduplicationKey, occurrence.deduplicationKey);
  const runs = h.backgroundStore.values();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].runId, firstRun.runId);
  assert.equal(runs[0].createdAt, firstRun.createdAt);
});

test("dispatch rejects an occurrence whose durable idempotency binding was altered", async () => {
  const h = harness();
  await createDueSchedule(h.scheduler);
  const [occurrence] = await h.scheduler.materializeDue();
  const tampered = {
    ...occurrence,
    schema: SCHEDULE_OCCURRENCE_SCHEMA,
    deduplicationKey: "tampered-key",
  };

  await assert.rejects(h.dispatch.enqueue(tampered), /idempotency binding mismatch/);
  assert.equal(h.backgroundStore.values().length, 0);
});

test("dispatch is consumer-bound and cannot wake another consumer", async () => {
  const h = harness();
  const foreign = {
    schema: SCHEDULE_OCCURRENCE_SCHEMA,
    occurrenceId: "foreign-1",
    scheduleId: "foreign-schedule",
    consumerId: "other-consumer",
    subjectId: "work-x",
    sequence: 1,
    dueAt: "2026-10-03T15:00:00.000Z",
    createdAt: "2026-10-03T15:00:00.000Z",
    deduplicationKey: "foreign:1:2026-10-03T15:00:00.000Z",
    authority: "none",
  };

  await assert.rejects(h.dispatch.enqueue(foreign), /different Background consumer/);
  assert.equal(h.backgroundStore.values().length, 0);
});

test("dispatch budgets are fixed and validated at composition time", () => {
  const backgroundStore = createBackgroundStore();
  const schedulerStore = createSchedulerStore();
  const backgroundRuntime = createBackgroundRuntime({ store: backgroundStore });
  assert.throws(() => createBackgroundScheduleDispatch({
    schedulerStore,
    backgroundRuntime,
    consumerId: "personal-ordax",
    budgets: {
      wallClockMs: 10,
      stepLimit: 0,
      actionLimit: 1001,
      egressBytesLimit: 0,
    },
  }), /budget/);
});
