import {
  validatePersonalActivityEvent,
  validatePersonalActionDecision,
  validatePersonalApproval,
  validatePersonalWorkItem,
  validatePersonalWorkResult,
} from "../../contracts/personal-ordax.mjs";
import {
  MAX_PERSONAL_ACTION_DECISIONS,
  MAX_PERSONAL_ACTIVITY_EVENTS,
  MAX_PERSONAL_APPROVALS,
  MAX_PERSONAL_WORK_ITEMS,
  MAX_PERSONAL_WORK_RESULTS,
  PERSONAL_ORDAX_RUNTIME_SCHEMA,
  assertPersonalOrdaxStore,
  createEmptyPersonalOrdaxStoreState,
  personalOrdaxOwnerKey,
  validatePersonalOrdaxOwner,
  validatePersonalOrdaxRuntimeSnapshot,
  validatePersonalOrdaxStoreState,
} from "../../contracts/personal-ordax-store.mjs";
import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import {
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";
import {
  assertProjectCatalogPort,
  validateProjectCatalogSnapshot,
} from "../../contracts/project-catalog.mjs";
import {
  validateActionReceipt,
  validateAuthorizedActionExecution,
} from "../../contracts/action-executor.mjs";
import { assertActionGateway } from "../../contracts/action-gateway.mjs";
import {
  assertIntelligencePort,
  validateIntelligenceResponse,
  validateIntelligenceSnapshot,
} from "../../contracts/intelligence.mjs";

const ACTIVE_STATES = new Set(["queued", "running", "waiting-approval"]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Personal OrdaX clock must return a non-negative epoch millisecond");
  }
  return value;
}

function isoClock(now) {
  return new Date(readClock(now)).toISOString();
}

