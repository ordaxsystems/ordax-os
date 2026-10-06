import test from "node:test";
import assert from "node:assert/strict";

import {
  WORK_COORDINATION_STORE_SCHEMA,
  validateWorkCoordinationPartition,
  validateWorkCoordinationStoreState,
  workCoordinationPartitionKey,
} from "../system/contracts/work-coordination-store.mjs";
import { createWorkCoordinationRuntime } from "../system/services/work-coordination/runtime.mjs";

function notifications() {
  return {
    approvalRequired: true,
    taskBlocked: true,
    workCompleted: true,
    staleClaim: true,
    conflictAvoided: true,
    routineProgress: false,
  };
}

function policy(mode = "manual", projectId = "project-finance") {
  return {
    scope: "project",
    projectId,
    mode,
    userConfigured: true,
    notifications: notifications(),
    backgroundExecution: false,
    authority: "none",
    configuredAt: "2026-10-06T05:00:00Z",
    automaticConfirmedAt: mode === "automatic" ? "2026-10-06T05:00:00Z" : null,
  };
}

function partition() {
  return {
    ownerKind: "account",
    ownerId: "user-1",
    projectId: "project-finance",
  };
}

function makeClock(start = Date.parse("2026-10-06T05:00:00Z")) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
  };
}

function makeIds() {
  let next = 1;
  return () => `generated-${next++}`;
}

function makeStore() {
  const rows = new Map();
  return {
    schema: WORK_COORDINATION_STORE_SCHEMA,
    scope: "device",
    async load(partitionValue) {
      const key = workCoordinationPartitionKey(partitionValue);
      const row = rows.get(key);
      return row == null ? null : structuredClone(row);
    },
    async compareAndSwap(partitionValue, expectedRevision, nextStateValue) {
      const partitionNormalized = validateWorkCoordinationPartition(partitionValue);
      const key = workCoordinationPartitionKey(partitionNormalized);
      const row = rows.get(key);
      const actualRevision = row?.revision ?? 0;
      if (actualRevision !== expectedRevision) return false;
      const state = validateWorkCoordinationStoreState(nextStateValue, partitionNormalized);
      rows.set(key, {
        revision: expectedRevision + 1,
        state: structuredClone(state),
      });
      return true;
    },
    _rows: rows,
  };
}

function taskInputs() {
  return [
    {
      id: "task-model",
      title: "Model transactions",
      objective: "Define the transaction model.",
      evidenceRequirements: ["commit"],
    },
    {
      id: "task-ofx",
      title: "Import OFX",
      objective: "Implement OFX import.",
      dependsOnTaskIds: ["task-model"],
      evidenceRequirements: [],
    },
  ];
}

async function createPlan(runtime) {
  return await runtime.createPlan(partition(), {
    planId: "plan-finance",
    title: "Finance app",
    objective: "Ship finance MVP.",
    tasks: taskInputs(),
    trigger: "user",
  });
}

test("manual/assisted policy rejects system-initiated mutation while automatic permits it", async () => {
  for (const mode of ["manual", "assisted"]) {
    const runtime = createWorkCoordinationRuntime({
      store: makeStore(),
      resolvePolicy: async () => policy(mode),
      now: () => Date.parse("2026-10-06T05:00:00Z"),
      idFactory: makeIds(),
    });
    await assert.rejects(runtime.createPlan(partition(), {
      planId: "plan-finance",
      title: "Finance app",
      objective: "Ship finance MVP.",
      tasks: taskInputs(),
      trigger: "system",
    }), /requires automatic mode/);
  }

  const automatic = createWorkCoordinationRuntime({
    store: makeStore(),
    resolvePolicy: async () => policy("automatic"),
    now: () => Date.parse("2026-10-06T05:00:00Z"),
    idFactory: makeIds(),
  });
  const created = await automatic.createPlan(partition(), {
    planId: "plan-finance",
    title: "Finance app",
    objective: "Ship finance MVP.",
    tasks: taskInputs(),
    trigger: "system",
  });
  assert.equal(created.state.plans.length, 1);
});

