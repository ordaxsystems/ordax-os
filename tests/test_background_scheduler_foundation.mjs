import assert from "node:assert/strict";
import test from "node:test";

import { BACKGROUND_POLICY_SCHEMA } from "../system/contracts/background-runtime.mjs";
import { SCHEDULE_SCHEMA } from "../system/contracts/scheduler.mjs";
import { createBackgroundRuntime } from "../system/services/background/runtime.mjs";
import { createSchedulerRuntime } from "../system/services/scheduler/runtime.mjs";

const backgroundPolicy = (overrides = {}) => ({
  schema: BACKGROUND_POLICY_SCHEMA,
  policyId: "policy-1",
  ownerKind: "account",
  ownerId: "owner-1",
  workItemId: "work-1",
  mode: "read-only",
  allowedEffects: ["read"],
  limits: {
    maxWallClockMs: 60_000,
    maxSteps: 4,
    maxActions: 0,
    maxEgressBytes: 0,
    leaseMs: 10_000,
  },
  restorePolicy: "pause",
  ...overrides,
});

const onceSchedule = (at, overrides = {}) => ({
  schema: SCHEDULE_SCHEMA,
  scheduleId: "schedule-once",
  ownerKind: "account",
  ownerId: "owner-1",
  workItemId: "work-1",
  enabled: true,
  timezone: "America/Bahia",
  trigger: { kind: "once", at },
  missedRunPolicy: "run-once",
  maxRuns: 1,
  runCount: 0,
  nextRunAt: null,
  deduplicationKey: "schedule-once",
  ...overrides,
});

test("background runtime permits observation but never creates action authority", () => {
  const runtime = createBackgroundRuntime({
    clockMs: () => 1_700_000_000_000,
    idFactory: () => "run-1",
  });
  const run = runtime.start(backgroundPolicy());
  assert.equal(run.authority, "none");
  assert.equal(run.executionAuthorized, false);
  assert.equal(runtime.assertEffectAllowed(run.runId, "read").allowed, true);
  const write = runtime.assertEffectAllowed(run.runId, "write");
  assert.equal(write.allowed, false);
  assert.equal(write.authority, "none");
  assert.equal(write.executionAuthorized, false);
  assert.throws(() => runtime.consume(run.runId, { actions: 1 }), /budget exhausted/);
  assert.equal(runtime.get(run.runId).state, "exhausted");
});

test("background policy fails closed on mutation or network egress", () => {
  const runtime = createBackgroundRuntime();
  assert.throws(() => runtime.start(backgroundPolicy({
    limits: { ...backgroundPolicy().limits, maxActions: 1 },
  })), /cannot allocate action or egress/);
  assert.throws(() => runtime.start(backgroundPolicy({
    policyId: "policy-egress",
    allowedEffects: ["read", "external-egress"],
  })), /read-only/);
});

test("lease expiry pauses work and cannot silently resume", () => {
  let now = 1_700_000_000_000;
  const runtime = createBackgroundRuntime({ clockMs: () => now, idFactory: () => "run-lease" });
  runtime.start(backgroundPolicy({ policyId: "policy-lease" }));
  now += 10_000;
  const expired = runtime.get("run-lease");
  assert.equal(expired.state, "paused");
  assert.equal(expired.recoveryRequired, true);
  assert.throws(() => runtime.resume("run-lease"), /external recovery reconciliation/);
});

test("cancel is immediate and restored active work is paused", () => {
  let now = 1_700_000_000_000;
  const policy = backgroundPolicy({ policyId: "policy-restore" });
  const source = createBackgroundRuntime({ clockMs: () => now, idFactory: () => "run-restore" });
  source.start(policy);
  const checkpoint = source.checkpoint("run-restore", { cursor: "memory:42", summary: "Observed local project state." });
  assert.equal(checkpoint.authority, "none");
  now += 1_000;
  const restored = createBackgroundRuntime({ clockMs: () => now });
  restored.restore(source.snapshot(), [policy]);
  assert.equal(restored.get("run-restore").state, "paused");
  assert.equal(restored.get("run-restore").recoveryRequired, true);
  assert.throws(() => restored.resume("run-restore"), /external recovery reconciliation/);

  const cancelled = createBackgroundRuntime({ idFactory: () => "run-cancel" });
  cancelled.start(backgroundPolicy({ policyId: "policy-cancel" }));
  cancelled.cancel("run-cancel", "user-cancelled");
  assert.throws(() => cancelled.consume("run-cancel", { steps: 1 }), /not active/);
});

test("one-shot schedule emits one authority-free wake intent", () => {
  const at = "2026-10-03T12:00:00.000Z";
  const runtime = createSchedulerRuntime();
  runtime.register(onceSchedule(at));
  const wakes = runtime.claimDue({ nowMs: Date.parse(at) });
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].authority, "none");
  assert.equal(wakes[0].backgroundAuthorized, false);
  assert.equal(wakes[0].approvalAuthorized, false);
  assert.equal(wakes[0].executionAuthorized, false);
  assert.equal(wakes[0].deduplicationKey, "schedule-once:1");
  assert.equal(runtime.claimDue({ nowMs: Date.parse(at) + 1 }).length, 0);
});

test("interval run-once collapses missed periods instead of creating a wake storm", () => {
  const runtime = createSchedulerRuntime();
  runtime.register(onceSchedule("2026-10-03T12:00:00.000Z", {
    scheduleId: "interval-run-once",
    trigger: { kind: "interval", anchorAt: "2026-10-03T12:00:00.000Z", intervalMs: 60_000 },
    maxRuns: 10,
    deduplicationKey: "interval-run-once",
  }));
  const wakes = runtime.claimDue({ nowMs: Date.parse("2026-10-03T12:05:30.000Z") });
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].scheduledFor, "2026-10-03T12:05:00.000Z");
  assert.equal(runtime.get("interval-run-once").nextRunAt, "2026-10-03T12:06:00.000Z");
});

test("interval skip advances stale missed work without executing it", () => {
  const runtime = createSchedulerRuntime();
  runtime.register(onceSchedule("2026-10-03T12:00:00.000Z", {
    scheduleId: "interval-skip",
    trigger: { kind: "interval", anchorAt: "2026-10-03T12:00:00.000Z", intervalMs: 60_000 },
    missedRunPolicy: "skip",
    maxRuns: 10,
    deduplicationKey: "interval-skip",
  }));
  assert.equal(runtime.claimDue({ nowMs: Date.parse("2026-10-03T12:05:30.000Z") }).length, 0);
  assert.equal(runtime.get("interval-skip").nextRunAt, "2026-10-03T12:06:00.000Z");
  assert.equal(runtime.get("interval-skip").runCount, 0);
});

test("scheduler snapshot preserves state but never grants background execution", () => {
  const at = "2026-10-03T12:00:00.000Z";
  const source = createSchedulerRuntime();
  source.register(onceSchedule(at));
  source.claimDue({ nowMs: Date.parse(at) });
  const restored = createSchedulerRuntime();
  restored.restore(source.snapshot());
  const schedule = restored.get("schedule-once");
  assert.equal(schedule.enabled, false);
  assert.equal(schedule.runCount, 1);
  assert.equal(schedule.authority, "none");
  assert.equal(restored.claimDue({ nowMs: Date.parse(at) + 60_000 }).length, 0);
});
