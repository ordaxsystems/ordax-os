import {
  WORK_COORDINATION_MAX_CLAIM_LEASE_MS,
  validateWorkClaim,
  validateWorkCoordinationPolicy,
  validateWorkEvidence,
  validateWorkPlan,
  validateWorkTask,
} from "../../contracts/work-coordination.mjs";
import {
  assertWorkCoordinationStore,
  createEmptyWorkCoordinationStoreState,
  validateWorkCoordinationPartition,
  validateWorkCoordinationStoreRecord,
  validateWorkCoordinationStoreState,
} from "../../contracts/work-coordination-store.mjs";

export const WORK_COORDINATION_RUNTIME_SCHEMA = "ordax.work-coordination-runtime/1";

const MUTATION_TRIGGERS = new Set(["user", "system"]);
const CLAIMABLE_TASK_STATE = "ready";
const STALE_BLOCK_REASON = "stale-claim-reconciliation-required";

function epoch(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Work coordination clock must return epoch milliseconds");
  }
  return value;
}

function iso(value) {
  return new Date(value).toISOString();
}

function text(value, label, max = 256) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function optionalText(value, label, max = 256) {
  return value == null || value === "" ? null : text(value, label, max);
}

function leaseMs(value) {
  if (!Number.isSafeInteger(value) || value < 5_000 || value > WORK_COORDINATION_MAX_CLAIM_LEASE_MS) {
    throw new TypeError("Work claim lease duration must be between 5 seconds and 15 minutes");
  }
  return value;
}

function trigger(value) {
  if (!MUTATION_TRIGGERS.has(value)) {
    throw new TypeError("Work coordination mutation trigger is invalid");
  }
  return value;
}

function defaultIdFactory() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid !== "string" || !uuid) {
    throw new Error("Work coordination runtime requires an id factory");
  }
  return uuid;
}

function replaceById(values, id, next) {
  return values.map((value) => value.id === id ? next : value);
}

function effectiveTaskReady(task, taskById) {
  return task.state === CLAIMABLE_TASK_STATE
    && task.dependsOnTaskIds.every((dependencyId) => taskById.get(dependencyId)?.state === "completed");
}

function promoteReadyTasks(tasks) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  let changed = false;
  const promoted = tasks.map((task) => {
    if (task.state !== "planned") return task;
    if (!task.dependsOnTaskIds.every((dependencyId) => taskById.get(dependencyId)?.state === "completed")) {
      return task;
    }
    changed = true;
    return validateWorkTask({
      ...task,
      state: "ready",
      updatedAt: task.updatedAt,
    });
  });
  return changed ? promoted : tasks;
}

async function effectivePolicy(resolvePolicy, partition) {
  const raw = await resolvePolicy(partition);
  if (raw == null) throw new Error("Work coordination is not configured for this context");
  const policy = validateWorkCoordinationPolicy(raw);
  if (policy.scope === "project" && policy.projectId !== partition.projectId) {
    throw new Error("Work coordination policy belongs to a different project");
  }
  if (policy.mode === "off") throw new Error("Work coordination is disabled");
  return policy;
}

async function assertMutationAllowed(resolvePolicy, partition, mutationTrigger) {
  const policy = await effectivePolicy(resolvePolicy, partition);
  const normalizedTrigger = trigger(mutationTrigger);
  if (normalizedTrigger === "system" && policy.mode !== "automatic") {
    throw new Error("System-initiated coordination requires automatic mode");
  }
  return policy;
}

async function loadRecord(store, partition) {
  const raw = await store.load(partition);
  if (raw == null) {
    return Object.freeze({
      revision: 0,
      state: createEmptyWorkCoordinationStoreState(partition),
    });
  }
  return validateWorkCoordinationStoreRecord(raw, partition);
}

async function commit(store, partition, currentRecord, nextStateValue) {
  const nextState = validateWorkCoordinationStoreState(nextStateValue, partition);
  const swapped = await store.compareAndSwap(partition, currentRecord.revision, nextState);
  if (swapped !== true) {
    throw new Error("Work coordination state changed concurrently");
  }
  return Object.freeze({
    revision: currentRecord.revision + 1,
    state: nextState,
  });
}

