import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import { SYNC_STATE_CONTAINER_SCHEMA } from "./state-store-registry.mjs";
import {
  SYNC_RUNTIME_SCHEMA,
  validateSyncRuntimeSnapshot,
} from "../../contracts/sync-runtime.mjs";
import { assertSyncStateStore } from "../../contracts/sync-state-store.mjs";
import { APPEARANCE_PREFERENCE_ID } from "../preferences/appearance.mjs";
import {
  createAppearanceSyncMutation,
  createSyncMutationQueue,
  validateAppearanceSyncMutation,
  validateAppearanceSyncObject,
  SYNC_CORE_STATUS,
} from "./runtime.mjs";

export const PREFERENCE_SYNC_STATE_SCHEMA = "ordax.preference-sync-state/1";

function requireIdempotencyFactory(value) {
  if (typeof value !== "function") {
    throw new TypeError("Preference sync bridge requires createIdempotencyKey()");
  }
  return value;
}

function requireServerRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("serverRevision must be a non-negative safe integer");
  }
  return value;
}

function recoverPersistedState(store, fallbackRevision, { failClosed = false } = {}) {
  if (!store) {
    return { serverRevision: fallbackRevision, mutations: [] };
  }
  const payload = store.load();
  if (payload === null) {
    return { serverRevision: fallbackRevision, mutations: [] };
  }
  try {
    const value = JSON.parse(payload);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.$schema !== PREFERENCE_SYNC_STATE_SCHEMA ||
      !Array.isArray(value.mutations) ||
      value.mutations.length > 1
    ) {
      throw new TypeError("Unsupported persisted preference sync state");
    }
    return {
      serverRevision: requireServerRevision(value.serverRevision),
      mutations: value.mutations.map(validateAppearanceSyncMutation),
    };
  } catch {
    if (failClosed) {
      return { serverRevision: fallbackRevision, mutations: [], recoveryBlocked: true };
    }
    return { serverRevision: fallbackRevision, mutations: [] };
  }
}

function serializeState(serverRevision, queue) {
  return JSON.stringify({
    $schema: PREFERENCE_SYNC_STATE_SCHEMA,
    serverRevision,
    mutations: queue.snapshot(),
  });
}

