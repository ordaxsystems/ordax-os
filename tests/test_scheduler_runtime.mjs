import assert from "node:assert/strict";
import test from "node:test";

import {
  SCHEDULE_DISPATCH_SCHEMA,
  SCHEDULER_STORE_SCHEMA,
} from "../system/contracts/scheduler.mjs";
import { createSchedulerRuntime } from "../system/services/scheduler/runtime.mjs";

function createStore() {
  const schedules = new Map();
  const pending = new Map();
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
      return pending.delete(occurrenceId);
    },
  };
}

function harness({ dispatchAccepts = true, store = createStore() } = {}) {
  let time = Date.parse("2026-10-03T15:00:00.000Z");
  let sequence = 0;
  let accepts = dispatchAccepts;
  const received = [];
  const dispatch = {
    schema: SCHEDULE_DISPATCH_SCHEMA,
    enqueue(occurrence) {
      received.push(structuredClone(occurrence));
      return accepts;
    },
  };
  const runtime = createSchedulerRuntime({
    store,
    dispatch,
    now: () => time,
    idFactory: () => `generated-${++sequence}`,
  });
  return {
    runtime,
    store,
    received,
    advance(ms) { time += ms; },
    setDispatchAccepts(value) { accepts = value; },
  };
}

function createOnce(runtime) {
  return runtime.createSchedule({
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
    deduplicationKey: "work-1-once",
  });
}

test("scheduler materializes a due occurrence exactly once in its transactional store", async () => {
  const { runtime } = harness();
  const schedule = await createOnce(runtime);
  assert.equal(schedule.authority, "none");

  const first = await runtime.materializeDue();
  assert.equal(first.length, 1);
  assert.equal(first[0].authority, "none");
  assert.equal((await runtime.getSchedule(schedule.scheduleId)).enabled, false);
  assert.equal((await runtime.materializeDue()).length, 0);
});

test("delivery failure keeps occurrence pending and retry uses stable deduplication key", async () => {
  const h = harness({ dispatchAccepts: false });
  await createOnce(h.runtime);
  const [occurrence] = await h.runtime.materializeDue();

  assert.equal((await h.runtime.deliverPending()).length, 0);
  assert.equal(h.received.length, 1);
  assert.equal(h.received[0].deduplicationKey, occurrence.deduplicationKey);

  h.setDispatchAccepts(true);
  const delivered = await h.runtime.deliverPending();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].deduplicationKey, occurrence.deduplicationKey);
  assert.equal((await h.runtime.deliverPending()).length, 0);
});

test("fixed interval coalesces missed periods and advances nextRunAt into the future", async () => {
  const h = harness();
  const schedule = await h.runtime.createSchedule({
    consumerId: "personal-ordax",
    subjectId: "work-2",
    ownerKind: "device",
    timezone: "America/Bahia",
    recurrence: { kind: "fixed-interval", intervalMs: 60_000 },
    firstRunAt: "2026-10-03T14:55:00.000Z",
    maxRuns: 10,
    deduplicationKey: "work-2-interval",
  });

  const [occurrence] = await h.runtime.materializeDue();
  assert.equal(occurrence.dueAt, "2026-10-03T14:55:00.000Z");
  const updated = await h.runtime.getSchedule(schedule.scheduleId);
  assert.equal(updated.runCount, 1);
  assert.equal(updated.nextRunAt, "2026-10-03T15:01:00.000Z");
});

test("manual disable is atomic and prevents future occurrence creation", async () => {
  const h = harness();
  const schedule = await h.runtime.createSchedule({
    consumerId: "personal-ordax",
    subjectId: "work-3",
    ownerKind: "device",
    timezone: "UTC",
    recurrence: { kind: "fixed-interval", intervalMs: 60_000 },
    firstRunAt: "2026-10-03T15:01:00.000Z",
    maxRuns: 5,
    deduplicationKey: "work-3",
  });
  const disabled = await h.runtime.disable(schedule.scheduleId);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.nextRunAt, null);
  h.advance(120_000);
  assert.equal((await h.runtime.materializeDue()).length, 0);
});

test("schedule concurrency conflict does not duplicate an occurrence", async () => {
  const real = createStore();
  let rejectCommit = false;
  const store = {
    ...real,
    commitOccurrence(...args) {
      if (rejectCommit) return false;
      return real.commitOccurrence(...args);
    },
  };
  const h = harness({ store });
  const schedule = await createOnce(h.runtime);
  rejectCommit = true;
  assert.equal((await h.runtime.materializeDue()).length, 0);
  assert.equal((await h.runtime.getSchedule(schedule.scheduleId)).runCount, 0);
});

test("invalid timezone and unbounded recurrence fail closed", async () => {
  const { runtime } = harness();
  await assert.rejects(runtime.createSchedule({
    consumerId: "personal-ordax",
    subjectId: "work-x",
    ownerKind: "device",
    timezone: "Mars/Olympus",
    recurrence: { kind: "fixed-interval", intervalMs: 1 },
    firstRunAt: "2026-10-03T15:00:00.000Z",
    maxRuns: 2,
    deduplicationKey: "x",
  }), /timezone|interval/);
});
