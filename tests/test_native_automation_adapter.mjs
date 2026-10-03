import assert from "node:assert/strict";
import test from "node:test";

import { createNativeAutomationStores } from "../system/adapters/native/automation-state.mjs";
import { createBackgroundRuntime } from "../system/services/background/runtime.mjs";
import { createSchedulerRuntime } from "../system/services/scheduler/runtime.mjs";
import { SCHEDULE_DISPATCH_SCHEMA } from "../system/contracts/scheduler.mjs";

function clone(value) {
  return structuredClone(value);
}

function createMockWindow() {
  const state = {
    $schema: "ordax.native-automation-state/1",
    generation: 0,
    backgroundRuns: {},
    schedules: {},
    pendingOccurrences: {},
  };

  const response = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

  const mutate = (request) => {
    const conflict = () => response({ error: "conflict" }, 409);
    if (request.action === "background-create") {
      if (state.backgroundRuns[request.run.runId]) return conflict();
      state.backgroundRuns[request.run.runId] = clone(request.run);
    } else if (request.action === "background-cas") {
      const current = state.backgroundRuns[request.runId];
      if (!current || current.revision !== request.expectedRevision) return conflict();
      state.backgroundRuns[request.runId] = clone(request.run);
    } else if (request.action === "schedule-create") {
      if (state.schedules[request.schedule.scheduleId]) return conflict();
      state.schedules[request.schedule.scheduleId] = clone(request.schedule);
    } else if (request.action === "schedule-cas") {
      const current = state.schedules[request.scheduleId];
      if (!current || current.revision !== request.expectedRevision) return conflict();
      state.schedules[request.scheduleId] = clone(request.schedule);
    } else if (request.action === "schedule-commit-occurrence") {
      const current = state.schedules[request.scheduleId];
      if (
        !current
        || current.revision !== request.expectedRevision
        || state.pendingOccurrences[request.occurrence.occurrenceId]
      ) return conflict();
      state.schedules[request.scheduleId] = clone(request.schedule);
      state.pendingOccurrences[request.occurrence.occurrenceId] = clone(request.occurrence);
    } else if (request.action === "occurrence-ack") {
      if (!state.pendingOccurrences[request.occurrenceId]) return conflict();
      delete state.pendingOccurrences[request.occurrenceId];
    } else {
      return response({ error: "invalid" }, 400);
    }
    state.generation += 1;
    return response({ ok: true });
  };

  return {
    state,
    windowRef: {
      async fetch(url, options = {}) {
        assert.equal(url, "/__ordax/native/automation-state");
        if ((options.method ?? "GET") === "GET") return response(state);
        if (options.method === "POST") return mutate(JSON.parse(options.body));
        return response({ error: "method" }, 405);
      },
    },
  };
}

test("native automation stores drive Background without a synchronous cache", async () => {
  const { windowRef, state } = createMockWindow();
  const { backgroundStore } = await createNativeAutomationStores(windowRef);
  let sequence = 0;
  const runtime = createBackgroundRuntime({
    store: backgroundStore,
    now: () => Date.parse("2026-10-03T15:00:00.000Z"),
    idFactory: () => `generated-${++sequence}`,
  });

  const created = await runtime.createRun({
    consumerId: "personal-ordax",
    subjectId: "work-1",
    ownerKind: "device",
    budgets: {
      wallClockMs: 60_000,
      stepLimit: 3,
      actionLimit: 0,
      egressBytesLimit: 0,
    },
  });
  assert.equal(state.backgroundRuns[created.runId].authority, "none");

  const leased = await runtime.acquireLease(created.runId, {
    workerId: "worker-1",
    leaseMs: 10_000,
  });
  assert.equal(leased.state, "running");
  assert.equal(state.backgroundRuns[created.runId].revision, 2);
});

test("native automation stores drive Scheduler transactional outbox asynchronously", async () => {
  const { windowRef, state } = createMockWindow();
  const { schedulerStore } = await createNativeAutomationStores(windowRef);
  let sequence = 0;
  const delivered = [];
  const runtime = createSchedulerRuntime({
    store: schedulerStore,
    dispatch: {
      schema: SCHEDULE_DISPATCH_SCHEMA,
      async enqueue(occurrence) {
        delivered.push(clone(occurrence));
        return true;
      },
    },
    now: () => Date.parse("2026-10-03T15:00:00.000Z"),
    idFactory: () => `generated-${++sequence}`,
  });

  const schedule = await runtime.createSchedule({
    consumerId: "personal-ordax",
    subjectId: "work-1",
    ownerKind: "device",
    timezone: "America/Bahia",
    recurrence: { kind: "once" },
    firstRunAt: "2026-10-03T15:00:00.000Z",
    maxRuns: 1,
    deduplicationKey: "work-1-once",
  });
  const occurrences = await runtime.materializeDue();
  assert.equal(occurrences.length, 1);
  assert.equal(Object.keys(state.pendingOccurrences).length, 1);
  assert.equal(state.schedules[schedule.scheduleId].enabled, false);

  const sent = await runtime.deliverPending();
  assert.equal(sent.length, 1);
  assert.equal(delivered.length, 1);
  assert.equal(Object.keys(state.pendingOccurrences).length, 0);
});

test("native adapter reports CAS conflicts instead of overwriting newer state", async () => {
  const { windowRef } = createMockWindow();
  const { backgroundStore } = await createNativeAutomationStores(windowRef);
  let sequence = 0;
  const runtime = createBackgroundRuntime({
    store: backgroundStore,
    now: () => Date.parse("2026-10-03T15:00:00.000Z"),
    idFactory: () => `generated-${++sequence}`,
  });
  const created = await runtime.createRun({
    consumerId: "personal-ordax",
    subjectId: "work-1",
    ownerKind: "device",
    budgets: {
      wallClockMs: 60_000,
      stepLimit: 3,
      actionLimit: 0,
      egressBytesLimit: 0,
    },
  });
  const stale = await backgroundStore.get(created.runId);
  const newer = { ...stale, revision: stale.revision + 1 };
  assert.equal(await backgroundStore.compareAndSwap(created.runId, stale.revision, newer), true);
  assert.equal(await backgroundStore.compareAndSwap(created.runId, stale.revision, newer), false);
});

test("native adapter rejects authority escalation in durable snapshot", async () => {
  const { windowRef, state } = createMockWindow();
  state.backgroundRuns.bad = {
    schema: "ordax.background-run/1",
    revision: 1,
    runId: "bad",
    consumerId: "personal-ordax",
    subjectId: "work-1",
    ownerKind: "device",
    ownerId: null,
    spaceId: null,
    projectId: null,
    state: "queued",
    budgets: { wallClockMs: 60000, stepLimit: 1, actionLimit: 0, egressBytesLimit: 0 },
    usage: { steps: 0, actions: 0, egressBytes: 0 },
    createdAt: "2026-10-03T15:00:00.000Z",
    startedAt: null,
    deadlineAt: "2026-10-03T15:01:00.000Z",
    lease: null,
    checkpoint: null,
    cancelRequestedAt: null,
    finishedAt: null,
    failureCode: null,
    authority: "granted",
  };
  await assert.rejects(createNativeAutomationStores(windowRef), /authority/);
});
