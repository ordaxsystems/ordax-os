import {
  MEMORY_SYNC_DATA_CLASS,
  validateMemorySyncMutation,
} from "../../../../system/services/sync/account-memory-runtime.mjs";

export const MEMORY_SYNC_GATEWAY_POLICY_SCHEMA = "ordax.memory-sync-gateway-policy/1";

export function validateMemorySyncMutationForGateway(value, { subjectId } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Memory sync gateway mutation must be an object");
  }
  if (value.dataClass !== MEMORY_SYNC_DATA_CLASS) {
    throw new TypeError("Memory sync gateway policy only accepts the Memory data class");
  }
  return validateMemorySyncMutation(value, { subjectId });
}
