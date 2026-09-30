import {
  validatePersonalActivityEvent,
  validatePersonalWorkItem,
} from "../../contracts/personal-ordax.mjs";
import {
  MAX_PERSONAL_ACTIVITY_EVENTS,
  MAX_PERSONAL_WORK_ITEMS,
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

function sameState(left, right) {
  return left.ownerKind === right.ownerKind
    && left.ownerId === right.ownerId
    && left.nextOrdinal === right.nextOrdinal
    && left.workItems.length === right.workItems.length
    && left.activities.length === right.activities.length
    && left.workItems.every((item, index) => sameWorkItem(item, right.workItems[index]))
    && left.activities.every((event, index) => sameActivity(event, right.activities[index]));
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

export function createPersonalOrdaxRuntime({
  identitySessionPort,
  spaceSelectionPort = null,
  projectCatalogPort = null,
  intelligencePort = null,
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
    const updated = validatePersonalWorkItem({
      ...existing,
      ...patch,
      updatedAt: occurredAt,
    });
    const workItems = state.workItems.map((item) => item.id === id ? updated : item);
    const activities = activity === null
      ? state.activities
      : appendActivityTo(
        state.activities,
        id,
        activity.type,
        activity.summary,
        occurredAt,
        activity,
      );
    replaceState({
      ...state,
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
        inFlight.delete(id);
        updateWork(id, { state: "completed", pendingApprovalId: null }, {
          activity: {
            type: "completed",
            summary: "Foreground reasoning completed. Result returned to the caller.",
          },
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
