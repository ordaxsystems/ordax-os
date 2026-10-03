import assert from "node:assert/strict";
import test from "node:test";

import { BACKGROUND_STORE_SCHEMA } from "../system/contracts/background-runtime.mjs";
import { createBackgroundRuntime } from "../system/services/background/runtime.mjs";

function createStore() {
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
  };
}

function harness(overrides = {}) {
  let time = Date.parse("2026-10-03T15:00:00.000Z");
  let sequence = 0;
  const store = overrides.store ?? createStore();
  const runtime = createBackgroundRuntime({
    store,
    now: () => time,
    idFactory: () => `generated-${++sequence}`,
    ...overrides,
  });
  return {
    runtime,
    store,
    advance(ms) { time += ms; },
  };
}

function newRun(runtime, budgets = {}) {
  return runtime.createRun({
    consumerId: "personal-ordax",
    subjectId: "work-1",
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-1",
    projectId: "project-1",
    budgets: {
      wallClockMs: 120_000,
      stepLimit: 4,
      actionLimit: 1,
      egressBytesLimit: 0,
      ...budgets,
    },
  });
}

function idempotentRun(runtime, overrides = {}) {
  const {
    idempotencyKey = "schedule-1:1:2026-10-03T15:00:00.000Z",
    consumerId = "personal-ordax",
    subjectId = "work-1",
    ownerKind = "account",
    ownerId = "user-1",
    spaceId = "space-1",
    projectId = "project-1",
    budgets = {},
  } = overrides;
  return runtime.createRun({
    consumerId,
    subjectId,
    ownerKind,
    ownerId: ownerKind === "device" ? null : ownerId,
    spaceId,
    projectId,
    idempotencyKey,
    budgets: {
      wallClockMs: 120_000,
      stepLimit: 4,
      actionLimit: 1,
      egressBytesLimit: 0,
      ...budgets,
    },
  });
}

test("background run starts authority-free and requires one exclusive lease", async () => {
  const { runtime } = harness();
  const created = await newRun(runtime);
  assert.equal(created.state, "queued");
  assert.equal(created.authority, "none");

  const leased = await runtime.acquireLease(created.runId, { workerId: "worker-1", leaseMs: 10_000 });
  assert.equal(leased.state, "running");
  assert.equal(leased.authority, "none");
  await assert.rejects(
    runtime.acquireLease(created.runId, { workerId: "worker-2", leaseMs: 10_000 }),
    /active lease/,
  );
});

test("budget must be reserved before work and exhaustion pauses without granting authority", async () => {
  const { runtime } = harness();
  const created = await newRun(runtime, { actionLimit: 1 });
  const leased = await runtime.acquireLease(created.runId, { workerId: "worker-1", leaseMs: 20_000 });

  const first = await runtime.reserveBudget(created.runId, leased.lease.leaseId, { actions: 1, steps: 1 });
  assert.equal(first.accepted, true);
  assert.equal(first.run.usage.actions, 1);
  assert.equal(first.run.authority, "none");

  const second = await runtime.reserveBudget(created.runId, leased.lease.leaseId, { actions: 1 });
  assert.equal(second.accepted, false);
  assert.equal(second.run.state, "paused");
  assert.equal(second.run.failureCode, "budget-exhausted");
  assert.equal(second.run.lease, null);
  assert.equal(second.run.usage.actions, 1);
});

test("checkpoint is monotonic and stale lease cannot continue after cancellation", async () => {
  const { runtime } = harness();
  const created = await newRun(runtime);
  const leased = await runtime.acquireLease(created.runId, { workerId: "worker-1", leaseMs: 20_000 });
  const leaseId = leased.lease.leaseId;

  const one = await runtime.checkpoint(created.runId, leaseId, { cursor: "phase:1", digest: "a".repeat(64) });
  const two = await runtime.checkpoint(created.runId, leaseId, { cursor: "phase:2", digest: "b".repeat(64) });
  assert.equal(one.checkpoint.sequence, 1);
  assert.equal(two.checkpoint.sequence, 2);

  const cancelled = await runtime.cancel(created.runId);
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.lease, null);
  await assert.rejects(runtime.heartbeat(created.runId, leaseId), /active run/);
  await assert.rejects(runtime.complete(created.runId, leaseId), /active run/);
});

