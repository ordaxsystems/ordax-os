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
      const normalized = validateWorkCoordinationPartition(partitionValue);
      const key = workCoordinationPartitionKey(normalized);
      const row = rows.get(key);
      const actualRevision = row?.revision ?? 0;
      if (actualRevision !== expectedRevision) return false;
      const state = validateWorkCoordinationStoreState(nextStateValue, normalized);
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

async function createPlan(runtime, trigger = "user") {
  return await runtime.createPlan(partition(), {
    planId: "plan-finance",
    title: "Finance app",
    objective: "Ship finance MVP.",
    tasks: taskInputs(),
    trigger,
  });
}

test("manual and assisted reject system mutation while confirmed automatic permits it", async () => {
  for (const mode of ["manual", "assisted"]) {
    const runtime = createWorkCoordinationRuntime({
      store: makeStore(),
      resolvePolicy: async () => policy(mode),
      now: () => Date.parse("2026-10-06T05:00:00Z"),
      idFactory: makeIds(),
    });
    await assert.rejects(createPlan(runtime, "system"), /requires automatic mode/);
  }

  const automatic = createWorkCoordinationRuntime({
    store: makeStore(),
    resolvePolicy: async () => policy("automatic"),
    now: () => Date.parse("2026-10-06T05:00:00Z"),
    idFactory: makeIds(),
  });
  const created = await createPlan(automatic, "system");
  assert.equal(created.state.plans.length, 1);
});

test("absent and off policy fail closed for mutations", async () => {
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

test("plan creation derives dependency state and plan updates are revisioned", async () => {
  const store = makeStore();
  const clock = makeClock();
  const runtime = createWorkCoordinationRuntime({
    store,
    resolvePolicy: async () => policy("manual"),
    now: clock.now,
    idFactory: makeIds(),
  });

  let record = await createPlan(runtime);
  assert.equal(record.revision, 1);
  assert.equal(record.state.plans[0].revision, 1);
  assert.equal(record.state.tasks.find((task) => task.id === "task-model").state, "ready");
  assert.equal(record.state.tasks.find((task) => task.id === "task-ofx").state, "planned");

  clock.advance(1_000);
  record = await runtime.updatePlan(partition(), "plan-finance", {
    title: "Finance MVP",
    trigger: "user",
  });
  assert.equal(record.state.plans[0].revision, 2);
  assert.equal(record.state.plans[0].title, "Finance MVP");

  record = await runtime.claimTask(partition(), "task-model", {
    workerKind: "ai-client",
    workerRef: "provider:openai/chatgpt",
    trigger: "user",
  });
  assert.equal(record.state.claims[0].planRevision, 2);

  await assert.rejects(runtime.updatePlan(partition(), "plan-finance", {
    objective: "Changed while leased",
    trigger: "user",
  }), /active claims cannot be revised/);
});

test("claim is exclusive and stale claim must be reconciled instead of stolen", async () => {
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
    clientRef: "client:ordax-chatgpt",
    sessionRef: "session:a",
    leaseDurationMs: 60_000,
    trigger: "user",
  });
  assert.equal(claimed.state.claims.length, 1);

  await assert.rejects(runtime.claimTask(partition(), "task-model", {
    workerKind: "ai-client",
    workerRef: "provider:other",
    trigger: "user",
  }), /active claim/);

  clock.advance(60_001);
  await assert.rejects(runtime.claimTask(partition(), "task-model", {
    workerKind: "ai-client",
    workerRef: "provider:other",
    trigger: "user",
  }), /stale claim.*reconciliation/);
});

test("heartbeat checkpoint and handoff preserve bounded resumable state", async () => {
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

test("expired-claim recovery is policy-bound and dependency blocking is canonical", async () => {
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
  await assert.rejects(runtime.recoverExpiredClaims(partition(), {
    trigger: "system",
  }), /requires automatic mode/);

  let recovered = await runtime.recoverExpiredClaims(partition(), { trigger: "user" });
  const blockedRoot = recovered.state.tasks.find((task) => task.id === "task-model");
  const blockedDependent = recovered.state.tasks.find((task) => task.id === "task-ofx");
  assert.equal(recovered.state.claims.length, 0);
  assert.equal(blockedRoot.state, "blocked");
  assert.equal(blockedRoot.blockedReason, "stale-claim-reconciliation-required");
  assert.equal(blockedDependent.state, "blocked");
  assert.equal(blockedDependent.blockedReason, "dependency-blocked:task-model");

  recovered = await runtime.releaseStaleTask(partition(), "task-model", { trigger: "user" });
  assert.equal(recovered.state.tasks.find((task) => task.id === "task-model").state, "ready");
  assert.equal(recovered.state.tasks.find((task) => task.id === "task-ofx").state, "planned");
});

test("confirmed automatic policy permits system expired-claim recovery", async () => {
  const store = makeStore();
  const clock = makeClock();
  const runtime = createWorkCoordinationRuntime({
    store,
    resolvePolicy: async () => policy("automatic"),
    now: clock.now,
    idFactory: makeIds(),
  });
  await createPlan(runtime, "system");
  await runtime.claimTask(partition(), "task-model", {
    workerKind: "local-service",
    workerRef: "worker:local",
    leaseDurationMs: 5_000,
    trigger: "system",
  });
  clock.advance(5_001);
  const recovered = await runtime.recoverExpiredClaims(partition(), { trigger: "system" });
  assert.equal(recovered.state.claims.length, 0);
  assert.equal(recovered.state.tasks.find((task) => task.id === "task-model").state, "blocked");
});

test("only injected verifier creates verified evidence and completion advances dependencies", async () => {
  const store = makeStore();
  const clock = makeClock();
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
    idFactory: makeIds(),
  });
  await createPlan(runtime);
  let record = await runtime.claimTask(partition(), "task-model", {
    workerKind: "ai-client",
    workerRef: "provider:openai/chatgpt",
    trigger: "user",
  });
  const firstClaim = record.state.claims[0];

  await assert.rejects(runtime.completeTask(partition(), firstClaim.id, firstClaim.leaseId, {
    trigger: "user",
  }), /evidence is incomplete/);

  record = await runtime.recordEvidence(partition(), "task-model", {
    id: "commit-1",
    kind: "commit",
    reference: "git:abc123",
  }, { trigger: "user" });
  assert.equal(record.state.evidence[0].verification, "verified");

  clock.advance(3_000);
  record = await runtime.completeTask(partition(), firstClaim.id, firstClaim.leaseId, { trigger: "user" });
  assert.equal(record.state.tasks.find((task) => task.id === "task-model").state, "completed");
  assert.equal(record.state.tasks.find((task) => task.id === "task-ofx").state, "ready");

  record = await runtime.claimTask(partition(), "task-ofx", {
    workerKind: "ai-client",
    workerRef: "provider:openai/chatgpt",
    trigger: "user",
  });
  const secondClaim = record.state.claims[0];
  clock.advance(1_000);
  record = await runtime.completeTask(partition(), secondClaim.id, secondClaim.leaseId, { trigger: "user" });
  assert.equal(record.state.plans[0].state, "completed");
  assert.equal(record.state.plans[0].revision, 2);
  assert.equal(record.state.claims.length, 0);
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
