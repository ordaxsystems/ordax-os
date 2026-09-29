import {
  MEMORY_PORT_SCHEMA,
  assertMemoryPort,
  validateMemoryForgetRequest,
} from "../../contracts/memory.mjs";
import { MEMORY_SYNC_RUNTIME_SCHEMA } from "./account-memory-runtime.mjs";

export const ACCOUNT_MEMORY_CONTINUITY_SCHEMA = "ordax.account-memory-continuity/1";

function assertMemorySyncStagingPort(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== MEMORY_SYNC_RUNTIME_SCHEMA
    || typeof value.stageUpsert !== "function"
    || typeof value.stageForget !== "function"
  ) {
    throw new TypeError("Account Memory continuity requires a compatible Memory sync staging port");
  }
  return value;
}

/**
 * Decorates the canonical local Memory port with account-sync staging.
 *
 * Local Memory remains the source used by Intelligence/review. Writes are
 * committed locally first, then offered to the sync runtime for eligibility,
 * authorization and conflict handling. Remote reconciliation must keep using
 * the undecorated local port so restored objects are not re-staged as local
 * mutations.
 *
 * flush() intentionally flushes only local persistence. The account sync
 * runtime remains the sole owner of cloud transport/cursor advancement.
 */
export function createAccountMemoryContinuityPort({ memoryPort, memorySync } = {}) {
  const memory = assertMemoryPort(memoryPort);
  const sync = assertMemorySyncStagingPort(memorySync);

  return Object.freeze({
    schema: MEMORY_PORT_SCHEMA,
    continuitySchema: ACCOUNT_MEMORY_CONTINUITY_SCHEMA,
    search(value) {
      return memory.search(value);
    },
    remember(value) {
      const item = memory.remember(value);
      sync.stageUpsert(item);
      return item;
    },
    forget(value) {
      const request = validateMemoryForgetRequest(value);
      const removed = memory.forget(request);
      if (removed) sync.stageForget(request);
      return removed;
    },
    async flush() {
      return memory.flush();
    },
  });
}
