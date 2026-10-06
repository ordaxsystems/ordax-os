export const PROJECT_MUTATIONS_SCHEMA = "ordax.project-mutations/1";

export const PROJECT_MUTATION_METHODS = Object.freeze([
  "create",
  "rename",
  "recordOpened",
  "recordFileOpened",
  "clearLastFile",
  "relocateLastFilePath",
  "remove",
]);

export function assertProjectMutations(port) {
  if (!port || typeof port !== "object" || port.schema !== PROJECT_MUTATIONS_SCHEMA) {
    throw new TypeError("A compatible project mutation port is required");
  }
  for (const method of PROJECT_MUTATION_METHODS) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Project mutation port must implement ${method}()`);
    }
  }
  return port;
}
