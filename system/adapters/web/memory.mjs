import { resolveWebLocalStorage } from "./local-storage.mjs";
import {
  MEMORY_STORE_SCHEMA,
  assertMemoryStore,
  parseMemorySnapshotPayload,
  validateMemorySnapshot,
} from "../../contracts/memory-store.mjs";

const STORAGE_KEY = "ordax.intelligence.memory.v1";

function validateForScope(snapshot, scope) {
  const validated = validateMemorySnapshot(snapshot);
  if (scope === "device" && validated.items.some((item) => item.scope === "session")) {
    throw new TypeError("Device memory store cannot persist session-scoped memory");
  }
  if (scope === "session" && validated.items.some((item) => item.scope !== "session")) {
    throw new TypeError("Session memory store cannot pretend durable scopes are persistent");
  }
  return validated;
}

function parseForScope(payload, scope) {
  const validated = parseMemorySnapshotPayload(payload);
  if (scope === "device" && validated.items.some((item) => item.scope === "session")) {
    throw new TypeError("Device memory store cannot load session-scoped memory");
  }
  if (scope === "session" && validated.items.some((item) => item.scope !== "session")) {
    throw new TypeError("Session memory store cannot load durable memory scopes");
  }
  return validated;
}

export function createWebMemoryStore(windowRef = globalThis.window) {
  const storage = resolveWebLocalStorage(windowRef);
  const scope = storage ? "device" : "session";
  let memory = null;

  const store = {
    schema: MEMORY_STORE_SCHEMA,
    scope,
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return memory;
        memory = parseForScope(raw, scope);
      } catch {
        // Corrupt or oversized browser state is ignored without replacing the last valid snapshot.
      }
      return memory;
    },
    save(snapshot) {
      const validated = validateForScope(snapshot, scope);
      if (!storage) {
        memory = validated;
        return true;
      }
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(validated));
        memory = validated;
        return true;
      } catch {
        return false;
      }
    },
    async flush() {
      return true;
    },
  };

  assertMemoryStore(store);
  return Object.freeze(store);
}
