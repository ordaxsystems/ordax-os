import assert from "node:assert/strict";
import test from "node:test";

import { SCHEDULE_SCHEMA, validateSchedule } from "../system/contracts/scheduler.mjs";
import { createSchedulerRuntime } from "../system/services/scheduler/runtime.mjs";

function once(overrides = {}) {
  return {
    schema: SCHEDULE_SCHEMA,
    scheduleId: "schedule-1",
    ownerKind: "account",
    ownerId: "owner-1",
    workItemId: "work-1",
    enabled: true,
    timezone: "America/Bahia",
    trigger: { kind: "once", at: "2026-10-03T12:00:00.000Z" },
    missedRunPolicy: "run-once",
    maxRuns: 1,
    runCount: 0,
    nextRunAt: null,
    deduplicationKey: "schedule-1",
    ...overrides,
  };
}

function interval(overrides = {}) {
  return once({
    scheduleId: "interval-1",
    trigger: { kind: "interval", anchorAt: "2026-10-03T12:00:00.000Z", intervalMs: 60_000 },
    maxRuns: 10,
    deduplicationKey: "interval-1",
    ...overrides,
  });
}

test("one-shot schedule is exactly one run and dedup key is canonical", () => {
  assert.throws(() => validateSchedule(once({ maxRuns: 2 })), /exactly one run/);
  assert.throws(() => validateSchedule(once({ deduplicationKey: "other" })), /must equal schedule id/);
});

test("restore rejects duplicate schedule ids without partial state", () => {
  const source = createSchedulerRuntime();
  source.register(once());
  const snapshot = structuredClone(source.snapshot());
  snapshot.schedules.push(structuredClone(snapshot.schedules[0]));

  const restored = createSchedulerRuntime();
  assert.throws(() => restored.restore(snapshot), /Duplicate schedule id/);
  assert.deepEqual(restored.list(), []);
});

test("restore rejects one-shot nextRunAt that is detached from its trigger", () => {
  const source = createSchedulerRuntime();
  source.register(once());
  const snapshot = structuredClone(source.snapshot());
  snapshot.schedules[0].nextRunAt = "2026-10-03T12:01:00.000Z";

  const restored = createSchedulerRuntime();
  assert.throws(() => restored.restore(snapshot), /trigger timestamp/);
  assert.deepEqual(restored.list(), []);
});

test("restore rejects interval nextRunAt outside the trigger lattice", () => {
  const source = createSchedulerRuntime();
  source.register(interval());
  const snapshot = structuredClone(source.snapshot());
  snapshot.schedules[0].nextRunAt = "2026-10-03T12:00:30.000Z";

  const restored = createSchedulerRuntime();
  assert.throws(() => restored.restore(snapshot), /trigger lattice/);
  assert.deepEqual(restored.list(), []);
});

test("restore rejects enabled interval with no next run", () => {
  const source = createSchedulerRuntime();
  source.register(interval());
  const snapshot = structuredClone(source.snapshot());
  snapshot.schedules[0].nextRunAt = null;

  const restored = createSchedulerRuntime();
  assert.throws(() => restored.restore(snapshot), /must have a next run/);
  assert.deepEqual(restored.list(), []);
});
