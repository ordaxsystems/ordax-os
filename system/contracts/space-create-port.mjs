// Windows/Desktop host consumes this command boundary independently of the
// read-only ordax.spaces/1 catalog. The server/RPC authorize all writes.
export const SPACE_CREATE_PORT_SCHEMA = "ordax.space-create-port/1";

export function assertSpaceCreatePort(port) {
  if (!port || typeof port !== "object" || port.schema !== SPACE_CREATE_PORT_SCHEMA
    || typeof port.create !== "function" || typeof port.dispose !== "function") {
    throw new TypeError("Compatible authenticated Space creation port required");
  }
  for (const forbidden of ["getSnapshot", "refresh", "select", "archive", "delete"]) {
    if (forbidden in port) throw new TypeError("Space creation port must not own catalog or lifecycle state");
  }
  return port;
}
