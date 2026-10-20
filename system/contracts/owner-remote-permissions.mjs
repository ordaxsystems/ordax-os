/** Read-only Surface projection of Platform-owned per-client grants. */
export const OWNER_REMOTE_PERMISSIONS_SCHEMA = "ordax.owner-remote-permissions/1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validateOwnerRemotePermissions(value) {
  if (!value || value.schema !== OWNER_REMOTE_PERMISSIONS_SCHEMA
    || !UUID.test(value.device_id) || !Array.isArray(value.clients)
    || !Array.isArray(value.grant_groups)) {
    throw new TypeError("Invalid OrdaX owner remote-permission projection");
  }
  if (value.clients.length > 100 || value.grant_groups.length > 300) {
    throw new TypeError("OrdaX remote-permission projection exceeds bounds");
  }
  for (const client of value.clients) {
    if (!UUID.test(client?.client_id) || typeof client.client_name !== "string") {
      throw new TypeError("Invalid OAuth client");
    }
  }
  for (const group of value.grant_groups) {
    if (!UUID.test(group?.grant_group_id) || !UUID.test(group?.client_id)
      || typeof group.profile_key !== "string" || typeof group.scope_kind !== "string"
      || typeof group.client_consent_active !== "boolean") {
      throw new TypeError("Invalid MCP grant");
    }
  }
  return value;
}
export function assertOwnerRemotePermissionsPort(port) {
  if (!port || port.schema !== OWNER_REMOTE_PERMISSIONS_SCHEMA
    || typeof port.read !== "function" || typeof port.configure !== "function") {
    throw new TypeError("Owner remote-permissions port required");
  }
  return port;
}