test("absent/off policy fails closed for coordination mutations", async () => {
  const missing = createWorkCoordinationRuntime({
    store: makeStore(),
    resolvePolicy: async () => null,
    now: () => Date.parse("2026-10-06T05:00:00Z"),
    idFactory: makeIds(),
  });
  await assert.rejects(createPlan(missing), /not configured/);

  const off = createWorkCoordinationRuntime({
    store: makeStore(),
    resolvePolicy: async () => policy("off"),
    now: () => Date.parse("2026-10-06T05:00:00Z"),
    idFactory: makeIds(),
  });
  await assert.rejects(createPlan(off), /disabled/);
});

test("plan creation derives ready/planned states and claim is CAS-safe", async () => {
  const store = makeStore();
  const clock = makeClock();
  const runtime = createWorkCoordinationRuntime({
    store,
    resolvePolicy: async () => policy("manual"),
    now: clock.now,
    idFactory: makeIds(),
  });
  const created = await createPlan(runtime);
  assert.equal(created.revision, 1);
  assert.equal(created.state.tasks.find((task) => task.id === "task-model").state, "ready");
  assert.equal(created.state.tasks.find((task) => task.id === "task-ofx").state, "planned");

  const ready = await runtime.listReady(partition());
  assert.deepEqual(ready.map((task) => task.id), ["task-model"]);

  const claimed = await runtime.claimTask(partition(), "task-model", {
    workerKind: "ai-client",
    workerRef: "provider:openai/chatgpt",
    clientRef: "client:ordax-chatgpt",
    sessionRef: "session:a",
    leaseDurationMs: 60_000,
    trigger: "user",
  });
  assert.equal(claimed.state.claims.length, 1);
  assert.equal(claimed.state.tasks.find((task) => task.id === "task-model").state, "in-progress");

  await assert.rejects(runtime.claimTask(partition(), "task-model", {
    workerKind: "ai-client",
    workerRef: "provider:other",
    leaseDurationMs: 60_000,
    trigger: "user",
  }), /active claim/);
});

test("heartbeat, checkpoint and explicit handoff preserve resumable state", async () => {
  const store = makeStore();
  const clock = makeClock();
  const runtime = createWorkCoordinationRuntime({
    store,
    resolvePolicy: async () => policy("manual"),
    now: clock.now,
    idFactory: makeIds(),
  });
  await createPlan(runtime);
  let record = await runtime.claimTask(partition(), "task-model", {
    workerKind: "ai-client",
    workerRef: "provider:openai/chatgpt",
    leaseDurationMs: 60_000,
    trigger: "user",
  });
  const claim = record.state.claims[0];

  clock.advance(10_000);
  record = await runtime.heartbeat(partition(), claim.id, claim.leaseId, {
    leaseDurationMs: 120_000,
    trigger: "user",
  });
  assert.equal(record.state.claims[0].heartbeatAt, "2026-10-06T05:00:10.000Z");

  record = await runtime.checkpoint(partition(), claim.id, claim.leaseId, {
    summary: "Schema ready; migration tests remain.",
    resumeRef: "branch:feat/model",
    artifactRefs: ["commit:abc"],
    trigger: "user",
  });
  assert.equal(record.state.checkpoints.length, 1);
  assert.equal(record.state.checkpoints[0].sequence, 1);

  record = await runtime.handoff(partition(), claim.id, claim.leaseId, {
    summary: "Handing off after schema implementation.",
    resumeRef: "branch:feat/model",
    artifactRefs: ["commit:abc"],
    trigger: "user",
  });
  assert.equal(record.state.claims.length, 0);
  assert.equal(record.state.tasks.find((task) => task.id === "task-model").state, "ready");
  assert.equal(record.state.checkpoints.length, 2);
});

test("expired claim blocks the task for reconciliation instead of silently replaying work", async () => {
  const store = makeStore();
  const clock = makeClock();
  const runtime = createWorkCoordinationRuntime({
    store,
    resolvePolicy: async () => policy("manual"),
    now: clock.now,
    idFactory: makeIds(),
  });
  await createPlan(runtime);
  const claimed = await runtime.claimTask(partition(), "task-model", {
    workerKind: "ai-client",
    workerRef: "provider:openai/chatgpt",
    leaseDurationMs: 5_000,
    trigger: "user",
  });
  const claim = claimed.state.claims[0];
  clock.advance(5_001);

  await assert.rejects(runtime.heartbeat(partition(), claim.id, claim.leaseId, {
    trigger: "user",
  }), /expired/);

  const recovered = await runtime.recoverExpiredClaims(partition());
  assert.equal(recovered.state.claims.length, 0);
  const blocked = recovered.state.tasks.find((task) => task.id === "task-model");
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.blockedReason, "stale-claim-reconciliation-required");

  await assert.rejects(runtime.claimTask(partition(), "task-model", {
    workerKind: "ai-client",
    workerRef: "provider:other",
    trigger: "user",
  }), /not ready/);

  const released = await runtime.releaseStaleTask(partition(), "task-model", { trigger: "user" });
  assert.equal(released.state.tasks.find((task) => task.id === "task-model").state, "ready");
});

