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

function validateProtectedRememberResult(result, expected) {
  const saved = validateMemoryItem(result);
  if (
    saved.id !== expected.id
    || saved.ownerKind !== expected.ownerKind
    || saved.ownerId !== expected.ownerId
  ) {
    throw new Error("Protected Account Memory remember returned a different Memory identity");
  }
  return saved;
}

function validateProtectedForgetResult(result) {
  if (typeof result !== "boolean") {
    throw new TypeError("Protected Account Memory forget must return a boolean");
  }
  return result;
}

async function requireLocalDurability(memory) {
  const confirmed = await memory.flush();
  if (confirmed !== true) {
    throw new Error("Local Memory persistence flush was not confirmed");
  }
  return true;
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
        const saved = await protectedAccount.remember(item);
        return validateProtectedRememberResult(saved, item);
      }
      const saved = memory.remember(item);
      await requireLocalDurability(memory);
      return saved;
    },
    async forget(value) {
      const request = validateMemoryForgetRequest(value);
      if (request.ownerKind === "account" && protectedAccount !== null) {
        const removed = await protectedAccount.forget(request);
        return validateProtectedForgetResult(removed);
      }
      const removed = memory.forget(request);
      if (removed) await requireLocalDurability(memory);
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
