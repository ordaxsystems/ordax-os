import {
  assertMemoryPort,
  validateMemoryForgetRequest,
  validateMemoryItem,
} from "../../contracts/memory.mjs";
import {
  MEMORY_MUTATION_PORT_SCHEMA,
  assertMemoryMutationPort,
} from "../../contracts/memory-mutation.mjs";

function optionalProtectedAccountMutations(value) {
  if (value == null) return null;
  if (
    typeof value !== "object"
    || typeof value.remember !== "function"
    || typeof value.forget !== "function"
  ) {
    throw new TypeError("Protected Account Memory mutations must implement remember() and forget()");
  }
  return value;
}

export function createMemoryMutationPort({
  memoryPort,
  protectedAccountMutations = null,
} = {}) {
  const memory = assertMemoryPort(memoryPort);
  const protectedAccount = optionalProtectedAccountMutations(protectedAccountMutations);

  const port = Object.freeze({
    schema: MEMORY_MUTATION_PORT_SCHEMA,
    async remember(value) {
      const item = validateMemoryItem(value);
      if (item.ownerKind === "account" && protectedAccount !== null) {
        return protectedAccount.remember(item);
      }
      const saved = memory.remember(item);
      await memory.flush();
      return saved;
    },
    async forget(value) {
      const request = validateMemoryForgetRequest(value);
      if (request.ownerKind === "account" && protectedAccount !== null) {
        return protectedAccount.forget(request);
      }
      const removed = memory.forget(request);
      if (removed) await memory.flush();
      return removed;
    },
    getSnapshot() {
      return Object.freeze({
        schema: MEMORY_MUTATION_PORT_SCHEMA,
        protectedAccountMutations: protectedAccount !== null,
        localFallbackDurableFlush: true,
        cloudTransportOwned: false,
      });
    },
  });

  return assertMemoryMutationPort(port);
}
