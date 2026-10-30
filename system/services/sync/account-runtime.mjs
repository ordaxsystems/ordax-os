import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import {
  SYNC_RUNTIME_SCHEMA,
  validateSyncRuntimeSnapshot,
} from "../../contracts/sync-runtime.mjs";
import { assertSyncCheckpointStore } from "../../contracts/sync-checkpoint-store.mjs";
import { createSessionSyncCheckpointStore } from "./session-checkpoint-store.mjs";
import { assertSyncTransportPort } from "../../contracts/sync-transport.mjs";
import {
  assertWorkspaceMetadataSource,
  validateWorkspaceMetadata,
  WORKSPACE_METADATA_SCHEMA,
} from "../../contracts/workspace-metadata-source.mjs";
import {
  assertWorkspaceStore,
  validateWorkspaceRecord,
} from "../../contracts/workspace-store.mjs";
import {
  ACCESSIBILITY_CONTRAST_PREFERENCE_ID,
  ACCESSIBILITY_MOTION_PREFERENCE_ID,
  ACCESSIBILITY_TEXT_SCALE_PREFERENCE_ID,
} from "../preferences/accessibility.mjs";
import { getPreferenceDefinition } from "../preferences/catalog.mjs";
import {
  MEMORY_SYNC_DATA_CLASS,
  MEMORY_SYNC_RUNTIME_SCHEMA,
} from "./account-memory-runtime.mjs";
import {
  APPEARANCE_SYNC_OBJECT_ID,
  createAppearanceSyncObject,
  SYNC_MUTATION_SCHEMA,
} from "./runtime.mjs";

export const PORTABLE_PREFERENCES_OBJECT_ID = "preferences/surface";
export const PORTABLE_WORKSPACE_OBJECT_ID = "workspace/portable";

const PULL_PAGE_SIZE = 200;
const MAX_PULL_PAGES_PER_REFRESH = 10;
const MAX_CONFLICT_REBASE_ATTEMPTS = 1;
const TRACKED_OBJECT_IDS = Object.freeze([
  APPEARANCE_SYNC_OBJECT_ID,
  PORTABLE_PREFERENCES_OBJECT_ID,
  PORTABLE_WORKSPACE_OBJECT_ID,
]);
const PORTABLE_PREFERENCE_IDS = Object.freeze([
  ACCESSIBILITY_CONTRAST_PREFERENCE_ID,
  ACCESSIBILITY_MOTION_PREFERENCE_ID,
  ACCESSIBILITY_TEXT_SCALE_PREFERENCE_ID,
]);

function requireIdFactory(value) {
  if (typeof value !== "function") throw new TypeError("Account sync requires createIdempotencyKey()");
  return value;
}

function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Sync server revision must be a non-negative safe integer");
  }
  return value;
}

function optionalMemorySyncRuntime(value) {
  if (value === null || value === undefined) return null;
  if (
    !value
    || typeof value !== "object"
    || value.schema !== MEMORY_SYNC_RUNTIME_SCHEMA
    || typeof value.getSnapshot !== "function"
    || typeof value.applyRemoteBatch !== "function"
    || typeof value.flush !== "function"
  ) {
    throw new TypeError("Account sync Memory reconciler is incompatible");
  }
  return value;
}

function portablePreferences(snapshot) {
  const payload = {};
  for (const id of PORTABLE_PREFERENCE_IDS) {
    const definition = getPreferenceDefinition(id);
    payload[id] = definition.validate(snapshot[id]);
  }
  return Object.freeze(payload);
}

function validatePortablePreferences(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Portable preferences payload must be an object");
  }
  return portablePreferences(payload);
}

function mutation({ objectId, dataClass, baseServerRevision, payload, idempotencyKey }) {
  return Object.freeze({
    $schema: SYNC_MUTATION_SCHEMA,
    operation: "upsert",
    objectId,
    dataClass,
    objectSchemaVersion: 1,
    resolverVersion: 1,
    baseServerRevision,
    idempotencyKey,
    payload,
  });
}