export function createPreferenceSyncRuntime(
  preferenceRuntime,
  {
    createIdempotencyKey,
    initialServerRevision = 0,
    syncStateStore = null,
    identitySession = null,
    syncStateRegistry = null,
  } = {},
) {
  const preferences = assertPreferenceRuntimePort(preferenceRuntime);
  const partitioned = identitySession !== null || syncStateRegistry !== null;
  if (partitioned && (!identitySession || syncStateStore !== null
    || (syncStateRegistry !== null && (
      syncStateRegistry.schema !== SYNC_STATE_CONTAINER_SCHEMA
      || typeof syncStateRegistry.open !== "function"
    )))) {
    throw new TypeError("Account appearance sync requires the canonical identity and optional subject-partitioned registry");
  }
  const identity = partitioned ? assertIdentitySessionPort(identitySession) : null;
  const signedSubject = () => {
    const snapshot = identity?.getSnapshot();
    return snapshot?.state === "signed-in" ? snapshot.subjectId : null;
  };
  let currentSubject = partitioned ? signedSubject() : null;
  const nextIdempotencyKey = requireIdempotencyFactory(createIdempotencyKey);
  const sessionPartitions = new Map();
  let store = partitioned
    ? (currentSubject === null || syncStateRegistry === null
      ? null : assertSyncStateStore(syncStateRegistry.open("appearance", {
        partitionKey: currentSubject,
      })))
    : (syncStateStore === null ? null : assertSyncStateStore(syncStateStore));
  const recovered = recoverPersistedState(
    store, requireServerRevision(initialServerRevision), { failClosed: partitioned },
  );
  let recoveryBlocked = recovered.recoveryBlocked === true;
  let serverRevision = recovered.serverRevision;
  let queue = createSyncMutationQueue(recovered.mutations);
  let destroyed = false;
  let queuePersistence = store?.scope ?? "session";
  let lastSaveAccepted = true;
  let lastTheme = preferences.getSnapshot()[APPEARANCE_PREFERENCE_ID];
  let suppressThemeQueue = false;
  const listeners = new Set();

  const currentSnapshot = () => validateSyncRuntimeSnapshot({
    transport: SYNC_CORE_STATUS.transport,
    accountContinuity: SYNC_CORE_STATUS.accountContinuity,
    pendingMutationCount: queue.snapshot().length,
    queuePersistence,
    trackedDataClasses: ["appearance"],
  });

  const persist = () => {
    if (recoveryBlocked) return false;
    if (!store) {
      if (partitioned && currentSubject !== null) {
        sessionPartitions.set(currentSubject, {
          serverRevision,
          mutations: queue.snapshot(),
        });
      }
      queuePersistence = "session";
      return false;
    }
    try {
      const saved = store.save(serializeState(serverRevision, queue));
      lastSaveAccepted = saved === true;
      if (!lastSaveAccepted) queuePersistence = "session";
      return lastSaveAccepted;
    } catch {
      lastSaveAccepted = false;
      queuePersistence = "session";
      return false;
    }
  };

  const emit = () => {
    if (destroyed) return;
    const snapshot = currentSnapshot();
    for (const listener of [...listeners]) listener(snapshot);
  };

  const queueTheme = (theme) => {
    // Guest/device changes remain local, never become anonymous cloud mutations.
    if (partitioned && (currentSubject === null || recoveryBlocked)) return;
    const mutation = createAppearanceSyncMutation({
      theme,
      baseServerRevision: serverRevision,
      idempotencyKey: nextIdempotencyKey(),
    });
    // Appearance is one stable object. Keep only the newest pending local value.
    queue = createSyncMutationQueue([mutation]);
    persist();
    emit();
  };

  const recoveredPending = queue.snapshot()[0] ?? null;
  if (!partitioned && recoveredPending && recoveredPending.payload.theme !== lastTheme) {
    queueTheme(lastTheme);
  }

  const unsubscribeIdentity = identity?.subscribe(() => {
    const nextSubject = signedSubject();
    if (nextSubject === currentSubject) return;
    // Do not ever migrate the old global slot. Its subject cannot be proven.
    // Existing per-subject pending mutations are restored verbatim, without
    // replacing their intent with the current device's theme on account switch.
    if (currentSubject !== null && store === null) {
      sessionPartitions.set(currentSubject, {
        serverRevision,
        mutations: queue.snapshot(),
      });
    }
    const nextStore = nextSubject === null || syncStateRegistry === null ? null
      : assertSyncStateStore(syncStateRegistry.open("appearance", { partitionKey: nextSubject }));
    const next = nextStore
      ? recoverPersistedState(nextStore, requireServerRevision(initialServerRevision), {
          failClosed: true,
        })
      : (sessionPartitions.get(nextSubject) ?? {
        serverRevision: requireServerRevision(initialServerRevision),
        mutations: [],
      });
    currentSubject = nextSubject;
    store = nextStore;
    recoveryBlocked = next.recoveryBlocked === true;
    serverRevision = next.serverRevision;
    queue = createSyncMutationQueue(next.mutations);
    lastTheme = preferences.getSnapshot()[APPEARANCE_PREFERENCE_ID];
    queuePersistence = store?.scope ?? "session";
    lastSaveAccepted = true;
    emit();
  }) ?? (() => {});

  const unsubscribePreferences = preferences.subscribe((snapshot) => {
    const theme = snapshot[APPEARANCE_PREFERENCE_ID];
    if (theme === lastTheme) return;
    lastTheme = theme;
    if (suppressThemeQueue) return;
    queueTheme(theme);
  });

  return Object.freeze({
    schema: SYNC_RUNTIME_SCHEMA,
    getSnapshot() {
      return currentSnapshot();
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Sync runtime listener must be a function");
      }
      listeners.add(listener);
      listener(currentSnapshot());
      return () => listeners.delete(listener);
    },
    pendingMutations() {
      return queue.snapshot();
    },
    acknowledge(idempotencyKey, nextServerRevision) {
      if (partitioned && (currentSubject === null || recoveryBlocked)) return false;
      const revision = requireServerRevision(nextServerRevision);
      const removed = queue.acknowledge(idempotencyKey);
      if (!removed) return false;
      serverRevision = revision;
      persist();
      emit();
      return true;
    },
    rebasePending(nextServerRevision) {
      if (recoveryBlocked) return false;
      const revision = requireServerRevision(nextServerRevision);
      const pending = queue.snapshot();
      serverRevision = revision;
      if (pending.length === 0) {
        persist();
        emit();
        return false;
      }
      queueTheme(lastTheme);
      return true;
    },
    applyRemoteAppearance(value) {
      if (recoveryBlocked) {
        throw new Error("Account appearance coordination requires explicit recovery");
      }
      const remote = validateAppearanceSyncObject(value);
      if (remote.tombstone) return false;
      if (queue.snapshot().length > 0) {
        throw new Error("Cannot apply remote appearance while a local mutation is pending");
      }
      serverRevision = remote.serverRevision;
      suppressThemeQueue = true;
      try {
        preferences.set(APPEARANCE_PREFERENCE_ID, remote.payload.theme);
        lastTheme = remote.payload.theme;
      } finally {
        suppressThemeQueue = false;
      }
      persist();
      emit();
      return true;
    },
    async flushDurably() {
      if (recoveryBlocked || (partitioned && currentSubject === null)) return false;
      if (store === null) return !partitioned;
      if (partitioned && store.scope !== "device") return false;
      if (!lastSaveAccepted) return false;
      const owner = currentSubject;
      if (typeof store.flush !== "function") return store.scope !== "device";
      try {
        const confirmed = await store.flush() === true;
        return confirmed && currentSubject === owner;
      } catch {
        return false;
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeIdentity();
      unsubscribePreferences();
      listeners.clear();
    },
  });
}
