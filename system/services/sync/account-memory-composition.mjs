import { assertMemoryPort } from "../../contracts/memory.mjs";
import { createAccountMemoryLocalBridge } from "./account-memory-local-bridge.mjs";
import { createAccountMemorySessionRuntime } from "./account-memory-session-runtime.mjs";

export const ACCOUNT_MEMORY_COMPOSITION_SCHEMA = "ordax.account-memory-composition/1";

export function createAccountMemorySyncComposition({
  identitySession,
  memoryPort,
  createSyncStateStore,
  authorizeSync,
  createIdempotencyKey,
  onStageError = null,
  onStageResult = null,
} = {}) {
  const baseMemory = assertMemoryPort(memoryPort);
  const memorySync = createAccountMemorySessionRuntime({
    identitySession,
    memoryPort: baseMemory,
    createSyncStateStore,
    authorizeSync,
    createIdempotencyKey,
  });
  const localBridge = createAccountMemoryLocalBridge({
    memoryPort: baseMemory,
    memorySync,
    onStageError,
    onStageResult,
  });

  let destroyed = false;

  return Object.freeze({
    schema: ACCOUNT_MEMORY_COMPOSITION_SCHEMA,
    memory: localBridge.port,
    baseMemory,
    memorySync,
    getSnapshot() {
      if (destroyed) throw new Error("Account Memory sync composition is disposed");
      return Object.freeze({
        schema: ACCOUNT_MEMORY_COMPOSITION_SCHEMA,
        memorySync: memorySync.getSnapshot(),
        localBridge: localBridge.getSnapshot(),
        remoteApplyStagesOutboundMutation: false,
        productionPromoted: false,
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      memorySync.destroy();
    },
  });
}
