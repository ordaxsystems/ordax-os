// One platform-neutral contract. This is only device discovery, never MCP grants.
export const PRODUCT_CONNECTOR_SCHEMA = "ordax.product-connector/1";

export function validateProductConnectorSnapshot(value) {
  if (!value || typeof value !== "object") throw new TypeError("Connector state must be an object");
  for (const field of ["available", "enabled", "accountAuthenticated", "requiresClientOAuthAndGrants"]) {
    if (typeof value[field] !== "boolean") throw new TypeError("Invalid Connector state: " + field);
  }
  if (value.canEnableWithoutLogin !== undefined && typeof value.canEnableWithoutLogin !== "boolean") {
    throw new TypeError("Invalid Connector login policy");
  }
  if (value.remoteActionsEnabled !== false || value.mode !== "discovery-only"
      || value.requiresClientOAuthAndGrants !== true) {
    throw new TypeError("Connector cannot advertise ungranted remote actions");
  }
  if (value.enabled && !value.available) throw new TypeError("Unavailable Connector cannot be enabled");
  if (!["disabled", "connecting", "confirmed", "unavailable"].includes(value.presenceState)) {
    throw new TypeError("Invalid Connector presence receipt state");
  }
  if (value.enabled === (value.presenceState === "disabled")) {
    throw new TypeError("Connector consent and presence state mismatch");
  }
  return Object.freeze({
    available: value.available,
    enabled: value.enabled,
    presenceState: value.presenceState,
    accountAuthenticated: value.accountAuthenticated,
    canEnableWithoutLogin: value.canEnableWithoutLogin === true,
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