function activeClaim(state, claimId, leaseId, nowMs) {
  const claim = state.claims.find((item) => item.id === claimId);
  if (!claim || claim.leaseId !== leaseId) {
    throw new Error("Work claim does not match the active lease");
  }
  if (Date.parse(claim.expiresAt) <= nowMs) {
    throw new Error("Work claim lease has expired");
  }
  const task = state.tasks.find((item) => item.id === claim.taskId);
  const plan = state.plans.find((item) => item.id === claim.planId);
  if (!task || !plan || task.state !== "in-progress") {
    throw new Error("Work claim no longer matches active task state");
  }
  if (task.revision !== claim.taskRevision || plan.revision !== claim.planRevision) {
    throw new Error("Work claim revision is stale");
  }
  return Object.freeze({ claim, task, plan });
}

function completedEvidenceSatisfied(state, task) {
  return task.evidenceRequirements.every((kind) => state.evidence.some((item) =>
    item.planId === task.planId
    && item.taskId === task.id
    && item.taskRevision === task.revision
    && item.kind === kind
    && item.verification === "verified"
  ));
}

function nextCheckpointSequence(state, taskId, taskRevision) {
  return state.checkpoints.reduce((highest, checkpoint) => {
    if (checkpoint.taskId !== taskId || checkpoint.taskRevision !== taskRevision) return highest;
    return Math.max(highest, checkpoint.sequence);
  }, 0) + 1;
}

