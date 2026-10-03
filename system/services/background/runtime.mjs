import { createHash, randomUUID } from "node:crypto";

import {
  BACKGROUND_CHECKPOINT_SCHEMA,
  BACKGROUND_RUN_SCHEMA,
  BACKGROUND_RUNTIME_SCHEMA,
  assertBackgroundStore,
  validateBackgroundBudgets,
  validateBackgroundRun,
} from "../../contracts/background-runtime.mjs";

const TERMINAL = new Set(["cancelled", "completed", "failed"]);
const IDEMPOTENCY_DOMAIN = "ordax.background-run.idempotency/1";

function epoch(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Background clock must return epoch milliseconds");
  return value;
}

function iso(value) {
  return new Date(value).toISOString();
}

function id(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 160 || value.includes("\0")) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.trim();
}

function optionalIdempotencyKey(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > 512 || value.includes("\0")) {
    throw new TypeError("Background idempotency key is invalid");
  }
  return value.trim();
}

function deterministicRunId(run, key) {
  const digest = createHash("sha256")
    .update(IDEMPOTENCY_DOMAIN)
    .update("\0")
    .update(run.consumerId)
    .update("\0")
    .update(run.ownerKind)
    .update("\0")
    .update(run.ownerId ?? "")
    .update("\0")
    .update(key)
    .digest("hex");
  return `idem-${digest}`;
}

function sameBudgets(left, right) {
  return left.wallClockMs === right.wallClockMs
    && left.stepLimit === right.stepLimit
    && left.actionLimit === right.actionLimit
    && left.egressBytesLimit === right.egressBytesLimit;
}

function sameCreationBinding(existing, requested) {
  return existing.consumerId === requested.consumerId
    && existing.subjectId === requested.subjectId
    && existing.ownerKind === requested.ownerKind
    && existing.ownerId === requested.ownerId
    && existing.spaceId === requested.spaceId
    && existing.projectId === requested.projectId
    && sameBudgets(existing.budgets, requested.budgets);
}

function boundedInteger(value, label, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new TypeError(`${label} is invalid`);
  return value;
}

async function load(store, runId) {
  const value = await store.get(id(runId, "Background run id"));
  if (value == null) throw new Error("Background run was not found");
  return validateBackgroundRun(value);
}

async function commit(store, current, nextValue) {
  const next = validateBackgroundRun({ ...nextValue, revision: current.revision + 1 });
  const swapped = await store.compareAndSwap(current.runId, current.revision, next);
  if (swapped !== true) throw new Error("Background run changed concurrently");
  return next;
}

function assertLease(run, leaseId, at) {
  if (run.state !== "running" || run.lease === null || run.lease.leaseId !== leaseId) {
    throw new Error("Background lease does not match the active run");
  }
  if (Date.parse(run.lease.expiresAt) <= at) throw new Error("Background lease has expired");
  if (Date.parse(run.deadlineAt) <= at) throw new Error("Background run deadline has expired");
  if (run.cancelRequestedAt !== null) throw new Error("Background run has been cancelled");
}

