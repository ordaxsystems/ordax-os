import {
  validateWorkClaim,
  validateWorkCheckpoint,
  validateWorkEvidence,
  validateWorkPlan,
  validateWorkTask,
} from "./work-coordination.mjs";

export const WORK_COORDINATION_STORE_SCHEMA = "ordax.work-coordination-store/1";
export const WORK_COORDINATION_STORE_STATE_SCHEMA = "ordax.work-coordination-store-state/1";
export const WORK_COORDINATION_STORE_FORMAT_VERSION = 1;

export const MAX_WORK_COORDINATION_PLANS = 32;
export const MAX_WORK_COORDINATION_TASKS = 512;
export const MAX_WORK_COORDINATION_CLAIMS = 128;
export const MAX_WORK_COORDINATION_CHECKPOINTS = 512;
export const MAX_WORK_COORDINATION_EVIDENCE = 1024;
export const MAX_WORK_COORDINATION_STORE_BYTES = 4 * 1024 * 1024;

const encoder = new TextEncoder();
const OWNER_KINDS = new Set(["device", "account"]);
const STORE_SCOPES = new Set(["device", "session"]);
const TERMINAL_TASK_STATES = new Set(["completed", "cancelled"]);
const CLOSED_PLAN_STATES = new Set(["completed", "archived"]);
const FORBIDDEN_MUTATION_ALIASES = new Set([
  "save",
  "set",
  "put",
  "write",
  "update",
  "replace",
  "delete",
  "remove",
]);

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

function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return value;
}

function boundedArray(value, label, max) {
  if (!Array.isArray(value) || value.length > max) {
    throw new TypeError(`${label} exceeds its partition bound`);
  }
  return value;
}

export function validateWorkCoordinationPartition(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Work coordination partition must be an object");
  }
  if (!OWNER_KINDS.has(value.ownerKind)) {
    throw new TypeError("Work coordination partition owner kind is invalid");
  }
  const ownerId = value.ownerKind === "account"
    ? text(value.ownerId, "Work coordination partition owner id", 160)
    : null;
  if (value.ownerKind === "device" && value.ownerId != null && value.ownerId !== "") {
    throw new TypeError("Device Work coordination partition must not use synthetic owner id");
  }
  return Object.freeze({
    ownerKind: value.ownerKind,
    ownerId,
    projectId: optionalText(value.projectId, "Work coordination partition project id", 240),
  });
}

export function workCoordinationPartitionKey(value) {
  const partition = validateWorkCoordinationPartition(value);
  return JSON.stringify([
    partition.ownerKind,
    partition.ownerId,
    partition.projectId,
  ]);
}

export function createEmptyWorkCoordinationStoreState(partitionValue) {
  const partition = validateWorkCoordinationPartition(partitionValue);
  return Object.freeze({
    schema: WORK_COORDINATION_STORE_STATE_SCHEMA,
    formatVersion: WORK_COORDINATION_STORE_FORMAT_VERSION,
    ownerKind: partition.ownerKind,
    ownerId: partition.ownerId,
    projectId: partition.projectId,
    plans: Object.freeze([]),
    tasks: Object.freeze([]),
    claims: Object.freeze([]),
    checkpoints: Object.freeze([]),
    evidence: Object.freeze([]),
  });
}

function samePartition(left, right) {
  return left.ownerKind === right.ownerKind
    && left.ownerId === right.ownerId
    && left.projectId === right.projectId;
}

function assertUnique(values, label, keyOf = (value) => value.id) {
  const seen = new Set();
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) throw new TypeError(`${label} must be unique inside a partition`);
    seen.add(key);
  }
}

function assertDependencyGraph(tasks, taskById) {
  for (const task of tasks) {
    for (const dependencyId of task.dependsOnTaskIds) {
      const dependency = taskById.get(dependencyId);
      if (!dependency) {
        throw new TypeError("Work task dependency references missing task");
      }
      if (dependency.planId !== task.planId) {
        throw new TypeError("Work task dependency cannot cross plans");
      }
    }
  }

  const marks = new Map();
  function visit(task) {
    const mark = marks.get(task.id) ?? 0;
    if (mark === 1) throw new TypeError("Work task dependency graph contains a cycle");
    if (mark === 2) return;
    marks.set(task.id, 1);
    for (const dependencyId of task.dependsOnTaskIds) {
      visit(taskById.get(dependencyId));
    }
    marks.set(task.id, 2);
  }
  for (const task of tasks) visit(task);
}

