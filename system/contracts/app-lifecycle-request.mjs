import { validateComponentId } from "./component-manifest.mjs";

const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUEST_SOURCES = new Set(["store", "launcher"]);
const REQUEST_OPERATIONS = new Set(["install", "update", "remove"]);

export const APP_LIFECYCLE_REQUEST_SCHEMA = "ordax.app-lifecycle-request/1";
export const APP_LIFECYCLE_REQUEST_PORT_SCHEMA = "ordax.app-lifecycle-request-port/1";
export const APP_LIFECYCLE_REQUEST_RESULT_SCHEMA = "ordax.app-lifecycle-request-result/1";

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

function validateIdentity(value, label) {
  if (typeof value.requestId !== "string" || !REQUEST_ID_RE.test(value.requestId)) {
    throw new TypeError(`${label} has invalid requestId`);
  }
  let appId;
  try {
    appId = validateComponentId(value.appId);
  } catch {
    throw new TypeError(`${label} has invalid appId`);
  }
  if (!REQUEST_OPERATIONS.has(value.operation)) {
    throw new TypeError(`${label} has invalid operation`);
  }
  if (!REQUEST_SOURCES.has(value.source)) {
    throw new TypeError(`${label} has invalid source`);
  }
  if (value.source === "launcher" && value.operation !== "install") {
    throw new TypeError("Launcher may request install only");
  }
  if (value.authority !== "none") {
    throw new TypeError(`${label} must remain authority:none`);
  }
  return appId;
}

export function validateAppLifecycleRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App lifecycle request must be an object");
  }
  assertExactKeys(
    value,
    ["schema", "requestId", "appId", "operation", "source", "authority"],
    "App lifecycle request",
  );
  if (value.schema !== APP_LIFECYCLE_REQUEST_SCHEMA) {
    throw new TypeError("Unsupported app lifecycle request schema");
  }
  const appId = validateIdentity(value, "App lifecycle request");
  return Object.freeze({ ...value, appId });
}

export function validateAppLifecycleRequestResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App lifecycle request result must be an object");
  }
  assertExactKeys(
    value,
    ["schema", "requestId", "appId", "operation", "source", "state", "reason", "authority"],
    "App lifecycle request result",
  );
  if (value.schema !== APP_LIFECYCLE_REQUEST_RESULT_SCHEMA) {
    throw new TypeError("Unsupported app lifecycle request result schema");
  }
  const appId = validateIdentity(value, "App lifecycle request result");
  if (!["accepted", "rejected"].includes(value.state)) {
    throw new TypeError("App lifecycle request result has invalid state");
  }
  if (
    value.reason !== null
    && (typeof value.reason !== "string" || !value.reason.trim() || value.reason.length > 160)
  ) {
    throw new TypeError("App lifecycle request result reason must be null or bounded text");
  }
  if (value.state === "accepted" && value.reason !== null) {
    throw new TypeError("Accepted app lifecycle request cannot carry rejection reason");
  }
  if (value.state === "rejected" && value.reason === null) {
    throw new TypeError("Rejected app lifecycle request requires reason");
  }
  return Object.freeze({ ...value, appId });
}

export function assertAppLifecycleRequestPort(port) {
  if (
    !port
    || typeof port !== "object"
    || Array.isArray(port)
    || port.schema !== APP_LIFECYCLE_REQUEST_PORT_SCHEMA
    || port.authority !== "none"
    || typeof port.requestLifecycle !== "function"
  ) {
    throw new TypeError("A compatible authority-free app-lifecycle-request port is required");
  }
  assertExactKeys(
    port,
    ["schema", "authority", "requestLifecycle"],
    "App lifecycle request port",
  );
  for (const forbidden of [
    "install",
    "update",
    "remove",
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
    "deleteData",
    "purgeData",
  ]) {
    if (forbidden in port) {
      throw new TypeError(`App lifecycle request port must not expose lifecycle authority: ${forbidden}`);
    }
  }
  return port;
}


export function validateAppLifecycleRequestResultForRequest(rawResult, rawRequest) {
  const request = validateAppLifecycleRequest(rawRequest);
  const result = validateAppLifecycleRequestResult(rawResult);
  if (
    result.requestId !== request.requestId
    || result.appId !== request.appId
    || result.operation !== request.operation
    || result.source !== request.source
  ) {
    throw new TypeError("App lifecycle request result identity mismatch");
  }
  return result;
}