function workspaceRecordFromMetadata(value) {
  const metadata = validateWorkspaceMetadata(value);
  const areas = metadata.areas.map((area) => {
    const counts = new Map();
    const windows = area.appIds.map((appId, index) => {
      const next = (counts.get(appId) ?? 0) + 1;
      counts.set(appId, next);
      return {
        id: next === 1 ? appId : `${appId}:${next}`,
        appId,
        minimized: false,
        maximized: false,
        placementOrdinal: index + 1,
        positionX: null,
        positionY: null,
        target: null,
      };
    });
    return {
      id: area.id,
      ordinal: area.ordinal,
      windows,
      activeWindowId: area.id === metadata.activeAreaId && windows.length ? windows[0].id : null,
      nextWindowOrdinal: windows.length + 1,
    };
  });
  const highestArea = Math.max(...areas.map((area) => area.ordinal));
  return validateWorkspaceRecord({
    activeAreaId: metadata.activeAreaId,
    nextAreaOrdinal: highestArea + 1,
    areas,
  });
}

function remoteWorkspacePayload(payload) {
  return validateWorkspaceMetadata({
    $schema: WORKSPACE_METADATA_SCHEMA,
    activeAreaId: payload?.activeAreaId,
    areas: payload?.areas,
  });
}

function fingerprint(value) {
  return JSON.stringify(value);
}

