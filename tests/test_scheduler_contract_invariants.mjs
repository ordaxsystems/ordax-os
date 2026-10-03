import assert from "node:assert/strict";
import test from "node:test";

import { SCHEDULE_SCHEMA, validateSchedule } from "../system/contracts/scheduler.mjs";

const base = {
  schema: SCHEDULE_SCHEMA,
  scheduleId: "schedule-1",
  ownerKind: "account",
  ownerId: "owner-1",
  workItemId: "work-1",
  enabled: false,
  timezone: "America/Bahia",
  trigger: { kind: "once", at: "2026-10-03T12:00:00.000Z" },
  missedRunPolicy: "run-once",
  maxRuns: 1,
  runCount: 1,
  nextRunAt: null,
  deduplicationKey: "schedule-1",
};

test("exhausted schedule must be disabled and have no next run", () => {
  assert.equal(validateSchedule(base).runCount, 1);
  assert.throws(() => validateSchedule({ ...base, enabled: true }), /Exhausted schedule/);
  assert.throws(() => validateSchedule({ ...base, nextRunAt: "2026-10-03T13:00:00.000Z" }), /Exhausted schedule/);
});

test("schedule cannot claim more runs than its declared maximum", () => {
  assert.throws(() => validateSchedule({ ...base, runCount: 2 }), /cannot exceed max runs/);
});
