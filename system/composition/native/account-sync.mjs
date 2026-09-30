import { createAccountSyncRuntime } from "../../services/sync/account-runtime.mjs";
import { MEMORY_SYNC_DATA_CLASS } from "../../services/sync/account-memory-runtime.mjs";
import { NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA } from "./account-memory-foundation.mjs";

export const NATIVE_ACCOUNT_SYNC_COMPOSITION_SCHEMA = "ordax.native-account-sync-composition/1";

function memorySyncFromFoundation(value) {
  if (value == null) return null;
  if (
    !value
    || typeof value !== "object"
    || value.schema !== NATIVE_ACCOUNT_MEMORY_FOUNDATION_SCHEMA
  ) {
    throw new TypeError("Native account sync requires the canonical Account Memory foundation");
  }
  return value.memorySync ?? null;
}

function rejectUnreconciledMemory(objects) {
  if (
    Array.isArray(objects)
    && objects.some((object) => object && typeof object === "object" && object.dataClass === MEMORY_SYNC_DATA_CLASS)
  ) {
    throw new Error("Native account sync cannot advance across remote Memory without a Memory reconciler");
  }
}

function transportForMemoryBoundary(transport, memorySync) {
  if (memorySync !== null || transport == null || typeof transport !== "object") return transport;
  return Object.freeze({
    schema: transport.schema,
    async snapshot(value) {
      const result = await transport.snapshot(value);
      rejectUnreconciledMemory(result?.objects);
      return result;
    },
    async pullChanges(value) {
      const result = await transport.pullChanges(value);
      rejectUnreconciledMemory(result?.changes);
      return result;
    },
    applyMutation: (...args) => transport.applyMutation(...args),
  });
}

export function createNativeAccountSyncRuntime({
  accountMemoryFoundation = null,
  transport = null,
  ...options
} = {}) {
  const memorySync = memorySyncFromFoundation(accountMemoryFoundation);
  return createAccountSyncRuntime({
    ...options,
    transport: transportForMemoryBoundary(transport, memorySync),
    memorySync,
  });
}

export function describeNativeAccountSyncComposition(accountMemoryFoundation = null) {
  return Object.freeze({
    schema: NATIVE_ACCOUNT_SYNC_COMPOSITION_SCHEMA,
    memorySyncSource: accountMemoryFoundation == null ? "none" : "native-account-memory-foundation",
    memorySyncWired: memorySyncFromFoundation(accountMemoryFoundation) !== null,
    remoteMemoryWithoutReconciler: "fail-closed",
    publicCloudMemoryEnabled: false,
  });
}
