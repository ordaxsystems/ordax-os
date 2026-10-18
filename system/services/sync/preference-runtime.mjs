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

function recoverPersistedState(store, fallbackRevision) {
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
  if (partitioned && (!identitySession || !syncStateRegistry
    || syncStateRegistry.schema !== SYNC_STATE_CONTAINER_SCHEMA
    || typeof syncStateRegistry.open !== "function" || syncStateStore !== null)) {
    throw new TypeError("Account appearance sync requires one canonical subject-partitioned state registry");
  }
  const identity = partitioned ? assertIdentitySessionPort(identitySession) : null;
  const signedSubject = () => {
    const snapshot = identity?.getSnapshot();
    return snapshot?.state === "signed-in" ? snapshot.subjectId : null;
  };
  let currentSubject = partitioned ? signedSubject() : null;
  const nextIdempotencyKey = requireIdempotencyFactory(createIdempotencyKey);
  let store = partitioned
    ? (currentSubject === null ? null : assertSyncStateStore(syncStateRegistry.open("appearance", {
        partitionKey: currentSubject,
      })))
    : (syncStateStore === null ? null : assertSyncStateStore(syncStateStore));
  const recovered = recoverPersistedState(store, requireServerRevision(initialServerRevision));
  let serverRevision = recovered.serverRevision;
  let queue = createSyncMutationQueue(recovered.mutations);
  let destroyed = false;
  let queuePersistence = store?.scope ?? "session";
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
    if (!store) return false;
    try {
      const saved = store.save(serializeState(serverRevision, queue));
      if (saved === false) queuePersistence = "session";
      return saved;
    } catch {
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
    if (partitioned && currentSubject === null) return;
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
    const nextStore = nextSubject === null ? null
      : assertSyncStateStore(syncStateRegistry.open("appearance", { partitionKey: nextSubject }));
    const next = recoverPersistedState(nextStore, requireServerRevision(initialServerRevision));
    currentSubject = nextSubject;
    store = nextStore;
    serverRevision = next.serverRevision;
    queue = createSyncMutationQueue(next.mutations);
    lastTheme = preferences.getSnapshot()[APPEARANCE_PREFERENCE_ID];
    queuePersistence = store?.scope ?? "session";
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
      if (partitioned && currentSubject === null) return false;
      const revision = requireServerRevision(nextServerRevision);
      const removed = queue.acknowledge(idempotencyKey);
      if (!removed) return false;
      serverRevision = revision;
      persist();
      emit();
      return true;
    },
    rebasePending(nextServerRevision) {
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
      if (partitioned && currentSubject === null) return false;
      if (store === null) return !partitioned;
      if (typeof store.flush !== "function") return store.scope !== "device";
      try {
        return await store.flush() === true;
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