function assertCompletedEvidence(tasks, evidence) {
  for (const task of tasks) {
    if (task.state !== "completed") continue;
    for (const kind of task.evidenceRequirements) {
      const matched = evidence.some((item) =>
        item.taskId === task.id
        && item.taskRevision === task.revision
        && item.kind === kind
        && item.verification === "verified"
      );
      if (!matched) {
        throw new TypeError("Completed Work task is missing required verified evidence");
      }
    }
  }
}

export function validateWorkCoordinationStoreState(value, expectedPartitionValue = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Work coordination store state must be an object");
  }
  if (value.schema !== WORK_COORDINATION_STORE_STATE_SCHEMA) {
    throw new TypeError("Work coordination store state schema is incompatible");
  }
  if (value.formatVersion !== WORK_COORDINATION_STORE_FORMAT_VERSION) {
    throw new TypeError("Work coordination store format version is incompatible");
  }
  const partition = validateWorkCoordinationPartition(value);
  if (expectedPartitionValue !== null) {
    const expected = validateWorkCoordinationPartition(expectedPartitionValue);
    if (!samePartition(partition, expected)) {
      throw new TypeError("Work coordination store state belongs to a different partition");
    }
  }

  const plans = Object.freeze(
    boundedArray(value.plans, "Work coordination plans", MAX_WORK_COORDINATION_PLANS)
      .map(validateWorkPlan),
  );
  assertUnique(plans, "Work plan ids");
  for (const plan of plans) {
    const planPartition = validateWorkCoordinationPartition(plan);
    if (!samePartition(planPartition, partition)) {
      throw new TypeError("Work plan cannot cross its coordination store partition");
    }
  }

  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const tasks = Object.freeze(
    boundedArray(value.tasks, "Work coordination tasks", MAX_WORK_COORDINATION_TASKS)
      .map(validateWorkTask),
  );
  assertUnique(tasks, "Work task ids");
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const retainedTaskIds = new Set();
  for (const plan of plans) {
    for (const taskId of plan.taskIds) {
      const task = taskById.get(taskId);
      if (!task || task.planId !== plan.id) {
        throw new TypeError("Work plan task ids must reference tasks from the same plan");
      }
      retainedTaskIds.add(taskId);
    }
  }
  for (const task of tasks) {
    if (!planById.has(task.planId)) {
      throw new TypeError("Work task cannot reference a missing plan");
    }
    if (!retainedTaskIds.has(task.id)) {
      throw new TypeError("Work task must be retained by its plan task list");
    }
  }
  assertDependencyGraph(tasks, taskById);

  const claims = Object.freeze(
    boundedArray(value.claims, "Work coordination claims", MAX_WORK_COORDINATION_CLAIMS)
      .map(validateWorkClaim),
  );
  assertUnique(claims, "Work claim ids");
  assertUnique(claims, "Work task active claims", (claim) => claim.taskId);
  for (const claim of claims) {
    const plan = planById.get(claim.planId);
    const task = taskById.get(claim.taskId);
    if (!plan || !task || task.planId !== plan.id) {
      throw new TypeError("Work claim cannot reference a missing or foreign plan/task");
    }
    if (claim.planRevision !== plan.revision || claim.taskRevision !== task.revision) {
      throw new TypeError("Work claim must bind the current plan/task revisions");
    }
    if (plan.state !== "active") {
      throw new TypeError("Active Work claim requires an active plan");
    }
    if (task.state !== "in-progress") {
      throw new TypeError("Active Work claim requires an in-progress task");
    }
  }

  const checkpoints = Object.freeze(
    boundedArray(
      value.checkpoints,
      "Work coordination checkpoints",
      MAX_WORK_COORDINATION_CHECKPOINTS,
    ).map(validateWorkCheckpoint),
  );
  const checkpointKeys = new Set();
  const previousByTask = new Map();
  for (const checkpoint of checkpoints) {
    const task = taskById.get(checkpoint.taskId);
    if (!task || task.planId !== checkpoint.planId) {
      throw new TypeError("Work checkpoint cannot reference a missing or foreign task");
    }
    if (checkpoint.taskRevision > task.revision) {
      throw new TypeError("Work checkpoint cannot reference a future task revision");
    }
    const key = `${checkpoint.taskId}:${checkpoint.taskRevision}:${checkpoint.sequence}`;
    if (checkpointKeys.has(key)) {
      throw new TypeError("Work checkpoint identity must be unique inside a partition");
    }
    checkpointKeys.add(key);
    const previous = previousByTask.get(checkpoint.taskId);
    if (previous) {
      if (checkpoint.taskRevision < previous.taskRevision) {
        throw new TypeError("Work checkpoint task revision must not regress");
      }
      if (
        checkpoint.taskRevision === previous.taskRevision
        && checkpoint.sequence <= previous.sequence
      ) {
        throw new TypeError("Work checkpoint sequence must increase per task revision");
      }
      if (Date.parse(checkpoint.createdAt) < Date.parse(previous.createdAt)) {
        throw new TypeError("Work checkpoint time must not regress per task");
      }
    }
    previousByTask.set(checkpoint.taskId, checkpoint);
  }

  const evidence = Object.freeze(
    boundedArray(value.evidence, "Work coordination evidence", MAX_WORK_COORDINATION_EVIDENCE)
      .map(validateWorkEvidence),
  );
  assertUnique(evidence, "Work evidence ids");
  for (const item of evidence) {
    const task = taskById.get(item.taskId);
    if (!task || task.planId !== item.planId) {
      throw new TypeError("Work evidence cannot reference a missing or foreign task");
    }
    if (item.taskRevision > task.revision) {
      throw new TypeError("Work evidence cannot reference a future task revision");
    }
  }
  assertCompletedEvidence(tasks, evidence);

  for (const plan of plans) {
    if (!CLOSED_PLAN_STATES.has(plan.state)) continue;
    const planTasks = plan.taskIds.map((taskId) => taskById.get(taskId));
    if (planTasks.some((task) => !TERMINAL_TASK_STATES.has(task.state))) {
      throw new TypeError("Completed or archived Work plan requires all retained tasks to be terminal");
    }
  }

  const snapshot = Object.freeze({
    schema: WORK_COORDINATION_STORE_STATE_SCHEMA,
    formatVersion: WORK_COORDINATION_STORE_FORMAT_VERSION,
    ownerKind: partition.ownerKind,
    ownerId: partition.ownerId,
    projectId: partition.projectId,
    plans,
    tasks,
    claims,
    checkpoints,
    evidence,
  });
  if (encoder.encode(JSON.stringify(snapshot)).byteLength > MAX_WORK_COORDINATION_STORE_BYTES) {
    throw new TypeError("Work coordination partition exceeds its serialized byte limit");
  }
  return snapshot;
}

export function validateWorkCoordinationStoreRecord(value, expectedPartitionValue = null) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Work coordination store record must be an object");
  }
  return Object.freeze({
    revision: integer(value.revision, "Work coordination store revision", { min: 1 }),
    state: validateWorkCoordinationStoreState(value.state, expectedPartitionValue),
  });
}

export function assertWorkCoordinationStore(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== WORK_COORDINATION_STORE_SCHEMA
    || !STORE_SCOPES.has(value.scope)
    || typeof value.load !== "function"
    || typeof value.compareAndSwap !== "function"
  ) {
    throw new TypeError("A compatible atomic Work coordination store is required");
  }
  for (const alias of FORBIDDEN_MUTATION_ALIASES) {
    if (typeof value[alias] === "function") {
      throw new TypeError(`Work coordination store mutation surface must be CAS-only; ${alias}() is forbidden`);
    }
  }
  return value;
}
