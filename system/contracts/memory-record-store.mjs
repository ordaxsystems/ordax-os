export const MEMORY_RECORD_STORE_SCHEMA = "ordax.memory-record-store/1";
export const MAX_MEMORY_RECORD_CANDIDATES = 4096;

export function assertMemoryRecordStore(store) {
  if (!store || typeof store !== "object" || store.schema !== MEMORY_RECORD_STORE_SCHEMA) {
    throw new TypeError("A compatible memory record store is required");
  }
  if (!["device", "session"].includes(store.scope)) {
    throw new TypeError("Memory record store scope must be device or session");
  }
  for (const method of ["query", "put", "remove", "flush"]) {
    if (typeof store[method] !== "function") {
      throw new TypeError(`Memory record store must implement ${method}()`);
    }
  }
  return store;
}