export function createAccountSyncRuntime({
  identitySession,
  transport,
  checkpointStore = null,
  preferenceSync,
  preferences,
  workspaceMetadataSource,
  workspaceStore,
  memorySync = null,
  createIdempotencyKey,
}) {
  const identity = assertIdentitySessionPort(identitySession);
  const remote = assertSyncTransportPort(transport);
  const checkpoints = checkpointStore === null
    ? createSessionSyncCheckpointStore()
    : assertSyncCheckpointStore(checkpointStore);
  const preferencePort = assertPreferenceRuntimePort(preferences);
  const workspaceSource = assertWorkspaceMetadataSource(workspaceMetadataSource);
  const workspaceState = assertWorkspaceStore(workspaceStore);
  const memoryRuntime = optionalMemorySyncRuntime(memorySync);
  const nextKey = requireIdFactory(createIdempotencyKey);

  const revisions = new Map(TRACKED_OBJECT_IDS.map((id) => [id, 0]));
  const pending = new Map();
  const listeners = new Set();
  let activeSubjectId = null;
  let checkpointCursor = 0;
  let checkpointLoaded = false;
  let initialized = false;
  let destroyed = false;
  let suppressPreferences = false;
  let suppressWorkspace = false;
  let preferencesDirty = false;
  let workspaceDirty = false;
  let syncing = false;
  let synchronizationPromise = null;
  let retryRequested = false;
  let lastPreferenceFingerprint = fingerprint(portablePreferences(preferencePort.getSnapshot()));
  let lastWorkspaceFingerprint = fingerprint(workspaceSource.getSnapshot());

  const resetRevisions = () => {
    for (const id of TRACKED_OBJECT_IDS) revisions.set(id, 0);
  };

  const revisionSnapshot = () => Object.fromEntries(
    TRACKED_OBJECT_IDS.map((id) => [id, revisions.get(id) ?? 0]),
  );

  const persistCheckpoint = () => {
    if (!activeSubjectId) return false;
    try {
      return checkpoints.save({
        subjectId: activeSubjectId,
        cursor: checkpointCursor,
        revisions: revisionSnapshot(),
      });
    } catch {
      return false;
    }
  };

  const persistCheckpointDurably = async () => {
    if (!persistCheckpoint()) return false;
    try {
      return await checkpoints.flush() === true;
    } catch {
      return false;
    }
  };

  const recoverCheckpoint = (subjectId) => {
    activeSubjectId = subjectId;
    checkpointCursor = 0;
    checkpointLoaded = false;
    resetRevisions();
    let value = null;
    try {
      value = checkpoints.load();
    } catch {
      value = null;
    }
    if (!value || value.subjectId !== subjectId) return false;
    checkpointCursor = value.cursor;
    for (const id of TRACKED_OBJECT_IDS) {
      revisions.set(id, requireRevision(value.revisions[id] ?? 0));
    }
    checkpointLoaded = true;
    return true;
  };

  const requireMemorySubject = (subjectId) => {
    if (!memoryRuntime) return null;
    const snapshot = memoryRuntime.getSnapshot();
    if (snapshot.subjectId !== subjectId) {
      throw new Error("Account sync Memory reconciler subject does not match the active account");
    }
    return snapshot;
  };

  const requireMemoryReconciliationSettled = (subjectId) => {
    if (!memoryRuntime) return null;
    const snapshot = requireMemorySubject(subjectId);
    if (!Number.isSafeInteger(snapshot.conflictCount) || snapshot.conflictCount < 0) {
      throw new TypeError("Account sync Memory conflict state is incompatible");
    }
    if (snapshot.conflictCount > 0) {
      throw new Error("Account sync Memory reconciliation remains unresolved");
    }
    return snapshot;
  };

  const reconcileMemoryObjects = async (objects, subjectId) => {
    if (!memoryRuntime) return null;
    requireMemorySubject(subjectId);
    const memoryObjects = objects.filter(
      (object) => object && typeof object === "object" && object.dataClass === MEMORY_SYNC_DATA_CLASS,
    );
    if (memoryObjects.length === 0) {
      requireMemoryReconciliationSettled(subjectId);
      return Object.freeze({ applied: 0, ignored: 0, rejected: 0, blocked: 0 });
    }
    const result = await memoryRuntime.applyRemoteBatch(memoryObjects);
    if (result.rejected > 0 || result.blocked > 0) {
      throw new Error("Account sync Memory reconciliation did not safely consume the remote batch");
    }
    requireMemoryReconciliationSettled(subjectId);
    return result;
  };

  const currentSnapshot = () => {
    const identitySnapshot = identity.getSnapshot();
    const preferenceSnapshot = preferenceSync.getSnapshot();
    const memorySnapshot = memoryRuntime?.getSnapshot() ?? null;
    const otherPending = pending.size + Number(preferencesDirty) + Number(workspaceDirty);
    const memoryPending = memorySnapshot?.pendingMutationCount ?? 0;
    const anySessionPending = otherPending > 0
      || (memoryPending > 0 && memorySnapshot?.queuePersistence === "session");
    return validateSyncRuntimeSnapshot({
      transport: identitySnapshot.state === "unavailable" ? "host-required" : "available",
      accountContinuity:
        identitySnapshot.state === "signed-in" && initialized ? "active" : "not-active",
      pendingMutationCount: preferenceSnapshot.pendingMutationCount + otherPending + memoryPending,
      queuePersistence: anySessionPending ? "session" : preferenceSnapshot.queuePersistence,
      trackedDataClasses: memoryRuntime
        ? ["appearance", "preferences", "workspace-metadata", MEMORY_SYNC_DATA_CLASS]
        : ["appearance", "preferences", "workspace-metadata"],
    });
  };

  const emit = () => {
    if (destroyed) return;
    const snapshot = currentSnapshot();
    for (const listener of [...listeners]) listener(snapshot);
  };

  const queuePreferences = () => {
    const payload = portablePreferences(preferencePort.getSnapshot());
    preferencesDirty = false;
    lastPreferenceFingerprint = fingerprint(payload);
    pending.set(
      PORTABLE_PREFERENCES_OBJECT_ID,
      mutation({
        objectId: PORTABLE_PREFERENCES_OBJECT_ID,
        dataClass: "preferences",
        baseServerRevision: revisions.get(PORTABLE_PREFERENCES_OBJECT_ID) ?? 0,
        payload,
        idempotencyKey: nextKey("preferences"),
      }),
    );
    emit();
    void flush();
  };

  const queueWorkspace = () => {
    const metadata = workspaceSource.getSnapshot();
    workspaceDirty = false;
    lastWorkspaceFingerprint = fingerprint(metadata);
    pending.set(
      PORTABLE_WORKSPACE_OBJECT_ID,
      mutation({
        objectId: PORTABLE_WORKSPACE_OBJECT_ID,
        dataClass: "workspace-metadata",
        baseServerRevision: revisions.get(PORTABLE_WORKSPACE_OBJECT_ID) ?? 0,
        payload: {
          activeAreaId: metadata.activeAreaId,
          areas: metadata.areas,
        },
        idempotencyKey: nextKey("workspace"),
      }),
    );
    emit();
    void flush();
  };

  const rebasePortablePending = (objectId, nextServerRevision) => {
    const revision = requireRevision(nextServerRevision);
    revisions.set(objectId, revision);
    const current = pending.get(objectId);
    if (!current) {
      persistCheckpoint();
      return null;
    }
    const rebased = mutation({
      objectId,
      dataClass: current.dataClass,
      baseServerRevision: revision,
      payload: current.payload,
      idempotencyKey: nextKey(`${current.dataClass}-rebase`),
    });
    pending.set(objectId, rebased);
    persistCheckpoint();
    return rebased;
  };

  const flushAppearance = async () => {
    let current = preferenceSync.pendingMutations()[0] ?? null;
    if (!current) return;

    for (let attempt = 0; attempt <= MAX_CONFLICT_REBASE_ATTEMPTS; attempt += 1) {
      const expected = revisions.get(APPEARANCE_SYNC_OBJECT_ID) ?? 0;
      if (current.baseServerRevision !== expected) {
        preferenceSync.rebasePending(expected);
        current = preferenceSync.pendingMutations()[0] ?? null;
        if (!current) return;
      }

      let ack;
      try {
        ack = await remote.applyMutation({ ...current, resolverVersion: 1 });
      } catch {
        retryRequested = true;
        return;
      }

      const revision = requireRevision(ack.serverRevision);
      revisions.set(APPEARANCE_SYNC_OBJECT_ID, revision);
      persistCheckpoint();

      if (ack.conflict) {
        preferenceSync.rebasePending(revision);
        current = preferenceSync.pendingMutations()[0] ?? null;
        if (!current || attempt >= MAX_CONFLICT_REBASE_ATTEMPTS) {
          retryRequested = true;
          return;
        }
        continue;
      }

      const acknowledged = preferenceSync.acknowledge(current.idempotencyKey, revision);
      if (!acknowledged && preferenceSync.pendingMutations().length > 0) {
        preferenceSync.rebasePending(revision);
        retryRequested = true;
      }
      return;
    }
  };

  const flushPortableObject = async (objectId, initialMutation) => {
    let current = initialMutation;

    for (let attempt = 0; attempt <= MAX_CONFLICT_REBASE_ATTEMPTS; attempt += 1) {
      const expected = revisions.get(objectId) ?? 0;
      if (current.baseServerRevision !== expected) {
        current = rebasePortablePending(objectId, expected);
        if (!current) return;
      }

      let ack;
      try {
        ack = await remote.applyMutation(current);
      } catch {
        retryRequested = true;
        return;
      }

      const revision = requireRevision(ack.serverRevision);
      revisions.set(objectId, revision);
      persistCheckpoint();

      if (ack.conflict) {
        current = rebasePortablePending(objectId, revision);
        if (!current || attempt >= MAX_CONFLICT_REBASE_ATTEMPTS) {
          retryRequested = true;
          return;
        }
        continue;
      }

      const latest = pending.get(objectId);
      if (latest?.idempotencyKey === current.idempotencyKey) {
        pending.delete(objectId);
      } else if (latest) {
        rebasePortablePending(objectId, revision);
        retryRequested = true;
      }
      persistCheckpoint();
      return;
    }
  };

  async function flush() {
    const identitySnapshot = identity.getSnapshot();
    if (destroyed || syncing || identitySnapshot.state !== "signed-in" || !initialized) {
      return;
    }
    syncing = true;
    retryRequested = false;
    try {
      await flushAppearance();
      for (const [objectId, pendingMutation] of [...pending]) {
        await flushPortableObject(objectId, pendingMutation);
      }
      if (memoryRuntime) {
        requireMemorySubject(identitySnapshot.subjectId);
        await memoryRuntime.flush(remote);
      }
    } finally {
      syncing = false;
      emit();
    }
  }

  const applyRemotePreferences = (object) => {
    const payload = validatePortablePreferences(object.payload);
    suppressPreferences = true;
    try {
      for (const id of PORTABLE_PREFERENCE_IDS) preferencePort.set(id, payload[id]);
      lastPreferenceFingerprint = fingerprint(payload);
    } finally {
      suppressPreferences = false;
    }
  };

  const applyRemoteWorkspace = (object) => {
    const metadata = remoteWorkspacePayload(object.payload);
    suppressWorkspace = true;
    try {
      workspaceState.save(workspaceRecordFromMetadata(metadata));
      lastWorkspaceFingerprint = fingerprint(metadata);
    } finally {
      suppressWorkspace = false;
    }
  };

  const applyRemoteObject = (object) => {
    if (!object || typeof object !== "object") throw new TypeError("Invalid remote sync object");
    const objectId = object.objectId;
    if (!TRACKED_OBJECT_IDS.includes(objectId)) return false;
    const serverRevision = requireRevision(object.serverRevision);
    const previousRevision = revisions.get(objectId) ?? 0;
    if (serverRevision < previousRevision) return false;
    revisions.set(objectId, serverRevision);
    if (objectId === APPEARANCE_SYNC_OBJECT_ID) {
      if (preferenceSync.pendingMutations().length > 0 && serverRevision > previousRevision) {
        preferenceSync.rebasePending(serverRevision);
      } else if (!object.tombstone && serverRevision > previousRevision) {
        preferenceSync.applyRemoteAppearance(
          createAppearanceSyncObject({
            theme: object.payload?.theme,
            serverRevision,
          }),
        );
      }
      return true;
    }

    if (objectId === PORTABLE_PREFERENCES_OBJECT_ID) {
      if (pending.has(objectId) && serverRevision > previousRevision) {
        rebasePortablePending(objectId, serverRevision);
      } else if (!object.tombstone && !preferencesDirty && serverRevision > previousRevision) {
        applyRemotePreferences(object);
      }
      return true;
    }

    if (objectId === PORTABLE_WORKSPACE_OBJECT_ID) {
      if (pending.has(objectId) && serverRevision > previousRevision) {
        rebasePortablePending(objectId, serverRevision);
      } else if (!object.tombstone && !workspaceDirty && serverRevision > previousRevision) {
        applyRemoteWorkspace(object);
      }
      return true;
    }
    return false;
  };

  const applyInitialSnapshot = async (objects, subjectId) => {
    const byId = new Map(objects.map((object) => [object.objectId, object]));

    const appearance = byId.get(APPEARANCE_SYNC_OBJECT_ID);
    if (appearance) {
      const revision = requireRevision(appearance.serverRevision);
      revisions.set(APPEARANCE_SYNC_OBJECT_ID, revision);
      if (!appearance.tombstone && preferenceSync.pendingMutations().length === 0) {
        preferenceSync.applyRemoteAppearance(
          createAppearanceSyncObject({
            theme: appearance.payload?.theme,
            serverRevision: revision,
          }),
        );
      }
    }

    const prefs = byId.get(PORTABLE_PREFERENCES_OBJECT_ID);
    if (prefs) {
      revisions.set(PORTABLE_PREFERENCES_OBJECT_ID, requireRevision(prefs.serverRevision));
      if (prefs.tombstone) {
        queuePreferences();
      } else if (preferencesDirty) {
        queuePreferences();
      } else {
        applyRemotePreferences(prefs);
      }
    } else {
      queuePreferences();
    }

    const workspace = byId.get(PORTABLE_WORKSPACE_OBJECT_ID);
    if (workspace) {
      revisions.set(PORTABLE_WORKSPACE_OBJECT_ID, requireRevision(workspace.serverRevision));
      if (workspace.tombstone) {
        queueWorkspace();
      } else if (workspaceDirty) {
        queueWorkspace();
      } else {
        applyRemoteWorkspace(workspace);
      }
    } else {
      queueWorkspace();
    }

    await reconcileMemoryObjects(objects, subjectId);
  };

  async function pullRemoteChanges(subjectId) {
    for (let page = 0; page < MAX_PULL_PAGES_PER_REFRESH; page += 1) {
      const previousCursor = checkpointCursor;
      const result = await remote.pullChanges({
        afterCursor: checkpointCursor,
        limit: PULL_PAGE_SIZE,
      });
      for (const change of result.changes) applyRemoteObject(change);
      await reconcileMemoryObjects(result.changes, subjectId);
      checkpointCursor = result.nextCursor;
      if (!(await persistCheckpointDurably())) {
        checkpointCursor = previousCursor;
        throw new Error("Account sync checkpoint durability could not be confirmed");
      }
      checkpointLoaded = true;
      if (result.changes.length < PULL_PAGE_SIZE) return;
    }
    retryRequested = true;
  }

  async function runSynchronization() {
    const identitySnapshot = identity.getSnapshot();
    if (destroyed || identitySnapshot.state !== "signed-in") {
      initialized = false;
      activeSubjectId = null;
      checkpointCursor = 0;
      checkpointLoaded = false;
      resetRevisions();
      emit();
      return;
    }

    const subjectId = identitySnapshot.subjectId;
    if (activeSubjectId !== subjectId) recoverCheckpoint(subjectId);
    if (memoryRuntime) requireMemorySubject(subjectId);

    initialized = false;
    emit();
    try {
      if (checkpointLoaded) {
        await pullRemoteChanges(subjectId);
      } else {
        const snapshot = await remote.snapshot({ limit: 200 });
        await applyInitialSnapshot(snapshot.objects, subjectId);
        checkpointCursor = snapshot.cursor;
        if (!(await persistCheckpointDurably())) {
          checkpointCursor = 0;
          checkpointLoaded = false;
          throw new Error("Account sync checkpoint durability could not be confirmed");
        }
        checkpointLoaded = true;
      }

      initialized = true;
      emit();
      await flush();
    } catch {
      initialized = false;
      emit();
    }
  }

  function synchronize() {
    if (synchronizationPromise !== null) return synchronizationPromise;
    synchronizationPromise = runSynchronization().finally(() => {
      synchronizationPromise = null;
    });
    return synchronizationPromise;
  }

  const unsubscribePreferences = preferencePort.subscribe((snapshot) => {
    const next = fingerprint(portablePreferences(snapshot));
    if (suppressPreferences || next === lastPreferenceFingerprint) return;
    lastPreferenceFingerprint = next;
    if (initialized && identity.getSnapshot().state === "signed-in") {
      queuePreferences();
    } else {
      preferencesDirty = true;
      emit();
    }
  });

  const unsubscribeWorkspace = workspaceSource.subscribe((snapshot) => {
    const next = fingerprint(snapshot);
    if (suppressWorkspace || next === lastWorkspaceFingerprint) return;
    lastWorkspaceFingerprint = next;
    if (initialized && identity.getSnapshot().state === "signed-in") {
      queueWorkspace();
    } else {
      workspaceDirty = true;
      emit();
    }
  });

  const unsubscribePreferenceSync = preferenceSync.subscribe(() => {
    emit();
    void flush();
  });

  const unsubscribeIdentity = identity.subscribe((snapshot) => {
    if (snapshot.state === "signed-in") {
      void synchronize();
    } else {
      initialized = false;
      activeSubjectId = null;
      checkpointCursor = 0;
      checkpointLoaded = false;
      resetRevisions();
      emit();
    }
  });

  return Object.freeze({
    schema: SYNC_RUNTIME_SCHEMA,
    getSnapshot() {
      return currentSnapshot();
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Sync runtime listener must be a function");
      listeners.add(listener);
      listener(currentSnapshot());
      return () => listeners.delete(listener);
    },
    async refresh() {
      await synchronize();
      return currentSnapshot();
    },
    async flush() {
      await flush();
      return currentSnapshot();
    },
    destroy() {
      destroyed = true;
      unsubscribeIdentity();
      unsubscribePreferenceSync();
      unsubscribeWorkspace();
      unsubscribePreferences();
      listeners.clear();
    },
  });
}
