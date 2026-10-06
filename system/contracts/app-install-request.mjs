import { validateComponentId } from "./component-manifest.mjs";

const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUEST_SOURCES = new Set(["store", "launcher"]);

export const APP_INSTALL_REQUEST_SCHEMA = "ordax.app-install-request/1";
export const APP_INSTALL_REQUEST_PORT_SCHEMA = "ordax.app-install-request-port/1";
export const APP_INSTALL_REQUEST_RESULT_SCHEMA = "ordax.app-install-request-result/1";

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
  let appId;
  try {
    appId = validateComponentId(value.appId);
  } catch {
    throw new TypeError("App install request has invalid appId");
  }
  if (!REQUEST_SOURCES.has(value.source)) {
    throw new TypeError("App install request has invalid source");
  }
  if (value.authority !== "none") {
    throw new TypeError("App install request must remain authority:none");
  }
  return Object.freeze({ ...value, appId });
}

export function validateAppInstallRequestResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App install request result must be an object");
  }
  assertExactKeys(
    value,
    ["schema", "requestId", "appId", "state", "reason", "authority"],
    "App install request result",
  );
  if (value.schema !== APP_INSTALL_REQUEST_RESULT_SCHEMA) {
    throw new TypeError("Unsupported app install request result schema");
  }
  if (typeof value.requestId !== "string" || !REQUEST_ID_RE.test(value.requestId)) {
    throw new TypeError("App install request result has invalid requestId");
  }
  let appId;
  try {
    appId = validateComponentId(value.appId);
  } catch {
    throw new TypeError("App install request result has invalid appId");
  }
  if (!["accepted", "rejected"].includes(value.state)) {
    throw new TypeError("App install request result has invalid state");
  }
  if (
    value.reason !== null
    && (typeof value.reason !== "string" || !value.reason.trim() || value.reason.length > 160)
  ) {
    throw new TypeError("App install request result reason must be null or bounded text");
  }
  if (value.state === "accepted" && value.reason !== null) {
    throw new TypeError("Accepted app install request cannot carry rejection reason");
  }
  if (value.state === "rejected" && value.reason === null) {
    throw new TypeError("Rejected app install request requires reason");
  }
  if (value.authority !== "none") {
    throw new TypeError("App install request result must remain authority:none");
  }
  return Object.freeze({ ...value, appId });
}

export function assertAppInstallRequestPort(port) {
  if (
    !port
    || typeof port !== "object"
    || Array.isArray(port)
    || port.schema !== APP_INSTALL_REQUEST_PORT_SCHEMA
    || port.authority !== "none"
    || typeof port.requestInstall !== "function"
  ) {
    throw new TypeError("A compatible authority-free app-install-request port is required");
  }
  assertExactKeys(
    port,
    ["schema", "authority", "requestInstall"],
    "App install request port",
  );
  for (const forbidden of [
    "install",
    "uninstall",
    "stage",
    "promote",
    "rollback",
    "installArtifact",
    "publish",
    "activate",
    "execute",
    "invoke",
    "grant",
    "setTrustAnchor",
  ]) {
    if (forbidden in port) {
      throw new TypeError(`App-install-request port must not expose lifecycle authority: ${forbidden}`);
    }
  }
  return port;
}
