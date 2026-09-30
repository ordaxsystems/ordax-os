export const MEMORY_MUTATION_PORT_SCHEMA = "ordax.memory-mutation/1";

export function assertMemoryMutationPort(port) {
  if (!port || typeof port !== "object" || port.schema !== MEMORY_MUTATION_PORT_SCHEMA) {
    throw new TypeError("Compatible OrdaX Memory mutation port is required");
  }
  for (const method of ["remember", "forget"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Memory mutation port must implement ${method}()`);
    }
  }
  return port;
}
