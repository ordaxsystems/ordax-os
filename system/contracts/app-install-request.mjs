const APP_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUEST_SOURCES = new Set(["store", "launcher"]);

export const APP_INSTALL_REQUEST_SCHEMA = "ordax.app-install-request/1";
export const APP_INSTALL_REQUEST_PORT_SCHEMA = "ordax.app-install-request-port/1";

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

export function validateAppInstallRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App install request must be an object");
  }
  assertExactKeys(
    value,
    ["schema", "requestId", "appId", "source", "authority"],
    "App install request",
  );
  if (value.schema !== APP_INSTALL_REQUEST_SCHEMA) {
    throw new TypeError("Unsupported app install request schema");
  }
  if (typeof value.requestId !== "string" || !REQUEST_ID_RE.test(value.requestId)) {
    throw new TypeError("App install request has invalid requestId");
  }
  if (typeof value.appId !== "string" || !APP_ID_RE.test(value.appId)) {
    throw new TypeError("App install request has invalid appId");
  }
  if (!REQUEST_SOURCES.has(value.source)) {
    throw new TypeError("App install request has invalid source");
  }
  if (value.authority !== "none") {
    throw new TypeError("App install request must remain authority:none");
  }
  return Object.freeze({ ...value });
}

export function assertAppInstallRequestPort(port) {
  if (!port || typeof port !== "object" || port.schema !== APP_INSTALL_REQUEST_PORT_SCHEMA) {
    throw new TypeError("A compatible app-install-request port is required");
  }
  if (typeof port.requestInstall !== "function") {
    throw new TypeError("App-install-request port must implement requestInstall()");
  }
  return port;
}
