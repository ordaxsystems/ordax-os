import {
  OWNER_REMOTE_PERMISSIONS_SCHEMA, assertOwnerRemotePermissionsPort,
  validateOwnerRemotePermissions,
} from "../../contracts/owner-remote-permissions.mjs";
const ENDPOINT = "/__ordax/native/remote-permissions";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function createNativeOwnerRemotePermissions(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native Owner remote-permission port requires same-origin fetch");
  }
  const request = async (method, body = null) => {
    const response = await windowRef.fetch(ENDPOINT, {
      method, credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const error = new Error("Native Owner remote-permission request failed");
      error.status = response.status;
      throw error;
    }
    return validateOwnerRemotePermissions(await response.json());
  };
  const port = Object.freeze({
    schema: OWNER_REMOTE_PERMISSIONS_SCHEMA,
    read: () => request("GET"),
    configure(clientId, enabled) {
      if (!UUID.test(clientId) || typeof enabled !== "boolean") {
        throw new TypeError("Invalid OAuth client permission change");
      }
      return request("POST", { client_id: clientId, enabled });
    },
  });
  return assertOwnerRemotePermissionsPort(port);
}
