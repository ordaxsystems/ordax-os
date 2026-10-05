import assert from "node:assert/strict";
import test from "node:test";

import { BACKGROUND_POLICY_SCHEMA } from "../system/contracts/background-runtime.mjs";
import { createBackgroundRuntime } from "../system/services/background/runtime.mjs";

const BASE_TIME = 1_700_000_000_000;

function policy(overrides = {}) {
  return {
    schema: BACKGROUND_POLICY_SCHEMA,
    policyId: "policy-restore",
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
  };
}

function sourceSnapshot({ checkpoint = false } = {}) {
  const source = createBackgroundRuntime({
    clockMs: () => BASE_TIME,
    idFactory: () => "run-restore",
  });
  source.start(policy());
  if (checkpoint) source.checkpoint("run-restore", { cursor: "cursor-1", summary: "checkpoint" });
  return structuredClone(source.snapshot());
}

function assertRestoreFailsWithoutPartialState(snapshot, policies, pattern) {
  const restored = createBackgroundRuntime({ clockMs: () => BASE_TIME + 1_000 });
  assert.throws(() => restored.restore(snapshot, policies), pattern);
  assert.deepEqual(restored.list(), []);
}

test("restore rejects same policy id rebound to another owner", () => {
  assertRestoreFailsWithoutPartialState(
    sourceSnapshot(),
    [policy({ ownerId: "owner-2" })],
    /policy binding/,
  );
});

test("restore rejects policy rebound to another work item", () => {
  assertRestoreFailsWithoutPartialState(
    sourceSnapshot(),
    [policy({ workItemId: "work-2" })],
    /policy binding/,
  );
});

test("restore rejects duplicate run ids transactionally", () => {
  const snapshot = sourceSnapshot();
  snapshot.runs.push(structuredClone(snapshot.runs[0]));
  assertRestoreFailsWithoutPartialState(snapshot, [policy()], /Duplicate background run id/);
});

test("restore rejects deadline or usage outside the bound policy", () => {
  const deadline = sourceSnapshot();
  deadline.runs[0].deadlineAt = new Date(BASE_TIME + 120_000).toISOString();
  assertRestoreFailsWithoutPartialState(deadline, [policy()], /deadline/);

  const usage = sourceSnapshot();
  usage.runs[0].usage.steps = 5;
  assertRestoreFailsWithoutPartialState(usage, [policy()], /usage exceeds/);
});

test("restore requires one exact checkpoint matching run revision and work item", () => {
  const wrongWork = sourceSnapshot({ checkpoint: true });
  wrongWork.checkpoints[0].workItemId = "other-work";
  assertRestoreFailsWithoutPartialState(wrongWork, [policy()], /checkpoint work item/);

  const missing = sourceSnapshot({ checkpoint: true });
  missing.checkpoints = [];
  assertRestoreFailsWithoutPartialState(missing, [policy()], /Missing background checkpoint/);

  const duplicate = sourceSnapshot({ checkpoint: true });
  duplicate.checkpoints.push(structuredClone(duplicate.checkpoints[0]));
  assertRestoreFailsWithoutPartialState(duplicate, [policy()], /Duplicate background checkpoint/);
});

test("restored active run whose wall-clock budget elapsed becomes exhausted", () => {
  const restored = createBackgroundRuntime({ clockMs: () => BASE_TIME + 60_001 });
  restored.restore(sourceSnapshot(), [policy()]);
  const run = restored.get("run-restore");
  assert.equal(run.state, "exhausted");
  assert.equal(run.recoveryRequired, false);
  assert.equal(run.leaseExpiresAt, null);
  assert.equal(run.terminalReason, "restored-active-run-budget-expired");
});
