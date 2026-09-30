import { createAccountSyncRuntime } from "../../services/sync/account-runtime.mjs";
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

function transportAfterMemoryAuthorization(transport, foundation) {
  if (foundation == null || foundation.memorySync == null) return transport;
  if (
    !transport
    || typeof transport !== "object"
    || typeof transport.snapshot !== "function"
    || typeof transport.pullChanges !== "function"
    || typeof transport.applyMutation !== "function"
  ) {
    return transport;
  }

  const waitForCurrentMemoryAuthorization = async () => {
    await foundation.settled();
  };

  return Object.freeze({
    schema: transport.schema,
    async snapshot(value) {
      await waitForCurrentMemoryAuthorization();
      return transport.snapshot(value);
    },
    async pullChanges(value) {
      await waitForCurrentMemoryAuthorization();
      return transport.pullChanges(value);
    },
    async applyMutation(value) {
      await waitForCurrentMemoryAuthorization();
      return transport.applyMutation(value);
    },
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
    transport: transportAfterMemoryAuthorization(transport, accountMemoryFoundation),
    memorySync,
  });
}

export function describeNativeAccountSyncComposition(accountMemoryFoundation = null) {
  return Object.freeze({
    schema: NATIVE_ACCOUNT_SYNC_COMPOSITION_SCHEMA,
    memorySyncSource: accountMemoryFoundation == null ? "none" : "native-account-memory-foundation",
    memorySyncWired: memorySyncFromFoundation(accountMemoryFoundation) !== null,
    publicCloudMemoryEnabled: false,
  });
}
