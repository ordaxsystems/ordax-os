// One platform-neutral contract. This is only device discovery, never MCP grants.
export const PRODUCT_CONNECTOR_SCHEMA = "ordax.product-connector/1";

export function validateProductConnectorSnapshot(value) {
  if (!value || typeof value !== "object") throw new TypeError("Connector state must be an object");
  for (const field of ["available", "enabled", "accountAuthenticated", "requiresClientOAuthAndGrants"]) {
    if (typeof value[field] !== "boolean") throw new TypeError("Invalid Connector state: " + field);
  }
  if (value.remoteActionsEnabled !== false || value.mode !== "discovery-only"
      || value.requiresClientOAuthAndGrants !== true) {
    throw new TypeError("Connector cannot advertise ungranted remote actions");
  }
  if (value.enabled && !value.available) throw new TypeError("Unavailable Connector cannot be enabled");
  return Object.freeze({
    available: value.available,
    enabled: value.enabled,
    accountAuthenticated: value.accountAuthenticated,
    requiresClientOAuthAndGrants: true,
    remoteActionsEnabled: false,
    mode: "discovery-only",
  });
}

export function assertProductConnectorPort(port) {
  if (!port || port.schema !== PRODUCT_CONNECTOR_SCHEMA
      || typeof port.status !== "function" || typeof port.configure !== "function") {
    throw new TypeError("Compatible Product Connector port required");
  }
  return port;
}
