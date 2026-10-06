import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  WORK_COORDINATION_STORE_FORMAT_VERSION,
  WORK_COORDINATION_STORE_SCHEMA,
  assertWorkCoordinationStore,
  createEmptyWorkCoordinationStoreState,
  validateWorkCoordinationStoreRecord,
  validateWorkCoordinationStoreState,
  workCoordinationPartitionKey,
} from "../system/contracts/work-coordination-store.mjs";

const NOW = "2026-10-06T05:00:00Z";

function partition(projectId = "project-finance") {
  return {
    ownerKind: "account",
    ownerId: "user-1",
    projectId,
  };
}

function plan(overrides = {}) {
  return {
    revision: 1,
    id: "plan-finance",
    ownerKind: "account",
    ownerId: "user-1",
    projectId: "project-finance",
    title: "Finance app MVP",
    objective: "Ship the finance app.",
    state: "active",
    taskIds: ["task-model", "task-ofx"],
    authority: "none",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function task(id, overrides = {}) {
  return {
    revision: 1,
    id,
    planId: "plan-finance",
    title: id,
    objective: `Complete ${id}.`,
    state: "ready",
    dependsOnTaskIds: [],
    evidenceRequirements: [],
    authority: "none",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    schema: "ordax.work-coordination-store-state/1",
    formatVersion: WORK_COORDINATION_STORE_FORMAT_VERSION,
    ...partition(),
    plans: [plan()],
    tasks: [
      task("task-model"),
      task("task-ofx", { dependsOnTaskIds: ["task-model"] }),
    ],
    claims: [],
    checkpoints: [],
    evidence: [],
    ...overrides,
  };
}

test("empty coordination state is partition-bound, versioned and deterministic", () => {
  const empty = createEmptyWorkCoordinationStoreState(partition());
  assert.equal(empty.schema, "ordax.work-coordination-store-state/1");
  assert.equal(empty.formatVersion, 1);
  assert.deepEqual(empty.plans, []);
  assert.equal(
    workCoordinationPartitionKey(partition()),
    '["account","user-1","project-finance"]',
  );
  assert.equal(
    workCoordinationPartitionKey({
      ownerKind: "device",
      projectId: null,
    }),
    '["device",null,null]',
  );

  assert.throws(() => validateWorkCoordinationStoreState({
    ...empty,
    formatVersion: 2,
  }), /format version is incompatible/);
});

test("store state rejects owner/project leakage and orphan tasks", () => {
  assert.throws(() => validateWorkCoordinationStoreState(
    state(),
    partition("different-project"),
  ), /different partition/);

  assert.throws(() => validateWorkCoordinationStoreState(state({
    plans: [plan({ projectId: "different-project" })],
  })), /cannot cross its coordination store partition/);

  assert.throws(() => validateWorkCoordinationStoreState(state({
    plans: [plan({ taskIds: ["task-model"] })],
  })), /must be retained by its plan task list/);
});

test("store validates full dependency graph including missing, cross-plan and cycles", () => {
  assert.throws(() => validateWorkCoordinationStoreState(state({
    tasks: [
      task("task-model"),
      task("task-ofx", { dependsOnTaskIds: ["missing-task"] }),
    ],
  })), /references missing task/);

  const secondPlan = plan({
    id: "plan-ui",
    taskIds: ["task-ui"],
  });
  assert.throws(() => validateWorkCoordinationStoreState(state({
    plans: [plan(), secondPlan],
    tasks: [
      task("task-model"),
      task("task-ofx", { dependsOnTaskIds: ["task-ui"] }),
      task("task-ui", { planId: "plan-ui" }),
    ],
  })), /cannot cross plans/);

  assert.throws(() => validateWorkCoordinationStoreState(state({
    tasks: [
      task("task-model", { dependsOnTaskIds: ["task-ofx"] }),
      task("task-ofx", { dependsOnTaskIds: ["task-model"] }),
    ],
  })), /contains a cycle/);
});

test("active claims are unique per task and bind exact current revisions", () => {
  const inProgress = task("task-model", { state: "in-progress" });
  const baseClaim = {
    id: "claim-1",
    planId: "plan-finance",
    taskId: "task-model",
    planRevision: 1,
    taskRevision: 1,
    workerKind: "ai-client",
    workerRef: "worker:one",
    clientRef: "client:chatgpt",
    sessionRef: "session:one",
    leaseId: "lease-1",
    acquiredAt: NOW,
    heartbeatAt: "2026-10-06T05:01:00Z",
    expiresAt: "2026-10-06T05:10:00Z",
    authority: "none",
  };

  const valid = validateWorkCoordinationStoreState(state({
    tasks: [
      inProgress,
      task("task-ofx", { dependsOnTaskIds: ["task-model"] }),
    ],
    claims: [baseClaim],
  }));
  assert.equal(valid.claims.length, 1);

  assert.throws(() => validateWorkCoordinationStoreState(state({
    tasks: [
      inProgress,
      task("task-ofx", { dependsOnTaskIds: ["task-model"] }),
    ],
    claims: [
      baseClaim,
      {
        ...baseClaim,
        id: "claim-2",
        workerRef: "worker:two",
        leaseId: "lease-2",
      },
    ],
  })), /active claims.*unique/);

  assert.throws(() => validateWorkCoordinationStoreState(state({
    tasks: [
      inProgress,
      task("task-ofx", { dependsOnTaskIds: ["task-model"] }),
    ],
    claims: [{ ...baseClaim, taskRevision: 2 }],
  })), /current plan\/task revisions/);

  assert.throws(() => validateWorkCoordinationStoreState(state({
    claims: [baseClaim],
  })), /requires an in-progress task/);

  assert.throws(() => validateWorkCoordinationStoreState(state({
    plans: [plan({ state: "paused" })],
    tasks: [
      inProgress,
      task("task-ofx", { dependsOnTaskIds: ["task-model"] }),
    ],
    claims: [baseClaim],
  })), /requires an active plan/);
});

test("completed task must satisfy declared verified evidence on its current revision", () => {
  const completed = task("task-model", {
    state: "completed",
    evidenceRequirements: ["commit", "ci-run"],
    completedAt: "2026-10-06T05:10:00Z",
    updatedAt: "2026-10-06T05:10:00Z",
  });

  const evidence = [
    {
      id: "evidence-commit",
      planId: "plan-finance",
      taskId: "task-model",
      taskRevision: 1,
      kind: "commit",
      reference: "git:abc123",
      verification: "verified",
      observedAt: "2026-10-06T05:05:00Z",
      verifiedAt: "2026-10-06T05:06:00Z",
      authority: "none",
    },
    {
      id: "evidence-ci",
      planId: "plan-finance",
      taskId: "task-model",
      taskRevision: 1,
      kind: "ci-run",
      reference: "ci:42",
      verification: "verified",
      observedAt: "2026-10-06T05:07:00Z",
      verifiedAt: "2026-10-06T05:08:00Z",
      authority: "none",
    },
  ];

  const valid = validateWorkCoordinationStoreState(state({
    tasks: [
      completed,
      task("task-ofx", { dependsOnTaskIds: ["task-model"] }),
    ],
    evidence,
  }));
  assert.equal(valid.evidence.length, 2);

  assert.throws(() => validateWorkCoordinationStoreState(state({
    tasks: [
      completed,
      task("task-ofx", { dependsOnTaskIds: ["task-model"] }),
    ],
    evidence: [evidence[0]],
  })), /missing required verified evidence/);

  assert.throws(() => validateWorkCoordinationStoreState(state({
    tasks: [
      completed,
      task("task-ofx", { dependsOnTaskIds: ["task-model"] }),
    ],
    evidence: [
      evidence[0],
      { ...evidence[1], verification: "unverified", verifiedAt: null },
    ],
  })), /missing required verified evidence/);
});

test("checkpoint history cannot point to future revisions or regress within a revision", () => {
  const checkpoints = [
    {
      planId: "plan-finance",
      taskId: "task-model",
      taskRevision: 1,
      claimId: "claim-old",
      leaseId: "lease-old",
      sequence: 1,
      summary: "Started model.",
      authority: "none",
      createdAt: NOW,
    },
    {
      planId: "plan-finance",
      taskId: "task-model",
      taskRevision: 1,
      claimId: "claim-old",
      leaseId: "lease-old",
      sequence: 2,
      summary: "Model ready.",
      authority: "none",
      createdAt: "2026-10-06T05:02:00Z",
    },
  ];

  const valid = validateWorkCoordinationStoreState(state({ checkpoints }));
  assert.equal(valid.checkpoints.length, 2);

  assert.throws(() => validateWorkCoordinationStoreState(state({
    checkpoints: [checkpoints[1], checkpoints[0]],
  })), /sequence must increase/);

  assert.throws(() => validateWorkCoordinationStoreState(state({
    checkpoints: [{ ...checkpoints[0], taskRevision: 2 }],
  })), /future task revision/);

  assert.throws(() => validateWorkCoordinationStoreState(state({
    tasks: [
      task("task-model", { revision: 2 }),
      task("task-ofx", { dependsOnTaskIds: ["task-model"] }),
    ],
    checkpoints: [
      { ...checkpoints[0], taskRevision: 2 },
      { ...checkpoints[1], taskRevision: 1 },
    ],
  })), /task revision must not regress/);
});

test("completed and archived plans require terminal retained tasks", () => {
  assert.throws(() => validateWorkCoordinationStoreState(state({
    plans: [plan({ state: "completed" })],
  })), /requires all retained tasks to be terminal/);

  assert.throws(() => validateWorkCoordinationStoreState(state({
    plans: [plan({ state: "archived" })],
  })), /requires all retained tasks to be terminal/);

  const archived = validateWorkCoordinationStoreState(state({
    plans: [plan({ state: "archived" })],
    tasks: [
      task("task-model", { state: "cancelled" }),
      task("task-ofx", { state: "cancelled", dependsOnTaskIds: ["task-model"] }),
    ],
  }));
  assert.equal(archived.plans[0].state, "archived");
});

test("store record validates revision and mutation surface is strictly CAS-only", () => {
  const record = validateWorkCoordinationStoreRecord({
    revision: 7,
    state: state(),
  }, partition());
  assert.equal(record.revision, 7);

  assert.throws(() => validateWorkCoordinationStoreRecord({
    revision: 0,
    state: state(),
  }), /revision.*outside bounds/);

  assert.throws(() => assertWorkCoordinationStore({
    schema: WORK_COORDINATION_STORE_SCHEMA,
    scope: "device",
    load() {},
    save() {},
  }), /compatible atomic Work coordination store/);

  assert.throws(() => assertWorkCoordinationStore({
    schema: WORK_COORDINATION_STORE_SCHEMA,
    scope: "device",
    load() {},
    compareAndSwap() {},
    save() {},
  }), /CAS-only.*save\(\).*forbidden/);

  assert.throws(() => assertWorkCoordinationStore({
    schema: WORK_COORDINATION_STORE_SCHEMA,
    scope: "device",
    load() {},
    compareAndSwap() {},
    delete() {},
  }), /CAS-only.*delete\(\).*forbidden/);

  const store = {
    schema: WORK_COORDINATION_STORE_SCHEMA,
    scope: "device",
    load() {},
    compareAndSwap() {},
  };
  assert.equal(assertWorkCoordinationStore(store), store);
});

test("machine-readable store policy defines explicit retention and fail-closed migration", async () => {
  const contract = JSON.parse(await readFile(
    new URL("../docs/contracts/work-coordination.json", import.meta.url),
    "utf8",
  ));

  assert.equal(contract.store.contract_defined, true);
  assert.equal(contract.store.cas_only_mutation_surface, true);
  assert.equal(contract.store.last_write_wins_alias_allowed, false);
  assert.equal(contract.store.format_version, 1);
  assert.equal(contract.store.unknown_format_behavior, "reject-fail-closed");
  assert.equal(contract.store.migration_owner, "native-storage-adapter");
  assert.equal(contract.store.retention.automatic_delete, false);
  assert.equal(contract.store.retention.archive_is_plan_state, true);
  assert.equal(contract.store.retention.delete_requires_partition_cas, true);
  assert.equal(contract.store.retention.memory_cascade, false);
  assert.equal(contract.store.native_durable_adapter_mounted, false);
});
