import {
  assertMemoryPort,
  validateMemoryForgetRequest,
  validateMemoryItem,
} from "../../contracts/memory.mjs";
import {
  MEMORY_MUTATIONS_SCHEMA,
  assertMemoryMutationsPort,
} from "../../contracts/memory-mutations.mjs";

function assertAccountMutations(value) {
  if (value === null) return null;
  if (
    !value
    || typeof value !== "object"
    || typeof value.remember !== "function"
    || typeof value.forget !== "function"
  ) {
    throw new TypeError("Durable Memory mutations require compatible account mutations");
  }
  return value;
}

function sameItem(left, right) {
  return JSON.stringify(validateMemoryItem(left)) === JSON.stringify(validateMemoryItem(right));
}

export function createDurableMemoryMutations({
  memoryPort,
  accountMutations = null,
} = {}) {
  const memory = assertMemoryPort(memoryPort);
  const account = assertAccountMutations(accountMutations);

  const port = Object.freeze({
    schema: MEMORY_MUTATIONS_SCHEMA,
    async remember(value) {
      const item = validateMemoryItem(value);
      if (item.ownerKind === "account") {
        if (account === null) {
          throw new Error("Account Memory durable mutation boundary is unavailable");
        }
        const saved = validateMemoryItem(await account.remember(item));
        if (!sameItem(saved, item)) {
          throw new Error("Account Memory durable mutation changed the authorized item");
        }
        return saved;
      }

      const saved = validateMemoryItem(memory.remember(item));
      const durable = await memory.flush();
      if (durable !== true) {
        throw new Error("Device Memory durability was not confirmed");
      }
      return saved;
    },
    async forget(value) {
      const request = validateMemoryForgetRequest(value);
      if (request.ownerKind === "account") {
        if (account === null) {
          throw new Error("Account Memory durable mutation boundary is unavailable");
        }
        const removed = await account.forget(request);
        if (removed !== true && removed !== false) {
          throw new Error("Account Memory durable forget returned an invalid result");
        }
        return removed;
      }

      const removed = memory.forget(request);
      if (!removed) return false;
      const durable = await memory.flush();
      if (durable !== true) {
        throw new Error("Device Memory durability was not confirmed");
      }
      return true;
    },
  });

  return assertMemoryMutationsPort(port);
}