test("only injected verifier can create verified evidence and completion unlocks dependencies", async () => {
  const store = makeStore();
  const clock = makeClock();
  const ids = makeIds();
  const runtime = createWorkCoordinationRuntime({
    store,
    resolvePolicy: async () => policy("manual"),
    verifyEvidence: async ({ plan, task, input }) => ({
      id: `verified:${input.id}`,
      planId: plan.id,
      taskId: task.id,
      taskRevision: task.revision,
      kind: input.kind,
      reference: input.reference,
      summary: input.summary ?? null,
      verification: "verified",
      producerRef: "verifier:test",
      observedAt: "2026-10-06T05:00:01Z",
      verifiedAt: "2026-10-06T05:00:02Z",
      authority: "none",
    }),
    now: clock.now,
    idFactory: ids,
  });
  await createPlan(runtime);
  let record = await runtime.claimTask(partition(), "task-model", {
    workerKind: "ai-client",
    workerRef: "provider:openai/chatgpt",
    trigger: "user",
  });
  const claim = record.state.claims[0];

  await assert.rejects(runtime.completeTask(partition(), claim.id, claim.leaseId, {
    trigger: "user",
  }), /evidence is incomplete/);

  record = await runtime.recordEvidence(partition(), "task-model", {
    id: "commit-1",
    kind: "commit",
    reference: "git:abc123",
  }, { trigger: "user" });
  assert.equal(record.state.evidence.length, 1);
  assert.equal(record.state.evidence[0].verification, "verified");

  clock.advance(3_000);
  record = await runtime.completeTask(partition(), claim.id, claim.leaseId, { trigger: "user" });
  assert.equal(record.state.claims.length, 0);
  assert.equal(record.state.tasks.find((task) => task.id === "task-model").state, "completed");
  assert.equal(record.state.tasks.find((task) => task.id === "task-ofx").state, "ready");
  assert.deepEqual((await runtime.listReady(partition())).map((task) => task.id), ["task-ofx"]);
});

test("evidence cannot be self-certified when no verifier is composed", async () => {
  const runtime = createWorkCoordinationRuntime({
    store: makeStore(),
    resolvePolicy: async () => policy("manual"),
    now: () => Date.parse("2026-10-06T05:00:00Z"),
    idFactory: makeIds(),
  });
  await createPlan(runtime);
  await assert.rejects(runtime.recordEvidence(partition(), "task-model", {
    id: "claimed-by-model",
    kind: "commit",
    reference: "git:not-verified",
    verification: "verified",
  }, { trigger: "user" }), /verification is unavailable/);
});

test("stale store revision loses CAS instead of overwriting concurrent work", async () => {
  const store = makeStore();
  const clock = makeClock();
  const runtime = createWorkCoordinationRuntime({
    store,
    resolvePolicy: async () => policy("manual"),
    now: clock.now,
    idFactory: makeIds(),
  });
  await createPlan(runtime);

  let armed = false;
  const originalCas = store.compareAndSwap.bind(store);
  store.compareAndSwap = async (partitionValue, expectedRevision, nextState) => {
    if (armed) {
      armed = false;
      const key = workCoordinationPartitionKey(partitionValue);
      const current = store._rows.get(key);
      store._rows.set(key, { ...current, revision: current.revision + 1 });
    }
    return await originalCas(partitionValue, expectedRevision, nextState);
  };
  armed = true;

  await assert.rejects(runtime.claimTask(partition(), "task-model", {
    workerKind: "ai-client",
    workerRef: "provider:openai/chatgpt",
    trigger: "user",
  }), /changed concurrently/);
});
