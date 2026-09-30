import {
  MAX_MEMORY_SEARCH_OFFSET,
  MAX_MEMORY_SEARCH_RESULTS,
  assertMemoryPort,
  validateMemoryForgetRequest,
} from "../../contracts/memory.mjs";
import { assertIdentitySessionPort, validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
import {
  MAX_SYNC_STATE_PAYLOAD_BYTES,
  assertSyncStateStorePort,
} from "../../contracts/sync-state-store.mjs";
import {
  MEMORY_SYNC_RUNTIME_SCHEMA,
  classifyMemoryForAccountSync,
} from "./account-memory-runtime.mjs";

export const ACCOUNT_MEMORY_DEFERRED_INTENTS_SCHEMA = "ordax.account-memory-deferred-intents/1";
export const ACCOUNT_MEMORY_DEFERRED_STATE_SCHEMA = "ordax.account-memory-deferred-state/1";

const MAX_DEFERRED_INTENTS = 128;
const TRANSFERRED_STATUSES = new Set(["pending", "conflict", "reconciliation-required"]);

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function requireFactory(value) {
  if (typeof value !== "function") {
    throw new TypeError("Deferred Memory intents require createDeferredStateStore(subjectId)");
  }
  return value;
}

function requireMemorySync(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== MEMORY_SYNC_RUNTIME_SCHEMA
    || typeof value.stageUpsert !== "function"
    || typeof value.stageForget !== "function"
    || typeof value.pendingMutations !== "function"
    || typeof value.pendingConflicts !== "function"
  ) {
    throw new TypeError("Deferred Memory replay requires a compatible Memory sync runtime");
  }
  return value;
}

function identityRecord(value, subjectId, operation) {
  const request = validateMemoryForgetRequest(value);
  if (request.ownerKind !== "account" || request.ownerId !== subjectId) {
    throw new TypeError("Deferred Memory intent must belong to the active account");
  }
  if (operation !== "upsert" && operation !== "delete") {
    throw new TypeError("Deferred Memory intent operation is invalid");
  }
  return Object.freeze({
    id: request.id,
    ownerKind: "account",
    ownerId: subjectId,
    operation,
  });
}

function serializeState(subjectId, intents) {
  const payload = JSON.stringify({
    $schema: ACCOUNT_MEMORY_DEFERRED_STATE_SCHEMA,
    subjectId,
    intents: [...intents.values()].sort((left, right) => left.id.localeCompare(right.id)),
  });
  if (new TextEncoder().encode(payload).byteLength > MAX_SYNC_STATE_PAYLOAD_BYTES) {
    throw new Error("Deferred Memory coordination state exceeds its durable bound");
  }
  return payload;
}

function recoverState(store, subjectId) {
  const raw = store.load();
  if (raw == null) return new Map();
  try {
    const parsed = JSON.parse(raw);
    if (
      !exactKeys(parsed, ["$schema", "subjectId", "intents"])
      || parsed.$schema !== ACCOUNT_MEMORY_DEFERRED_STATE_SCHEMA
      || parsed.subjectId !== subjectId
      || !Array.isArray(parsed.intents)
      || parsed.intents.length > MAX_DEFERRED_INTENTS
    ) {
      throw new TypeError("incompatible deferred Memory state");
    }
    const intents = new Map();
    for (const rawIntent of parsed.intents) {
      if (!exactKeys(rawIntent, ["id", "ownerKind", "ownerId", "operation"])) {
        throw new TypeError("invalid deferred Memory intent shape");
      }
      const intent = identityRecord(rawIntent, subjectId, rawIntent.operation);
      if (intents.has(intent.id)) throw new TypeError("duplicate deferred Memory identity");
      intents.set(intent.id, intent);
    }
    return intents;
  } catch (error) {
    throw new Error("Deferred Memory coordination state requires explicit recovery", { cause: error });
  }
}

function persist(runtime) {
  const saved = runtime.store.save(serializeState(runtime.subjectId, runtime.intents));
  if (saved !== true) {
    throw new Error("Deferred Memory intent persistence failed");
  }
}

function mutateDurably(runtime, mutation) {
  const before = new Map(runtime.intents);
  mutation(runtime.intents);
  if (runtime.intents.size > MAX_DEFERRED_INTENTS) {
    runtime.intents.clear();
    for (const [key, value] of before) runtime.intents.set(key, value);
    throw new Error("Deferred Memory intent capacity exceeded");
  }
  try {
    persist(runtime);
  } catch (error) {
    runtime.intents.clear();
    for (const [key, value] of before) runtime.intents.set(key, value);
    throw error;
  }
}

function findCurrentMemoryItem(memory, subjectId, id) {
  for (let offset = 0; offset <= MAX_MEMORY_SEARCH_OFFSET; offset += MAX_MEMORY_SEARCH_RESULTS) {
    const items = memory.search({
      ownerKind: "account",
      ownerId: subjectId,
      scopes: ["device", "account", "space", "project", "session"],
      includeRestricted: true,
      limit: MAX_MEMORY_SEARCH_RESULTS,
      offset,
    });
    const current = items.find((item) => item.id === id);
    if (current) return current;
    if (items.length < MAX_MEMORY_SEARCH_RESULTS) return null;
  }
  return null;
}

function canonicalOwnership(memorySync, objectId) {
  const pending = memorySync.pendingMutations().some((mutation) => mutation?.objectId === objectId);
  const conflict = memorySync.pendingConflicts().some((entry) => entry?.objectId === objectId);
  return pending || conflict;
}

