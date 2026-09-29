import { assertMemoryPort } from "../../contracts/memory.mjs";
import { MEMORY_SYNC_RUNTIME_SCHEMA } from "./account-memory-runtime.mjs";

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

function optionalStageErrorReporter(value) {
  if (value == null) return () => {};
  if (typeof value !== "function") {
    throw new TypeError("Account Memory local bridge onStageError must be a function");
  }
  return value;
}

export function createAccountMemoryLocalBridge({
  memoryPort,
  memorySync,
  onStageError = null,
} = {}) {
  const memory = assertMemoryPort(memoryPort);
  const sync = assertMemorySyncRuntime(memorySync);
  const reportStageError = optionalStageErrorReporter(onStageError);
  let lastStageResult = null;

  const stage = (kind, operation) => {
    try {
      lastStageResult = Object.freeze({
        kind,
        result: operation(),
        error: null,
      });
    } catch (error) {
      lastStageResult = Object.freeze({ kind, result: null, error });
      reportStageError(error, Object.freeze({ kind }));
    }
  };

  const port = Object.freeze({
    schema: memory.schema,
    search(value) {
      return memory.search(value);
    },
    remember(value) {
      const item = memory.remember(value);
      stage("upsert", () => sync.stageUpsert(item));
      return item;
    },
    forget(value) {
      const forgotten = memory.forget(value);
      if (forgotten) {
        stage("delete", () => sync.stageForget(value));
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