test("expired lease is recovered to paused with checkpoint preserved", async () => {
  const { runtime, advance } = harness();
  const created = await newRun(runtime);
  const leased = await runtime.acquireLease(created.runId, { workerId: "worker-1", leaseMs: 5_000 });
  await runtime.checkpoint(created.runId, leased.lease.leaseId, { cursor: "safe", digest: "c".repeat(64) });
  advance(5_001);

  const recovered = await runtime.recover();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].state, "paused");
  assert.equal(recovered[0].failureCode, "lease-expired-recovery");
  assert.equal(recovered[0].checkpoint.cursor, "safe");
  assert.equal(recovered[0].lease, null);
});

test("deadline fails closed and cannot be renewed into unlimited background execution", async () => {
  const { runtime, advance } = harness();
  const created = await newRun(runtime, { wallClockMs: 10_000 });
  const leased = await runtime.acquireLease(created.runId, { workerId: "worker-1", leaseMs: 10_000 });
  assert.equal(leased.lease.expiresAt, created.deadlineAt);
  advance(10_001);
  const recovered = await runtime.recover();
  assert.equal(recovered[0].state, "failed");
  assert.equal(recovered[0].failureCode, "deadline-exceeded");
});

test("atomic store conflict prevents two writers from silently overwriting state", async () => {
  const real = createStore();
  let rejectSwap = false;
  const store = {
    ...real,
    compareAndSwap(runId, revision, next) {
      if (rejectSwap) return false;
      return real.compareAndSwap(runId, revision, next);
    },
  };
  const { runtime } = harness({ store });
  const created = await newRun(runtime);
  rejectSwap = true;
  await assert.rejects(
    runtime.acquireLease(created.runId, { workerId: "worker-1", leaseMs: 10_000 }),
    /changed concurrently/,
  );
  assert.equal((await runtime.get(created.runId)).state, "queued");
});

test("idempotent retry returns the original run without extending its deadline", async () => {
  const h = harness();
  const first = await idempotentRun(h.runtime);
  h.advance(30_000);
  const retried = await idempotentRun(h.runtime);

  assert.match(first.runId, /^idem-[0-9a-f]{64}$/);
  assert.equal(retried.runId, first.runId);
  assert.equal(retried.createdAt, first.createdAt);
  assert.equal(retried.deadlineAt, first.deadlineAt);
  assert.equal(retried.revision, 1);
});

test("idempotent retry never resets an already completed run", async () => {
  const { runtime } = harness();
  const created = await idempotentRun(runtime);
  const leased = await runtime.acquireLease(created.runId, { workerId: "worker-1", leaseMs: 10_000 });
  const completed = await runtime.complete(created.runId, leased.lease.leaseId);
  const retried = await idempotentRun(runtime);

  assert.equal(retried.runId, created.runId);
  assert.equal(retried.state, "completed");
  assert.equal(retried.revision, completed.revision);
  assert.equal(retried.finishedAt, completed.finishedAt);
});

test("idempotency key cannot be rebound to different work in the same owner namespace", async () => {
  const { runtime } = harness();
  await idempotentRun(runtime);
  await assert.rejects(
    idempotentRun(runtime, { subjectId: "work-2", projectId: "project-2" }),
    /already bound to different work/,
  );
  await assert.rejects(
    idempotentRun(runtime, { budgets: { actionLimit: 2 } }),
    /already bound to different work/,
  );
});

test("same external idempotency key is isolated between account owners", async () => {
  const { runtime } = harness();
  const first = await idempotentRun(runtime, { ownerId: "user-1" });
  const second = await idempotentRun(runtime, { ownerId: "user-2" });

  assert.notEqual(first.runId, second.runId);
  assert.equal(first.ownerId, "user-1");
  assert.equal(second.ownerId, "user-2");
});

test("invalid idempotency keys fail before any run is persisted", async () => {
  const { runtime } = harness();
  await assert.rejects(idempotentRun(runtime, { idempotencyKey: "   " }), /idempotency key/);
  await assert.rejects(idempotentRun(runtime, { idempotencyKey: "x".repeat(513) }), /idempotency key/);
});
