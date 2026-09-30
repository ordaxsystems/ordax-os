import {
  MAX_MEMORY_SEARCH_OFFSET,
  MAX_MEMORY_SEARCH_RESULTS,
  assertMemoryPort,
  validateMemoryItem,
} from "../../contracts/memory.mjs";
import {
  MEMORY_SYNC_RUNTIME_SCHEMA,
  classifyMemoryForAccountSync,
} from "./account-memory-runtime.mjs";

export const ACCOUNT_MEMORY_LOCAL_BRIDGE_SCHEMA = "ordax.account-memory-local-bridge/1";

function assertMemorySyncRuntime(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== MEMORY_SYNC_RUNTIME_SCHEMA
    || typeof value.stageUpsert !== "function"
    || typeof value.stageForget !== "function"
    || typeof value.getSnapshot !== "function"
  ) {
    throw new TypeError("Account Memory local bridge requires a compatible Memory sync runtime");
  }
  return value;
}

function optionalReporter(value, label) {
  if (value == null) return () => {};
  if (typeof value !== "function") {
    throw new TypeError(`Account Memory local bridge ${label} must be a function`);
  }
  return value;
}

function findExisting(memory, item) {
  if (item.ownerKind !== "account") return null;
  for (let offset = 0; offset <= MAX_MEMORY_SEARCH_OFFSET; offset += MAX_MEMORY_SEARCH_RESULTS) {
    const batch = memory.search({
      ownerKind: "account",
      ownerId: item.ownerId,
      scopes: ["device", "account", "space", "project", "session"],
      includeRestricted: true,
      limit: MAX_MEMORY_SEARCH_RESULTS,
      offset,
    });
    const existing = batch.find((entry) => entry.id === item.id);
    if (existing) return existing;
    if (batch.length < MAX_MEMORY_SEARCH_RESULTS) return null;
  }
  return null;
}

function activeSubjectId(sync) {
  const value = sync.getSnapshot()?.subjectId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function createAccountMemoryLocalBridge({
  memoryPort,
  memorySync,
  onStageError = null,
  onStageResult = null,
} = {}) {
  const memory = assertMemoryPort(memoryPort);
  const sync = assertMemorySyncRuntime(memorySync);
  const reportStageError = optionalReporter(onStageError, "onStageError");
  const reportStageResult = optionalReporter(onStageResult, "onStageResult");
  let lastStageResult = null;

  const stage = (kind, value, operation, extraContext = {}) => {
    const context = Object.freeze({ kind, value, ...extraContext });
    let result = null;
    try {
      result = operation();
      lastStageResult = Object.freeze({ kind, result, error: null });
      try {
        reportStageResult(result, context);
      } catch (error) {
        lastStageResult = Object.freeze({ kind, result, error });
        reportStageError(error, context);
      }
    } catch (error) {
      lastStageResult = Object.freeze({ kind, result: null, error });
      reportStageError(error, context);
    }
    return result;
  };

  const port = Object.freeze({
    schema: memory.schema,
    search(value) {
      return memory.search(value);
    },
    remember(value) {
      const normalized = validateMemoryItem(value);
      const previous = findExisting(memory, normalized);
      const item = memory.remember(normalized);
      const subjectId = activeSubjectId(sync);

      if (
        subjectId
        && previous
        && previous.ownerKind === "account"
        && previous.ownerId === subjectId
      ) {
        const previousClassification = classifyMemoryForAccountSync(previous, { subjectId });
        const currentClassification = classifyMemoryForAccountSync(item, { subjectId });
        if (previousClassification.eligible && !currentClassification.eligible) {
          const request = Object.freeze({
            id: previous.id,
            ownerKind: "account",
            ownerId: previous.ownerId,
          });
          stage(
            "delete",
            request,
            () => sync.stageForget(request),
            { transition: "portable-to-local-only", localItem: item },
          );
          return item;
        }
      }

      stage("upsert", item, () => sync.stageUpsert(item));
      return item;
    },
    forget(value) {
      const forgotten = memory.forget(value);
      if (forgotten) {
        stage("delete", value, () => sync.stageForget(value));
      }
      return forgotten;
    },
    flush() {
      return memory.flush();
    },
  });

  assertMemoryPort(port);

  return Object.freeze({
    schema: ACCOUNT_MEMORY_LOCAL_BRIDGE_SCHEMA,
    port,
    getSnapshot() {
      return Object.freeze({
        schema: ACCOUNT_MEMORY_LOCAL_BRIDGE_SCHEMA,
        memorySync: sync.getSnapshot(),
        lastStageResult,
      });
    },
  });
}