export function createAccountMemoryDeferredIntents({
  identitySession,
  memoryPort,
  createDeferredStateStore,
} = {}) {
  const identity = assertIdentitySessionPort(identitySession);
  const memory = assertMemoryPort(memoryPort);
  const createStore = requireFactory(createDeferredStateStore);
  const runtimes = new Map();
  let destroyed = false;

  const activeIdentity = () => {
    if (destroyed) throw new Error("Deferred Memory intent runtime is disposed");
    return validateIdentitySessionSnapshot(identity.getSnapshot());
  };

  const runtimeFor = (subjectId) => {
    if (runtimes.has(subjectId)) return runtimes.get(subjectId);
    const store = assertSyncStateStorePort(createStore(subjectId));
    const runtime = {
      subjectId,
      store,
      intents: recoverState(store, subjectId),
    };
    runtimes.set(subjectId, runtime);
    return runtime;
  };

  const currentRuntime = () => {
    const snapshot = activeIdentity();
    if (snapshot.state !== "signed-in") return null;
    return runtimeFor(snapshot.subjectId);
  };

  const rememberIntent = (runtime, value, operation) => {
    const intent = identityRecord(value, runtime.subjectId, operation);
    mutateDurably(runtime, (intents) => intents.set(intent.id, intent));
    return intent;
  };

  const removeIntent = (runtime, id) => {
    if (!runtime.intents.has(id)) return false;
    mutateDurably(runtime, (intents) => intents.delete(id));
    return true;
  };

  return Object.freeze({
    schema: ACCOUNT_MEMORY_DEFERRED_INTENTS_SCHEMA,
    observeStageResult(result, context) {
      const runtime = currentRuntime();
      if (!runtime) return Object.freeze({ status: "inactive", deferred: false });
      if (!result || typeof result !== "object" || !context || typeof context !== "object") {
        throw new TypeError("Deferred Memory stage observation is invalid");
      }

      let identityValue;
      if (context.kind === "upsert") {
        const item = context.value;
        const classification = classifyMemoryForAccountSync(item, { subjectId: runtime.subjectId });
        if (!classification.eligible) {
          return Object.freeze({ status: "local-only", deferred: false });
        }
        identityValue = classification.item;
      } else if (context.kind === "delete") {
        identityValue = validateMemoryForgetRequest(context.value);
        if (identityValue.ownerKind !== "account" || identityValue.ownerId !== runtime.subjectId) {
          return Object.freeze({ status: "foreign-owner", deferred: false });
        }
      } else {
        throw new TypeError("Deferred Memory stage kind is invalid");
      }

      if (result.status === "blocked" && result.reason === "authorization-required") {
        const intent = rememberIntent(runtime, identityValue, context.kind);
        return Object.freeze({ status: "deferred", deferred: true, objectId: intent.id });
      }
      if (TRANSFERRED_STATUSES.has(result.status)) {
        removeIntent(runtime, identityValue.id);
        return Object.freeze({ status: "canonical-owner", deferred: false, objectId: identityValue.id });
      }
      return Object.freeze({ status: "unchanged", deferred: runtime.intents.has(identityValue.id), objectId: identityValue.id });
    },
    replay(memorySyncValue) {
      const memorySync = requireMemorySync(memorySyncValue);
      const runtime = currentRuntime();
      if (!runtime) return Object.freeze({ attempted: 0, transferred: 0, deferred: 0, inactive: true });

      let attempted = 0;
      let transferred = 0;
      for (const intent of [...runtime.intents.values()]) {
        attempted += 1;
        if (canonicalOwnership(memorySync, intent.id)) {
          removeIntent(runtime, intent.id);
          transferred += 1;
          continue;
        }

        const current = findCurrentMemoryItem(memory, runtime.subjectId, intent.id);
        let result;
        if (current) {
          const classification = classifyMemoryForAccountSync(current, { subjectId: runtime.subjectId });
          result = classification.eligible
            ? memorySync.stageUpsert(classification.item)
            : memorySync.stageForget({ id: intent.id, ownerKind: "account", ownerId: runtime.subjectId });
        } else {
          result = memorySync.stageForget({ id: intent.id, ownerKind: "account", ownerId: runtime.subjectId });
        }

        if (TRANSFERRED_STATUSES.has(result.status)) {
          removeIntent(runtime, intent.id);
          transferred += 1;
        } else if (result.status === "blocked" && result.reason === "authorization-required") {
          // Keep durable ownership in the deferred queue until server authority returns.
        } else if (result.status === "blocked") {
          throw new Error(`Deferred Memory replay was blocked: ${result.reason}`);
        }
      }

      return Object.freeze({
        attempted,
        transferred,
        deferred: runtime.intents.size,
        inactive: false,
      });
    },
    pendingIntents() {
      const runtime = currentRuntime();
      return runtime ? Object.freeze([...runtime.intents.values()]) : Object.freeze([]);
    },
    getSnapshot() {
      const runtime = currentRuntime();
      return Object.freeze({
        schema: ACCOUNT_MEMORY_DEFERRED_INTENTS_SCHEMA,
        subjectId: runtime?.subjectId ?? null,
        pendingIntentCount: runtime?.intents.size ?? 0,
        queuePersistence: runtime?.store.scope ?? null,
        storesPortableContent: false,
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      runtimes.clear();
    },
  });
}
