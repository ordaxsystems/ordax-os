export const MEMORY_MUTATIONS_SCHEMA = "ordax.memory-mutations/1";

export function assertMemoryMutationsPort(port) {
  if (!port || typeof port !== "object" || port.schema !== MEMORY_MUTATIONS_SCHEMA) {
    throw new TypeError("Compatible OrdaX Memory mutations port is required");
  }
  for (const method of ["remember", "forget"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Memory mutations port must implement ${method}()`);
    }
  }
  return port;
}