function sameWorkItem(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameActivity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameResult(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameApproval(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameDecision(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameState(left, right) {
  return left.ownerKind === right.ownerKind
    && left.ownerId === right.ownerId
    && left.nextOrdinal === right.nextOrdinal
    && left.workItems.length === right.workItems.length
    && left.activities.length === right.activities.length
    && left.results.length === right.results.length
    && left.approvals.length === right.approvals.length
    && left.decisions.length === right.decisions.length
    && left.workItems.every((item, index) => sameWorkItem(item, right.workItems[index]))
    && left.activities.every((event, index) => sameActivity(event, right.activities[index]))
    && left.results.every((result, index) => sameResult(result, right.results[index]))
    && left.approvals.every((approval, index) => sameApproval(approval, right.approvals[index]))
    && left.decisions.every((decision, index) => sameDecision(decision, right.decisions[index]));
}

function currentOwner(identity) {
  const snapshot = validateIdentitySessionSnapshot(identity.getSnapshot());
  return validatePersonalOrdaxOwner(
    snapshot.state === "signed-in"
      ? { ownerKind: "account", ownerId: snapshot.subjectId }
      : { ownerKind: "device", ownerId: null },
  );
}

function sameOwner(left, right) {
  return left.ownerKind === right.ownerKind && left.ownerId === right.ownerId;
}

function explicitSpaceMatches(item, identity, selection) {
  if (item.spaceId === null) return true;
  if (selection === null) return false;
  const identitySnapshot = validateIdentitySessionSnapshot(identity.getSnapshot());
  const selectionSnapshot = validateSpaceSelectionSnapshot(selection.getSnapshot());
  return identitySnapshot.state === "signed-in"
    && selectionSnapshot.state === "selected"
    && selectionSnapshot.subjectId === identitySnapshot.subjectId
    && item.ownerKind === "account"
    && item.ownerId === identitySnapshot.subjectId
    && selectionSnapshot.selectedSpace.id === item.spaceId;
}

function explicitProjectExists(item, projects) {
  if (item.projectId === null) return true;
  if (projects === null) return false;
  const snapshot = validateProjectCatalogSnapshot(projects.getSnapshot());
  return snapshot.projects.some((project) => project.id === item.projectId);
}

function boundedSummary(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "Personal OrdaX work updated.";
  return normalized.length <= 1024 ? normalized : `${normalized.slice(0, 1023).trimEnd()}…`;
}

function nextSequenceIn(activities, workItemId) {
  return activities.reduce(
    (maximum, event) => event.workItemId === workItemId
      ? Math.max(maximum, event.sequence)
      : maximum,
    0,
  ) + 1;
}

function appendActivityTo(activities, workItemId, type, summary, occurredAt, metadata = {}) {
  const event = validatePersonalActivityEvent({
    workItemId,
    sequence: nextSequenceIn(activities, workItemId),
    type,
    summary: boundedSummary(summary),
    approvalId: metadata.approvalId ?? null,
    actionId: metadata.actionId ?? null,
    artifactRefs: metadata.artifactRefs ?? [],
    occurredAt,
  });
  return [...activities, event].slice(-MAX_PERSONAL_ACTIVITY_EVENTS);
}

function cancelPendingApprovalIn(state, item, occurredAt, summary) {
  if (item.pendingApprovalId === null) return state;
  const existing = state.approvals.find(
    (approval) => approval.id === item.pendingApprovalId && approval.status === "pending",
  );
  if (!existing) {
    throw new TypeError("Personal OrdaX pending approval graph is inconsistent");
  }
  const cancelled = validatePersonalApproval({
    ...existing,
    status: "cancelled",
    grantRef: null,
    resolvedAt: occurredAt,
  });
  return {
    ...state,
    approvals: state.approvals.map((approval) =>
      approval.id === cancelled.id ? cancelled : approval),
    activities: appendActivityTo(
      state.activities,
      item.id,
      "approval-resolved",
      summary,
      occurredAt,
      { approvalId: cancelled.id, actionId: cancelled.actionId },
    ),
  };
}

export function createPersonalOrdaxRuntime({
  identitySessionPort,
  spaceSelectionPort = null,
  projectCatalogPort = null,
  intelligencePort = null,
  actionGatewayPort = null,
  store = null,
  now = Date.now,
} = {}) {
  if (typeof now !== "function") {
    throw new TypeError("Personal OrdaX runtime requires a clock function");
  }
  const identity = assertIdentitySessionPort(identitySessionPort);
  const selection = spaceSelectionPort === null ? null : assertSpaceSelectionPort(spaceSelectionPort);
  const projects = projectCatalogPort === null ? null : assertProjectCatalogPort(projectCatalogPort);
  const intelligence = intelligencePort === null ? null : assertIntelligencePort(intelligencePort);
  const actionGateway = actionGatewayPort === null ? null : assertActionGateway(actionGatewayPort);
  const durableStore = store === null ? null : assertPersonalOrdaxStore(store);

  const ownerStates = new Map();
  const ownerPersistence = new Map();
  const durableBlockedOwners = new Set();
  const listeners = new Set();
  const inFlight = new Set();
  let disposed = false;
  let activeOwner = currentOwner(identity);

  const loadOwnerState = (ownerValue) => {
    const owner = validatePersonalOrdaxOwner(ownerValue);
    const key = personalOrdaxOwnerKey(owner);
    if (ownerStates.has(key)) return ownerStates.get(key);

    let loaded = createEmptyPersonalOrdaxStoreState(owner);
    let persistence = "session";
    if (durableStore !== null) {
      try {
        const raw = durableStore.load(owner);
        loaded = raw == null
          ? createEmptyPersonalOrdaxStoreState(owner)
          : validatePersonalOrdaxStoreState(raw, owner);
        persistence = durableStore.scope === "device" ? "device" : "session";
      } catch {
        durableBlockedOwners.add(key);
        loaded = createEmptyPersonalOrdaxStoreState(owner);
        persistence = "session";
      }
    }
    ownerStates.set(key, loaded);
    ownerPersistence.set(key, persistence);
    return loaded;
  };

  let state = loadOwnerState(activeOwner);

  const snapshot = () => validatePersonalOrdaxRuntimeSnapshot({
    schema: PERSONAL_ORDAX_RUNTIME_SCHEMA,
    persistence: ownerPersistence.get(personalOrdaxOwnerKey(activeOwner)) ?? "session",
    ownerKind: state.ownerKind,
    ownerId: state.ownerId,
    nextOrdinal: state.nextOrdinal,
    workItems: state.workItems,
    activities: state.activities,
    results: state.results,
    approvals: state.approvals,
    decisions: state.decisions,
  });

  const publish = () => {
    if (disposed) return;
    const current = snapshot();
    for (const listener of [...listeners]) listener(current);
  };

  const saveState = (next) => {
    const validated = validatePersonalOrdaxStoreState(next, activeOwner);
    state = validated;
    const key = personalOrdaxOwnerKey(activeOwner);
    ownerStates.set(key, validated);

    if (durableStore === null || durableBlockedOwners.has(key)) {
      ownerPersistence.set(key, "session");
      return;
    }
    try {
      const saved = durableStore.save(activeOwner, validated) !== false;
      ownerPersistence.set(
        key,
        saved && durableStore.scope === "device" ? "device" : "session",
      );
    } catch {
      ownerPersistence.set(key, "session");
    }
  };

  const replaceState = (next) => {
    const validated = validatePersonalOrdaxStoreState(next, activeOwner);
    if (sameState(state, validated)) return false;
    saveState(validated);
    publish();
    return true;
  };

  const findWork = (id) => {
    const item = state.workItems.find((candidate) => candidate.id === id);
    if (!item) throw new TypeError("Personal OrdaX work id is not registered for the current owner");
    return item;
  };

  const contextStatus = (item) => {
    if (item.ownerKind !== activeOwner.ownerKind || item.ownerId !== activeOwner.ownerId) {
      return "owner-partition-mismatch";
    }
    if (!explicitSpaceMatches(item, identity, selection)) return "space-changed";
    if (!explicitProjectExists(item, projects)) return "project-unavailable";
    return "valid";
  };

  const updateWork = (id, patch, { activity = null } = {}) => {
    const existing = findWork(id);
    const occurredAt = isoClock(now);
    let base = state;
    if (existing.pendingApprovalId !== null && patch.pendingApprovalId === null) {
      base = cancelPendingApprovalIn(
        base,
        existing,
        occurredAt,
        "Pending approval cancelled because the work left waiting-approval state.",
      );
    }
    const updated = validatePersonalWorkItem({
      ...existing,
      ...patch,
      updatedAt: occurredAt,
    });
    const workItems = base.workItems.map((item) => item.id === id ? updated : item);
    const activities = activity === null
      ? base.activities
      : appendActivityTo(
        base.activities,
        id,
        activity.type,
        activity.summary,
        occurredAt,
        activity,
      );
    replaceState({
      ...base,
      workItems,
      activities,
    });
    return updated;
  };

  const pauseInvalidCurrentWork = () => {
    if (disposed) return;
    let next = state;
    let changed = false;
    for (const item of state.workItems) {
      if (!ACTIVE_STATES.has(item.state)) continue;
      const status = contextStatus(item);
      if (status === "valid") continue;
      inFlight.delete(item.id);
      const occurredAt = isoClock(now);
      next = cancelPendingApprovalIn(
        next,
        item,
        occurredAt,
        "Pending approval cancelled because its bound context is no longer valid.",
      );
      const updated = validatePersonalWorkItem({
        ...item,
        state: "paused",
        pendingApprovalId: null,
        updatedAt: occurredAt,
      });
      next = validatePersonalOrdaxStoreState({
        ...next,
        workItems: next.workItems.map((candidate) => candidate.id === item.id ? updated : candidate),
        activities: appendActivityTo(
          next.activities,
          item.id,
          "paused",
          `Work paused because its bound context is no longer valid: ${status}.`,
          occurredAt,
        ),
      }, activeOwner);
      changed = true;
    }
    if (changed) replaceState(next);
  };

  const pauseForOwnerSwitch = () => {
    let next = state;
    let changed = false;
    for (const item of state.workItems) {
      if (!ACTIVE_STATES.has(item.state)) continue;
      const occurredAt = isoClock(now);
      next = cancelPendingApprovalIn(
        next,
        item,
        occurredAt,
        "Pending approval cancelled because the active identity changed.",
      );
      const updated = validatePersonalWorkItem({
        ...item,
        state: "paused",
        pendingApprovalId: null,
        updatedAt: occurredAt,
      });
      next = validatePersonalOrdaxStoreState({
        ...next,
        workItems: next.workItems.map((candidate) => candidate.id === item.id ? updated : candidate),
        activities: appendActivityTo(
          next.activities,
          item.id,
          "paused",
          "Work paused because the active identity changed.",
          occurredAt,
        ),
      }, activeOwner);
      changed = true;
    }
    if (changed) saveState(next);
  };

  const handleIdentityChange = () => {
    if (disposed) return;
    const nextOwner = currentOwner(identity);
    if (sameOwner(activeOwner, nextOwner)) return;
    pauseForOwnerSwitch();
    inFlight.clear();
    activeOwner = nextOwner;
    state = loadOwnerState(activeOwner);
    publish();
  };

  const prepareActionExecution = (id, approvalId) => {
    if (disposed) throw new Error("Personal OrdaX runtime is disposed");
    const item = findWork(id);
    if (item.state !== "queued") {
      throw new Error("Personal OrdaX action execution requires queued work");
    }
    const status = contextStatus(item);
    if (status !== "valid") {
      throw new Error(`Personal OrdaX work context is invalid: ${status}`);
    }
    const approval = state.approvals.find((candidate) =>
      candidate.id === approvalId && candidate.workItemId === id
    );
    if (!approval || approval.status !== "approved" || approval.executedAt !== null) {
      throw new Error("Personal OrdaX action execution requires an unconsumed approved approval");
    }
    const decision = state.decisions.find((candidate) =>
      candidate.workItemId === id
      && candidate.actionId === approval.actionId
    );
    if (!decision || decision.decision !== "allow") {
      throw new Error("Personal OrdaX action execution requires its retained allow decision");
    }
    return validateAuthorizedActionExecution({
      request: {
        workItemId: item.id,
        approvalId: approval.id,
        actionId: approval.actionId,
        toolId: approval.toolId,
        toolArtifactSha256: approval.toolArtifactSha256,
        effect: approval.effect,
        ownerKind: item.ownerKind,
        ownerId: item.ownerId,
        spaceId: item.spaceId,
        projectId: item.projectId,
        resourceRef: approval.resourceRef,
        reason: approval.reason,
        requestedAt: approval.requestedAt,
      },
      decision,
    });
  };

  const unsubscribers = [
    identity.subscribe(handleIdentityChange),
    selection?.subscribe(pauseInvalidCurrentWork) ?? null,
    projects?.subscribe(pauseInvalidCurrentWork) ?? null,
  ].filter(Boolean);

  return Object.freeze({
    schema: PERSONAL_ORDAX_RUNTIME_SCHEMA,
    getSnapshot() {
      return snapshot();
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Personal OrdaX listener must be a function");
      }
      if (disposed) return () => {};
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    create(goal, { spaceId = null, projectId = null } = {}) {
      if (disposed) throw new Error("Personal OrdaX runtime is disposed");
      if (state.workItems.length >= MAX_PERSONAL_WORK_ITEMS) {
        throw new RangeError(
          `Personal OrdaX supports at most ${MAX_PERSONAL_WORK_ITEMS} retained work items per owner`,
        );
      }
      const createdAt = isoClock(now);
      const item = validatePersonalWorkItem({
        id: `personal-work-${state.nextOrdinal}`,
        ownerKind: activeOwner.ownerKind,
        ownerId: activeOwner.ownerId,
        goal,
        state: "queued",
        spaceId,
        projectId,
        pendingApprovalId: null,
        backgroundExecution: false,
        contextRefs: [
          ...(spaceId === null ? [] : [`space:${spaceId}`]),
          ...(projectId === null ? [] : [`project:${projectId}`]),
        ],
        createdAt,
        updatedAt: createdAt,
      });
      const status = contextStatus(item);
      if (status !== "valid") {
        throw new Error(`Personal OrdaX cannot bind work to invalid context: ${status}`);
      }
      const queuedAt = isoClock(now);
      replaceState({
        ...state,
        nextOrdinal: state.nextOrdinal + 1,
        workItems: [...state.workItems, item],
        activities: appendActivityTo(
          state.activities,
          item.id,
          "queued",
          "Work queued with explicit owner and context.",
          queuedAt,
        ),
      });
      return item;
    },
    async run(id) {
      if (disposed) throw new Error("Personal OrdaX runtime is disposed");
      if (intelligence === null) {
        throw new Error("Personal OrdaX Intelligence is unavailable in this composition");
      }
      const item = findWork(id);
      if (TERMINAL_STATES.has(item.state)) {
        throw new Error("Terminal Personal OrdaX work cannot run again");
      }
      if (item.state === "waiting-approval") {
        throw new Error("Personal OrdaX work is waiting for approval");
      }
      if (state.approvals.some(
        (approval) => approval.workItemId === id && approval.status === "approved",
      )) {
        throw new Error("Personal OrdaX work has an approved action that must execute or be cancelled first");
      }
      if (inFlight.has(id)) {
        throw new Error("Personal OrdaX work is already running");
      }
      const status = contextStatus(item);
      if (status !== "valid") {
        if (item.state !== "paused") {
          updateWork(id, { state: "paused", pendingApprovalId: null }, {
            activity: { type: "paused", summary: `Work paused because context is invalid: ${status}.` },
          });
        }
        throw new Error(`Personal OrdaX work context is invalid: ${status}`);
      }
      const intelligenceSnapshot = validateIntelligenceSnapshot(intelligence.getSnapshot());
      if (intelligenceSnapshot.state !== "ready") {
        throw new Error("Personal OrdaX Intelligence is not ready");
      }

      const runOwnerKey = personalOrdaxOwnerKey(activeOwner);
      inFlight.add(id);
      updateWork(id, { state: "running", pendingApprovalId: null }, {
        activity: { type: "started", summary: "Foreground reasoning started." },
      });

      try {
        const response = validateIntelligenceResponse(await intelligence.respond({
          intent: "ask",
          prompt: item.goal,
          context: [],
          maxTokens: 1024,
        }));
        if (
          personalOrdaxOwnerKey(activeOwner) !== runOwnerKey
          || !inFlight.has(id)
        ) {
          throw new Error("Personal OrdaX work context changed while reasoning was in progress");
        }
        const current = findWork(id);
        if (current.state !== "running" || contextStatus(current) !== "valid") {
          throw new Error("Personal OrdaX work context changed while reasoning was in progress");
        }
        if (state.results.length >= MAX_PERSONAL_WORK_RESULTS) {
          throw new RangeError(
            `Personal OrdaX supports at most ${MAX_PERSONAL_WORK_RESULTS} retained work results per owner`,
          );
        }

        const completedAt = isoClock(now);
        const completedWork = validatePersonalWorkItem({
          ...current,
          state: "completed",
          pendingApprovalId: null,
          updatedAt: completedAt,
        });
        const result = validatePersonalWorkResult({
          id: `personal-result-${id}`,
          workItemId: id,
          kind: "intelligence-response",
          text: response.text,
          engineId: response.engineId,
          modelId: response.modelId,
          authority: response.authority,
          artifactRefs: [],
          createdAt: completedAt,
        });
        const completedActivities = appendActivityTo(
          state.activities,
          id,
          "completed",
          "Foreground reasoning completed with a durable owner-bound result.",
          completedAt,
          { artifactRefs: [`result:${result.id}`] },
        );

        inFlight.delete(id);
        replaceState({
          ...state,
          workItems: state.workItems.map((candidate) => candidate.id === id ? completedWork : candidate),
          activities: completedActivities,
          results: [...state.results, result],
        });
        return response;
      } catch (error) {
        if (personalOrdaxOwnerKey(activeOwner) !== runOwnerKey) {
          throw error;
        }
        inFlight.delete(id);
        const current = state.workItems.find((candidate) => candidate.id === id);
        if (current?.state === "running") {
          updateWork(id, { state: "failed", pendingApprovalId: null }, {
            activity: { type: "failed", summary: "Foreground reasoning failed without executing actions." },
          });
        }
        throw error;
      }
    },
    requestApproval(id, {
      actionId,
      toolId,
      toolArtifactSha256,
      effect,
      resourceRef = null,
      reason,
    } = {}) {
      if (disposed) throw new Error("Personal OrdaX runtime is disposed");
      if (state.approvals.length >= MAX_PERSONAL_APPROVALS) {
        throw new RangeError(
          `Personal OrdaX supports at most ${MAX_PERSONAL_APPROVALS} retained approvals per owner`,
        );
      }
      const item = findWork(id);
      if (TERMINAL_STATES.has(item.state) || item.state === "running") {
        throw new Error("Personal OrdaX approval can only be requested for queued or paused work");
      }
      if (item.state === "waiting-approval") {
        throw new Error("Personal OrdaX work already has a pending approval");
      }
      const status = contextStatus(item);
      if (status !== "valid") {
        throw new Error(`Personal OrdaX work context is invalid: ${status}`);
      }
      if (state.approvals.some(
        (approval) => approval.workItemId === id && approval.status === "approved",
      )) {
        throw new Error("Personal OrdaX work must execute or cancel its approved action before requesting another");
      }
      if (state.approvals.some(
        (approval) => approval.workItemId === id && approval.actionId === actionId,
      )) {
        throw new Error("Personal OrdaX action already has a retained approval");
      }

      if (effect !== "read" && (typeof resourceRef !== "string" || resourceRef.trim() === "")) {
        throw new TypeError("Sensitive Personal OrdaX approval requires an explicit resource reference");
      }

      const requestedAt = isoClock(now);
      const approvalOrdinal = state.approvals.filter(
        (approval) => approval.workItemId === id,
      ).length + 1;
      const approval = validatePersonalApproval({
        id: `personal-approval-${id}-${approvalOrdinal}`,
        workItemId: id,
        actionId,
        toolId,
        toolArtifactSha256,
        effect,
        resourceRef,
        status: "pending",
        reason,
        grantRef: null,
        requestedAt,
        resolvedAt: null,
      });
      const waiting = validatePersonalWorkItem({
        ...item,
        state: "waiting-approval",
        pendingApprovalId: approval.id,
        updatedAt: requestedAt,
      });
      replaceState({
        ...state,
        workItems: state.workItems.map((candidate) => candidate.id === id ? waiting : candidate),
        approvals: [...state.approvals, approval],
        activities: appendActivityTo(
          state.activities,
          id,
          "approval-requested",
          "Action is waiting for an explicit scoped approval.",
          requestedAt,
          { approvalId: approval.id, actionId: approval.actionId },
        ),
      });
      return approval;
    },
    resolveApproval(id, approvalId, { grantRef = null, userDecision = null } = {}) {
      if (disposed) throw new Error("Personal OrdaX runtime is disposed");
      if (actionGateway === null) {
        throw new Error("Personal OrdaX Action Gateway is unavailable in this composition");
      }
      if (state.decisions.length >= MAX_PERSONAL_ACTION_DECISIONS) {
        throw new RangeError(
          `Personal OrdaX supports at most ${MAX_PERSONAL_ACTION_DECISIONS} retained action decisions per owner`,
        );
      }
      const item = findWork(id);
      if (item.state !== "waiting-approval" || item.pendingApprovalId !== approvalId) {
        throw new Error("Personal OrdaX approval is not pending for this work");
      }
      const approval = state.approvals.find((candidate) => candidate.id === approvalId);
      if (!approval || approval.status !== "pending" || approval.workItemId !== id) {
        throw new Error("Personal OrdaX pending approval graph is inconsistent");
      }
      const status = contextStatus(item);
      if (status !== "valid") {
        throw new Error(`Personal OrdaX work context is invalid: ${status}`);
      }

      const actionDecision = validatePersonalActionDecision(actionGateway.decide({
        workItemId: item.id,
        approvalId: approval.id,
        actionId: approval.actionId,
        toolId: approval.toolId,
        toolArtifactSha256: approval.toolArtifactSha256,
        effect: approval.effect,
        ownerKind: item.ownerKind,
        ownerId: item.ownerId,
        spaceId: item.spaceId,
        projectId: item.projectId,
        resourceRef: approval.resourceRef,
        reason: approval.reason,
        requestedAt: approval.requestedAt,
      }, { grantRef, userDecision }));

      if (
        actionDecision.workItemId !== item.id
        || actionDecision.actionId !== approval.actionId
        || actionDecision.effect !== approval.effect
      ) {
        throw new TypeError("Action Gateway returned a decision for a different action");
      }
      if (actionDecision.decision === "approval-required") {
        return actionDecision;
      }

      const approved = actionDecision.decision === "allow";
      const resolvedAt = actionDecision.decidedAt;
      const resolvedApproval = validatePersonalApproval({
        ...approval,
        status: approved ? "approved" : "denied",
        grantRef: approved ? actionDecision.grantRef : null,
        resolvedAt,
      });
      const nextWork = validatePersonalWorkItem({
        ...item,
        state: approved ? "queued" : "paused",
        pendingApprovalId: null,
        updatedAt: resolvedAt,
      });
      replaceState({
        ...state,
        workItems: state.workItems.map((candidate) => candidate.id === id ? nextWork : candidate),
        approvals: state.approvals.map((candidate) =>
          candidate.id === approvalId ? resolvedApproval : candidate),
        decisions: [...state.decisions, actionDecision],
        activities: appendActivityTo(
          state.activities,
          id,
          "approval-resolved",
          approved
            ? "Action approval resolved with an exact scoped grant."
            : "Action approval denied by the Action Gateway.",
          resolvedAt,
          { approvalId, actionId: approval.actionId },
        ),
      });
      return actionDecision;
    },
    prepareActionExecution(id, approvalId) {
      return prepareActionExecution(id, approvalId);
    },
    startActionExecution(id, approvalId) {
      if (disposed) throw new Error("Personal OrdaX runtime is disposed");
      const item = findWork(id);
      if (item.state !== "queued") {
        throw new Error("Personal OrdaX action execution can only start from queued work");
      }
      const status = contextStatus(item);
      if (status !== "valid") {
        throw new Error(`Personal OrdaX work context is invalid: ${status}`);
      }
      const approval = state.approvals.find((candidate) =>
        candidate.id === approvalId && candidate.workItemId === id
      );
      if (!approval || approval.status !== "approved" || approval.executedAt !== null) {
        throw new Error("Personal OrdaX action execution requires one unconsumed approved approval");
      }
      const execution = prepareActionExecution(id, approvalId);
      updateWork(id, { state: "running", pendingApprovalId: null }, {
        activity: {
          type: "action-started",
          summary: "Approved foreground action execution started.",
          approvalId,
          actionId: approval.actionId,
        },
      });
      return execution;
    },
    finishActionExecution(id, approvalId, receiptValue) {
      if (disposed) throw new Error("Personal OrdaX runtime is disposed");
      const receipt = validateActionReceipt(receiptValue);
      if (receipt.status !== "succeeded") {
        throw new TypeError("Only a succeeded Action Receipt can consume an approval");
      }
      const item = findWork(id);
      if (item.state !== "running") {
        throw new Error("Personal OrdaX action receipt requires running work");
      }
      const approval = state.approvals.find((candidate) =>
        candidate.id === approvalId && candidate.workItemId === id
      );
      if (!approval || approval.status !== "approved" || approval.executedAt !== null) {
        throw new Error("Personal OrdaX action receipt requires one unconsumed approved approval");
      }
      const decision = state.decisions.find((candidate) =>
        candidate.workItemId === id
        && candidate.actionId === approval.actionId
        && candidate.decision === "allow"
      );
      if (
        !decision
        || receipt.workItemId !== id
        || receipt.approvalId !== approval.id
        || receipt.toolId !== approval.toolId
        || receipt.toolArtifactSha256 !== approval.toolArtifactSha256
        || receipt.actionId !== approval.actionId
        || receipt.effect !== approval.effect
        || receipt.resourceRef !== approval.resourceRef
        || receipt.grantRef !== approval.grantRef
        || receipt.grantRef !== decision.grantRef
      ) {
        throw new TypeError("Personal OrdaX action receipt does not match retained authority");
      }
      if (Date.parse(receipt.executedAt) < Date.parse(item.updatedAt)) {
        throw new TypeError("Personal OrdaX action receipt cannot precede action start");
      }

      const consumed = validatePersonalApproval({
        ...approval,
        status: "executed",
        executedAt: receipt.executedAt,
      });
      const queued = validatePersonalWorkItem({
        ...item,
        state: "queued",
        pendingApprovalId: null,
        updatedAt: receipt.executedAt,
      });
      replaceState({
        ...state,
        workItems: state.workItems.map((candidate) => candidate.id === id ? queued : candidate),
        approvals: state.approvals.map((candidate) =>
          candidate.id === approvalId ? consumed : candidate),
        activities: appendActivityTo(
          state.activities,
          id,
          "action-finished",
          receipt.summary,
          receipt.executedAt,
          {
            approvalId,
            actionId: approval.actionId,
            artifactRefs: receipt.artifactRefs,
          },
        ),
      });
      return receipt;
    },
    failActionExecution(id, approvalId, summary = "Foreground action execution failed before a verified receipt.") {
      if (disposed) throw new Error("Personal OrdaX runtime is disposed");
      const item = findWork(id);
      if (item.state !== "running") return item;
      const approval = state.approvals.find((candidate) =>
        candidate.id === approvalId && candidate.workItemId === id
      );
      if (!approval || approval.status !== "approved") {
        throw new Error("Personal OrdaX action failure requires its approved retained approval");
      }
      return updateWork(id, { state: "paused", pendingApprovalId: null }, {
        activity: {
          type: "action-finished",
          summary,
          approvalId,
          actionId: approval.actionId,
        },
      });
    },
    pause(id) {
      if (disposed) throw new Error("Personal OrdaX runtime is disposed");
      const item = findWork(id);
      if (TERMINAL_STATES.has(item.state)) return item;
      inFlight.delete(id);
      return updateWork(id, { state: "paused", pendingApprovalId: null }, {
        activity: { type: "paused", summary: "Work paused explicitly." },
      });
    },
    resume(id) {
      if (disposed) throw new Error("Personal OrdaX runtime is disposed");
      const item = findWork(id);
      if (item.state !== "paused") {
        throw new Error("Only paused Personal OrdaX work can be resumed");
      }
      const status = contextStatus(item);
      if (status !== "valid") {
        throw new Error(`Personal OrdaX work context is still invalid: ${status}`);
      }
      return updateWork(id, { state: "queued", pendingApprovalId: null }, {
        activity: { type: "resumed", summary: "Work resumed with the original bound context." },
      });
    },
    cancel(id) {
      if (disposed) throw new Error("Personal OrdaX runtime is disposed");
      const item = findWork(id);
      if (TERMINAL_STATES.has(item.state)) return item;
      inFlight.delete(id);
      return updateWork(id, { state: "cancelled", pendingApprovalId: null }, {
        activity: { type: "cancelled", summary: "Work cancelled explicitly." },
      });
    },
    remove(id) {
      if (disposed) throw new Error("Personal OrdaX runtime is disposed");
      const item = findWork(id);
      if (!TERMINAL_STATES.has(item.state)) {
        throw new Error("Active Personal OrdaX work must be cancelled before removal");
      }
      replaceState({
        ...state,
        workItems: state.workItems.filter((candidate) => candidate.id !== id),
        activities: state.activities.filter((event) => event.workItemId !== id),
        results: state.results.filter((result) => result.workItemId !== id),
        approvals: state.approvals.filter((approval) => approval.workItemId !== id),
        decisions: state.decisions.filter((decision) => decision.workItemId !== id),
      });
      return snapshot();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      inFlight.clear();
      for (const unsubscribe of unsubscribers) unsubscribe();
      listeners.clear();
    },
  });
}