export function createWorkCoordinationRuntime({
  store: storeValue,
  resolvePolicy,
  verifyEvidence = null,
  now = Date.now,
  idFactory = defaultIdFactory,
} = {}) {
  const store = assertWorkCoordinationStore(storeValue);
  if (typeof resolvePolicy !== "function") {
    throw new TypeError("Work coordination runtime requires an effective policy resolver");
  }
  if (verifyEvidence !== null && typeof verifyEvidence !== "function") {
    throw new TypeError("Work coordination evidence verifier must be a function");
  }
  if (typeof now !== "function" || typeof idFactory !== "function") {
    throw new TypeError("Work coordination runtime requires clock and id factory");
  }

  const runtime = {
    schema: WORK_COORDINATION_RUNTIME_SCHEMA,

    async get(partitionValue) {
      const partition = validateWorkCoordinationPartition(partitionValue);
      return await loadRecord(store, partition);
    },

    async listReady(partitionValue) {
      const partition = validateWorkCoordinationPartition(partitionValue);
      const record = await loadRecord(store, partition);
      const taskById = new Map(record.state.tasks.map((task) => [task.id, task]));
      const claimed = new Set(record.state.claims.map((claim) => claim.taskId));
      return Object.freeze(record.state.tasks.filter((task) =>
        !claimed.has(task.id) && effectiveTaskReady(task, taskById)
      ));
    },

    async createPlan(partitionValue, {
      planId = null,
      title,
      objective,
      spaceId = null,
      workItemId = null,
      tasks: taskInputs,
      trigger: mutationTrigger = "user",
    } = {}) {
      const partition = validateWorkCoordinationPartition(partitionValue);
      await assertMutationAllowed(resolvePolicy, partition, mutationTrigger);
      if (!Array.isArray(taskInputs) || taskInputs.length < 1 || taskInputs.length > 128) {
        throw new TypeError("Work plan creation requires 1 to 128 tasks");
      }
      const at = epoch(now);
      const current = await loadRecord(store, partition);
      const resolvedPlanId = planId == null
        ? text(idFactory(), "Generated Work plan id", 160)
        : text(planId, "Work plan id", 160);
      if (current.state.plans.some((plan) => plan.id === resolvedPlanId)) {
        throw new Error("Work plan id already exists");
      }

      const ids = new Set();
      for (const input of taskInputs) {
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          throw new TypeError("Work plan task input must be an object");
        }
        const taskId = text(input.id, "Work task input id", 160);
        if (ids.has(taskId)) throw new TypeError("Work plan task input ids must be unique");
        ids.add(taskId);
      }

      const newTasks = taskInputs.map((input) => {
        const dependencies = input.dependsOnTaskIds ?? [];
        return validateWorkTask({
          revision: 1,
          id: input.id,
          planId: resolvedPlanId,
          title: input.title,
          objective: input.objective,
          state: dependencies.length === 0 ? "ready" : "planned",
          dependsOnTaskIds: dependencies,
          evidenceRequirements: input.evidenceRequirements ?? [],
          authority: "none",
          createdAt: iso(at),
          updatedAt: iso(at),
          completedAt: null,
        });
      });

      const newPlan = validateWorkPlan({
        revision: 1,
        id: resolvedPlanId,
        ownerKind: partition.ownerKind,
        ownerId: partition.ownerId,
        spaceId,
        projectId: partition.projectId,
        workItemId,
        title,
        objective,
        state: "active",
        taskIds: newTasks.map((task) => task.id),
        authority: "none",
        createdAt: iso(at),
        updatedAt: iso(at),
      });

      return await commit(store, partition, current, {
        ...current.state,
        plans: [...current.state.plans, newPlan],
        tasks: [...current.state.tasks, ...newTasks],
      });
    },

    async claimTask(partitionValue, taskIdValue, {
      workerKind,
      workerRef,
      clientRef = null,
      sessionRef = null,
      leaseDurationMs = 60_000,
      trigger: mutationTrigger = "user",
    } = {}) {
      const partition = validateWorkCoordinationPartition(partitionValue);
      await assertMutationAllowed(resolvePolicy, partition, mutationTrigger);
      const at = epoch(now);
      const current = await loadRecord(store, partition);
      const taskId = text(taskIdValue, "Work task id", 160);
      const task = current.state.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error("Work task was not found");
      const plan = current.state.plans.find((item) => item.id === task.planId);
      if (!plan || plan.state !== "active") throw new Error("Work task plan is not active");
      const existingClaim = current.state.claims.find((claim) => claim.taskId === task.id);
      if (existingClaim) {
        if (Date.parse(existingClaim.expiresAt) <= at) {
          throw new Error("Work task has a stale claim that requires reconciliation");
        }
        throw new Error("Work task already has an active claim");
      }
      const taskById = new Map(current.state.tasks.map((item) => [item.id, item]));
      if (!effectiveTaskReady(task, taskById)) {
        throw new Error("Work task is not ready to be claimed");
      }
      const duration = leaseMs(leaseDurationMs);
      const inProgressTask = validateWorkTask({
        ...task,
        state: "in-progress",
        updatedAt: iso(at),
      });
      const claim = validateWorkClaim({
        id: text(idFactory(), "Generated Work claim id", 160),
        planId: plan.id,
        taskId: task.id,
        planRevision: plan.revision,
        taskRevision: task.revision,
        workerKind,
        workerRef,
        clientRef,
        sessionRef,
        leaseId: text(idFactory(), "Generated Work lease id", 160),
        acquiredAt: iso(at),
        heartbeatAt: iso(at),
        expiresAt: iso(at + duration),
        authority: "none",
      });
      return await commit(store, partition, current, {
        ...current.state,
        tasks: replaceById(current.state.tasks, task.id, inProgressTask),
        claims: [...current.state.claims, claim],
      });
    },

    async heartbeat(partitionValue, claimIdValue, leaseIdValue, {
      leaseDurationMs = 60_000,
      trigger: mutationTrigger = "user",
    } = {}) {
      const partition = validateWorkCoordinationPartition(partitionValue);
      await assertMutationAllowed(resolvePolicy, partition, mutationTrigger);
      const at = epoch(now);
      const current = await loadRecord(store, partition);
      const claimId = text(claimIdValue, "Work claim id", 160);
      const leaseIdValueNormalized = text(leaseIdValue, "Work lease id", 160);
      const active = activeClaim(current.state, claimId, leaseIdValueNormalized, at);
      const renewed = validateWorkClaim({
        ...active.claim,
        heartbeatAt: iso(at),
        expiresAt: iso(at + leaseMs(leaseDurationMs)),
      });
      return await commit(store, partition, current, {
        ...current.state,
        claims: replaceById(current.state.claims, active.claim.id, renewed),
      });
    },

    async checkpoint(partitionValue, claimIdValue, leaseIdValue, {
      summary,
      resumeRef = null,
      artifactRefs = [],
      trigger: mutationTrigger = "user",
    } = {}) {
      const partition = validateWorkCoordinationPartition(partitionValue);
      await assertMutationAllowed(resolvePolicy, partition, mutationTrigger);
      const at = epoch(now);
      const current = await loadRecord(store, partition);
      const active = activeClaim(
        current.state,
        text(claimIdValue, "Work claim id", 160),
        text(leaseIdValue, "Work lease id", 160),
        at,
      );
      const checkpoint = {
        schema: "ordax.work-checkpoint/1",
        planId: active.plan.id,
        taskId: active.task.id,
        taskRevision: active.task.revision,
        claimId: active.claim.id,
        leaseId: active.claim.leaseId,
        sequence: nextCheckpointSequence(current.state, active.task.id, active.task.revision),
        summary,
        resumeRef,
        artifactRefs,
        authority: "none",
        createdAt: iso(at),
      };
      return await commit(store, partition, current, {
        ...current.state,
        checkpoints: [...current.state.checkpoints, checkpoint],
      });
    },

    async handoff(partitionValue, claimIdValue, leaseIdValue, {
      summary = null,
      resumeRef = null,
      artifactRefs = [],
      trigger: mutationTrigger = "user",
    } = {}) {
      const partition = validateWorkCoordinationPartition(partitionValue);
      await assertMutationAllowed(resolvePolicy, partition, mutationTrigger);
      const at = epoch(now);
      const current = await loadRecord(store, partition);
      const active = activeClaim(
        current.state,
        text(claimIdValue, "Work claim id", 160),
        text(leaseIdValue, "Work lease id", 160),
        at,
      );
      const checkpoints = [...current.state.checkpoints];
      if (summary !== null) {
        checkpoints.push({
          schema: "ordax.work-checkpoint/1",
          planId: active.plan.id,
          taskId: active.task.id,
          taskRevision: active.task.revision,
          claimId: active.claim.id,
          leaseId: active.claim.leaseId,
          sequence: nextCheckpointSequence(current.state, active.task.id, active.task.revision),
          summary,
          resumeRef,
          artifactRefs,
          authority: "none",
          createdAt: iso(at),
        });
      }
      const readyTask = validateWorkTask({
        ...active.task,
        state: "ready",
        updatedAt: iso(at),
      });
      return await commit(store, partition, current, {
        ...current.state,
        tasks: replaceById(current.state.tasks, active.task.id, readyTask),
        claims: current.state.claims.filter((claim) => claim.id !== active.claim.id),
        checkpoints,
      });
    },

    async recordEvidence(partitionValue, taskIdValue, evidenceInput, {
      trigger: mutationTrigger = "user",
    } = {}) {
      const partition = validateWorkCoordinationPartition(partitionValue);
      await assertMutationAllowed(resolvePolicy, partition, mutationTrigger);
      if (verifyEvidence === null) {
        throw new Error("Work coordination evidence verification is unavailable");
      }
      const current = await loadRecord(store, partition);
      const taskId = text(taskIdValue, "Work task id", 160);
      const task = current.state.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error("Work task was not found");
      const plan = current.state.plans.find((item) => item.id === task.planId);
      if (!plan) throw new Error("Work task plan was not found");
      const verifiedValue = await verifyEvidence(Object.freeze({
        partition,
        plan,
        task,
        input: evidenceInput,
      }));
      const evidence = validateWorkEvidence(verifiedValue);
      if (
        evidence.planId !== plan.id
        || evidence.taskId !== task.id
        || evidence.taskRevision !== task.revision
      ) {
        throw new Error("Verified Work evidence does not match the current task revision");
      }
      if (evidence.verification !== "verified") {
        throw new Error("Work evidence verifier did not produce verified evidence");
      }
      if (current.state.evidence.some((item) => item.id === evidence.id)) {
        throw new Error("Work evidence id already exists");
      }
      return await commit(store, partition, current, {
        ...current.state,
        evidence: [...current.state.evidence, evidence],
      });
    },

    async completeTask(partitionValue, claimIdValue, leaseIdValue, {
      trigger: mutationTrigger = "user",
    } = {}) {
      const partition = validateWorkCoordinationPartition(partitionValue);
      await assertMutationAllowed(resolvePolicy, partition, mutationTrigger);
      const at = epoch(now);
      const current = await loadRecord(store, partition);
      const active = activeClaim(
        current.state,
        text(claimIdValue, "Work claim id", 160),
        text(leaseIdValue, "Work lease id", 160),
        at,
      );
      if (!completedEvidenceSatisfied(current.state, active.task)) {
        throw new Error("Work task completion evidence is incomplete");
      }
      const completedTask = validateWorkTask({
        ...active.task,
        state: "completed",
        updatedAt: iso(at),
        completedAt: iso(at),
      });
      let tasks = replaceById(current.state.tasks, active.task.id, completedTask);
      tasks = promoteReadyTasks(tasks);

      const remainingClaims = current.state.claims.filter((claim) => claim.id !== active.claim.id);
      let plans = current.state.plans;
      const planTasks = tasks.filter((task) => task.planId === active.plan.id);
      if (planTasks.every((task) => task.state === "completed" || task.state === "cancelled")) {
        const completedPlan = validateWorkPlan({
          ...active.plan,
          state: "completed",
          updatedAt: iso(at),
        });
        plans = replaceById(plans, active.plan.id, completedPlan);
      }

      return await commit(store, partition, current, {
        ...current.state,
        plans,
        tasks,
        claims: remainingClaims,
      });
    },

    async recoverExpiredClaims(partitionValue) {
      const partition = validateWorkCoordinationPartition(partitionValue);
      const at = epoch(now);
      const current = await loadRecord(store, partition);
      const expired = current.state.claims.filter((claim) => Date.parse(claim.expiresAt) <= at);
      if (expired.length === 0) return current;
      const expiredTaskIds = new Set(expired.map((claim) => claim.taskId));
      const tasks = current.state.tasks.map((task) => {
        if (!expiredTaskIds.has(task.id) || task.state !== "in-progress") return task;
        return validateWorkTask({
          ...task,
          state: "blocked",
          blockedReason: STALE_BLOCK_REASON,
          updatedAt: iso(at),
        });
      });
      return await commit(store, partition, current, {
        ...current.state,
        tasks,
        claims: current.state.claims.filter((claim) => !expiredTaskIds.has(claim.taskId)),
      });
    },

    async releaseStaleTask(partitionValue, taskIdValue, {
      trigger: mutationTrigger = "user",
    } = {}) {
      const partition = validateWorkCoordinationPartition(partitionValue);
      await assertMutationAllowed(resolvePolicy, partition, mutationTrigger);
      const at = epoch(now);
      const current = await loadRecord(store, partition);
      const taskId = text(taskIdValue, "Work task id", 160);
      const task = current.state.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error("Work task was not found");
      if (task.state !== "blocked" || task.blockedReason !== STALE_BLOCK_REASON) {
        throw new Error("Work task is not awaiting stale-claim reconciliation");
      }
      if (current.state.claims.some((claim) => claim.taskId === task.id)) {
        throw new Error("Stale Work task still has a retained claim");
      }
      const readyTask = validateWorkTask({
        ...task,
        state: "ready",
        blockedReason: null,
        updatedAt: iso(at),
      });
      return await commit(store, partition, current, {
        ...current.state,
        tasks: replaceById(current.state.tasks, task.id, readyTask),
      });
    },
  };

  return Object.freeze(runtime);
}
