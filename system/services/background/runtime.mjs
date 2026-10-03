import {
  BACKGROUND_CHECKPOINT_SCHEMA,
  BACKGROUND_EFFECT_DECISION_SCHEMA,
  BACKGROUND_RUN_SCHEMA,
  BACKGROUND_SNAPSHOT_SCHEMA,
  validateBackgroundCheckpoint,
  validateBackgroundEffectDecision,
  validateBackgroundPolicy,
  validateBackgroundRun,
  validateBackgroundSnapshot,
} from "../../contracts/background-runtime.mjs";

const TERMINAL = new Set(["completed", "cancelled", "failed", "exhausted"]);

function iso(ms) {
  return new Date(ms).toISOString();
}

export function createBackgroundRuntime({
  clockMs = () => Date.now(),
  idFactory = (() => {
    let sequence = 0;
    return () => `background-run-${++sequence}`;
  })(),
} = {}) {
  if (typeof clockMs !== "function" || typeof idFactory !== "function") {
    throw new TypeError("Background runtime dependencies are invalid");
  }

  const policies = new Map();
  const runs = new Map();
  const checkpoints = new Map();

  const getStored = (runId) => {
    const run = runs.get(runId);
    if (!run) throw new Error(`Unknown background run: ${runId}`);
    return run;
  };

  const storeRun = (value) => {
    const run = validateBackgroundRun(value);
    runs.set(run.runId, run);
    return run;
  };

  const reconcileTime = (runId) => {
    const current = getStored(runId);
    if (current.state !== "active") return current;
    const now = clockMs();
    if (now >= Date.parse(current.deadlineAt)) {
      return storeRun({
        ...current,
        state: "exhausted",
        updatedAt: iso(now),
        leaseExpiresAt: null,
        terminalReason: "wall-clock-budget-exhausted",
      });
    }
    if (current.leaseExpiresAt !== null && now >= Date.parse(current.leaseExpiresAt)) {
      return storeRun({
        ...current,
        state: "paused",
        updatedAt: iso(now),
        leaseExpiresAt: null,
        recoveryRequired: true,
        terminalReason: "lease-expired",
      });
    }
    return current;
  };

  const requireActive = (runId) => {
    const run = reconcileTime(runId);
    if (run.state !== "active") throw new Error(`Background run is not active: ${run.state}`);
    return run;
  };

  const transition = (runId, state, reason = null) => {
    const current = getStored(runId);
    if (TERMINAL.has(current.state)) throw new Error(`Background run is terminal: ${current.state}`);
    const now = clockMs();
    return storeRun({
      ...current,
      state,
      updatedAt: iso(now),
      leaseExpiresAt: state === "active" ? current.leaseExpiresAt : null,
      recoveryRequired: false,
      terminalReason: reason,
    });
  };

  const api = {
    start(policyInput, { runId = idFactory() } = {}) {
      const policy = validateBackgroundPolicy(policyInput);
      if (policies.has(policy.policyId)) throw new Error(`Duplicate background policy id: ${policy.policyId}`);
      if (runs.has(runId)) throw new Error(`Duplicate background run id: ${runId}`);
      const now = clockMs();
      const deadlineMs = now + policy.limits.maxWallClockMs;
      policies.set(policy.policyId, policy);
      return storeRun({
        schema: BACKGROUND_RUN_SCHEMA,
        runId,
        policyId: policy.policyId,
        ownerKind: policy.ownerKind,
        ownerId: policy.ownerId,
        workItemId: policy.workItemId,
        state: "active",
        startedAt: iso(now),
        updatedAt: iso(now),
        deadlineAt: iso(deadlineMs),
        leaseExpiresAt: iso(Math.min(now + policy.limits.leaseMs, deadlineMs)),
        usage: { steps: 0, actions: 0, egressBytes: 0 },
        checkpointRevision: 0,
        recoveryRequired: false,
        terminalReason: null,
      });
    },

    get(runId) {
      return reconcileTime(runId);
    },

    list() {
      return Object.freeze([...runs.keys()].sort().map((runId) => reconcileTime(runId)));
    },

    assertEffectAllowed(runId, effect) {
      const run = requireActive(runId);
      const policy = policies.get(run.policyId);
      if (!policy) throw new Error("Background policy is unavailable");
      const allowed = policy.allowedEffects.includes(effect);
      return validateBackgroundEffectDecision({
        schema: BACKGROUND_EFFECT_DECISION_SCHEMA,
        runId,
        effect,
        allowed,
        reasonCode: allowed ? "background.policy.allows-observation" : "background.policy.denies-effect",
      });
    },

    consume(runId, { steps = 0, actions = 0, egressBytes = 0 } = {}) {
      const run = requireActive(runId);
      const policy = policies.get(run.policyId);
      if (!policy) throw new Error("Background policy is unavailable");
      for (const [value, label] of [[steps, "steps"], [actions, "actions"], [egressBytes, "egress bytes"]]) {
        if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Background ${label} consumption is invalid`);
      }
      const next = {
        steps: run.usage.steps + steps,
        actions: run.usage.actions + actions,
        egressBytes: run.usage.egressBytes + egressBytes,
      };
      if (next.steps > policy.limits.maxSteps || next.actions > policy.limits.maxActions || next.egressBytes > policy.limits.maxEgressBytes) {
        storeRun({
          ...run,
          state: "exhausted",
          updatedAt: iso(clockMs()),
          leaseExpiresAt: null,
          usage: next,
          terminalReason: "resource-budget-exhausted",
        });
        throw new Error("Background resource budget exhausted");
      }
      return storeRun({ ...run, updatedAt: iso(clockMs()), usage: next });
    },

    renewLease(runId) {
      const run = requireActive(runId);
      const policy = policies.get(run.policyId);
      if (!policy) throw new Error("Background policy is unavailable");
      const now = clockMs();
      return storeRun({
        ...run,
        updatedAt: iso(now),
        leaseExpiresAt: iso(Math.min(now + policy.limits.leaseMs, Date.parse(run.deadlineAt))),
      });
    },

    checkpoint(runId, { cursor = null, summary = null } = {}) {
      const run = requireActive(runId);
      const checkpoint = validateBackgroundCheckpoint({
        schema: BACKGROUND_CHECKPOINT_SCHEMA,
        runId,
        workItemId: run.workItemId,
        revision: run.checkpointRevision + 1,
        createdAt: iso(clockMs()),
        cursor,
        summary,
      });
      checkpoints.set(runId, checkpoint);
      storeRun({ ...run, updatedAt: checkpoint.createdAt, checkpointRevision: checkpoint.revision });
      return checkpoint;
    },

    pause(runId, reason = "paused") {
      return transition(runId, "paused", reason);
    },

    resume(runId) {
      const current = getStored(runId);
      if (current.state !== "paused") throw new Error(`Background run cannot resume from state: ${current.state}`);
      if (current.recoveryRequired) throw new Error("Background run requires external recovery reconciliation");
      const policy = policies.get(current.policyId);
      if (!policy) throw new Error("Background policy is unavailable");
      const now = clockMs();
      if (now >= Date.parse(current.deadlineAt)) {
        return storeRun({ ...current, state: "exhausted", updatedAt: iso(now), terminalReason: "wall-clock-budget-exhausted" });
      }
      return storeRun({
        ...current,
        state: "active",
        updatedAt: iso(now),
        leaseExpiresAt: iso(Math.min(now + policy.limits.leaseMs, Date.parse(current.deadlineAt))),
        terminalReason: null,
      });
    },

    cancel(runId, reason = "cancelled") {
      return transition(runId, "cancelled", reason);
    },

    complete(runId) {
      requireActive(runId);
      return transition(runId, "completed", "completed");
    },

    fail(runId, reason = "failed") {
      return transition(runId, "failed", reason);
    },

    snapshot() {
      return validateBackgroundSnapshot({
        schema: BACKGROUND_SNAPSHOT_SCHEMA,
        runs: [...runs.values()],
        checkpoints: [...checkpoints.values()],
      });
    },

    restore(snapshotInput, policyInputs = []) {
      if (runs.size > 0 || policies.size > 0 || checkpoints.size > 0) {
        throw new Error("Background restore requires an empty runtime");
      }
      const snapshot = validateBackgroundSnapshot(snapshotInput);
      for (const input of policyInputs) {
        const policy = validateBackgroundPolicy(input);
        if (policies.has(policy.policyId)) throw new Error(`Duplicate background policy id: ${policy.policyId}`);
        policies.set(policy.policyId, policy);
      }
      const now = clockMs();
      for (const sourceRun of snapshot.runs) {
        if (!policies.has(sourceRun.policyId)) throw new Error(`Missing background policy during restore: ${sourceRun.policyId}`);
        storeRun(sourceRun.state === "active" ? {
          ...sourceRun,
          state: "paused",
          updatedAt: iso(now),
          leaseExpiresAt: null,
          recoveryRequired: true,
          terminalReason: "restored-active-run",
        } : sourceRun);
      }
      for (const checkpoint of snapshot.checkpoints) {
        if (!runs.has(checkpoint.runId)) throw new Error(`Checkpoint references unknown background run: ${checkpoint.runId}`);
        checkpoints.set(checkpoint.runId, checkpoint);
      }
      return api.list();
    },
  };

  return Object.freeze(api);
}