export function createBackgroundRuntime({
  store: storeValue,
  now = Date.now,
  idFactory = randomUUID,
  maxLeaseMs = 300_000,
} = {}) {
  const store = assertBackgroundStore(storeValue);
  if (typeof now !== "function" || typeof idFactory !== "function") throw new TypeError("Background runtime requires clock and id factory");
  if (!Number.isSafeInteger(maxLeaseMs) || maxLeaseMs < 5_000 || maxLeaseMs > 900_000) {
    throw new TypeError("Background max lease must be between 5 seconds and 15 minutes");
  }

  const runtime = {
    schema: BACKGROUND_RUNTIME_SCHEMA,

    async createRun({
      consumerId,
      subjectId,
      ownerKind,
      ownerId = null,
      spaceId = null,
      projectId = null,
      budgets,
      idempotencyKey = null,
    }) {
      const createdMs = epoch(now);
      const normalizedBudgets = validateBackgroundBudgets(budgets);
      const normalizedIdempotencyKey = optionalIdempotencyKey(idempotencyKey);
      const provisional = validateBackgroundRun({
        schema: BACKGROUND_RUN_SCHEMA,
        revision: 1,
        runId: normalizedIdempotencyKey === null
          ? id(idFactory(), "Background generated run id")
          : "idempotency-provisional",
        consumerId,
        subjectId,
        ownerKind,
        ownerId,
        spaceId,
        projectId,
        state: "queued",
        budgets: normalizedBudgets,
        usage: { steps: 0, actions: 0, egressBytes: 0 },
        createdAt: iso(createdMs),
        startedAt: null,
        deadlineAt: iso(createdMs + normalizedBudgets.wallClockMs),
        lease: null,
        checkpoint: null,
        cancelRequestedAt: null,
        finishedAt: null,
        failureCode: null,
        authority: "none",
      });
      const run = normalizedIdempotencyKey === null
        ? provisional
        : validateBackgroundRun({
            ...provisional,
            runId: deterministicRunId(provisional, normalizedIdempotencyKey),
          });

      if (await store.create(run) === true) return run;
      if (normalizedIdempotencyKey === null) {
        throw new Error("Background store refused run creation");
      }

      const existingValue = await store.get(run.runId);
      if (existingValue == null) {
        throw new Error("Background store refused idempotent run creation");
      }
      const existing = validateBackgroundRun(existingValue);
      if (!sameCreationBinding(existing, run)) {
        throw new Error("Background idempotency key is already bound to different work");
      }
      return existing;
    },

    async get(runId) {
      return await load(store, runId);
    },

    async acquireLease(runId, { workerId, leaseMs = 60_000 } = {}) {
      const at = epoch(now);
      const current = await load(store, runId);
      if (TERMINAL.has(current.state)) throw new Error("Terminal background run cannot be leased");
      if (current.cancelRequestedAt !== null) throw new Error("Cancelled background run cannot be leased");
      if (Date.parse(current.deadlineAt) <= at) {
        return await commit(store, current, {
          ...current,
          state: "failed",
          lease: null,
          finishedAt: iso(at),
          failureCode: "deadline-exceeded",
        });
      }
      if (current.state === "running" && Date.parse(current.lease.expiresAt) > at) {
        throw new Error("Background run already has an active lease");
      }
      const requestedLeaseMs = boundedInteger(leaseMs, "Background lease duration", maxLeaseMs);
      if (requestedLeaseMs < 5_000) throw new TypeError("Background lease duration is too short");
      const expiresMs = Math.min(at + requestedLeaseMs, Date.parse(current.deadlineAt));
      if (expiresMs <= at) throw new Error("Background run cannot obtain a lease past its deadline");

      return await commit(store, current, {
        ...current,
        state: "running",
        startedAt: current.startedAt ?? iso(at),
        lease: {
          leaseId: id(idFactory(), "Background generated lease id"),
          workerId: id(workerId, "Background worker id"),
          acquiredAt: iso(at),
          heartbeatAt: iso(at),
          expiresAt: iso(expiresMs),
        },
        failureCode: null,
      });
    },

    async reserveBudget(runId, leaseId, { steps = 0, actions = 0, egressBytes = 0 } = {}) {
      const at = epoch(now);
      const current = await load(store, runId);
      assertLease(current, id(leaseId, "Background lease id"), at);
      const delta = {
        steps: boundedInteger(steps, "Background reserved steps", 10_000),
        actions: boundedInteger(actions, "Background reserved actions", 1_000),
        egressBytes: boundedInteger(egressBytes, "Background reserved egress bytes", 1_073_741_824),
      };
      if (delta.steps + delta.actions + delta.egressBytes === 0) throw new TypeError("Background budget reservation cannot be empty");
      const usage = {
        steps: current.usage.steps + delta.steps,
        actions: current.usage.actions + delta.actions,
        egressBytes: current.usage.egressBytes + delta.egressBytes,
      };
      const fits = usage.steps <= current.budgets.stepLimit
        && usage.actions <= current.budgets.actionLimit
        && usage.egressBytes <= current.budgets.egressBytesLimit;
      if (!fits) {
        const paused = await commit(store, current, {
          ...current,
          state: "paused",
          lease: null,
          failureCode: "budget-exhausted",
        });
        return Object.freeze({ accepted: false, run: paused });
      }
      return Object.freeze({ accepted: true, run: await commit(store, current, { ...current, usage }) });
    },

    async heartbeat(runId, leaseId, { leaseMs = 60_000 } = {}) {
      const at = epoch(now);
      const current = await load(store, runId);
      assertLease(current, id(leaseId, "Background lease id"), at);
      const requestedLeaseMs = boundedInteger(leaseMs, "Background lease duration", maxLeaseMs);
      if (requestedLeaseMs < 5_000) throw new TypeError("Background lease duration is too short");
      return await commit(store, current, {
        ...current,
        lease: {
          ...current.lease,
          heartbeatAt: iso(at),
          expiresAt: iso(Math.min(at + requestedLeaseMs, Date.parse(current.deadlineAt))),
        },
      });
    },

    async checkpoint(runId, leaseId, { cursor = null, digest } = {}) {
      const at = epoch(now);
      const current = await load(store, runId);
      assertLease(current, id(leaseId, "Background lease id"), at);
      return await commit(store, current, {
        ...current,
        checkpoint: {
          schema: BACKGROUND_CHECKPOINT_SCHEMA,
          sequence: (current.checkpoint?.sequence ?? 0) + 1,
          cursor,
          digest,
          createdAt: iso(at),
        },
      });
    },

    async cancel(runId) {
      const at = epoch(now);
      const current = await load(store, runId);
      if (TERMINAL.has(current.state)) return current;
      return await commit(store, current, {
        ...current,
        state: "cancelled",
        lease: null,
        cancelRequestedAt: iso(at),
        finishedAt: iso(at),
        failureCode: null,
      });
    },

    async complete(runId, leaseId) {
      const at = epoch(now);
      const current = await load(store, runId);
      assertLease(current, id(leaseId, "Background lease id"), at);
      return await commit(store, current, {
        ...current,
        state: "completed",
        lease: null,
        finishedAt: iso(at),
        failureCode: null,
      });
    },

    async fail(runId, leaseId, failureCode) {
      const at = epoch(now);
      const current = await load(store, runId);
      assertLease(current, id(leaseId, "Background lease id"), at);
      return await commit(store, current, {
        ...current,
        state: "failed",
        lease: null,
        finishedAt: iso(at),
        failureCode: id(failureCode, "Background failure code"),
      });
    },

    async recover() {
      const at = epoch(now);
      const candidates = await store.listRecoverable();
      if (!Array.isArray(candidates) || candidates.length > 10_000) throw new Error("Background recovery set is invalid or unbounded");
      const recovered = [];
      for (const raw of candidates) {
        const current = validateBackgroundRun(raw);
        if (TERMINAL.has(current.state)) continue;
        if (Date.parse(current.deadlineAt) <= at) {
          recovered.push(await commit(store, current, {
            ...current,
            state: "failed",
            lease: null,
            finishedAt: iso(at),
            failureCode: "deadline-exceeded",
          }));
          continue;
        }
        if (current.state === "running" && Date.parse(current.lease.expiresAt) <= at) {
          recovered.push(await commit(store, current, {
            ...current,
            state: "paused",
            lease: null,
            failureCode: "lease-expired-recovery",
          }));
        }
      }
      return Object.freeze(recovered);
    },
  };

  return Object.freeze(runtime);
}
