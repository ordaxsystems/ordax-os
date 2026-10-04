export const APP_DATA_SCHEMA = "ordax.app-data/1";
export const APP_DATA_OWNER_SCOPE = "device";
export const APP_DATA_AUTHORITY = "none";

export const MAX_APP_DATA_KEY_CHARS = 128;
export const MAX_APP_DATA_VALUE_BYTES = 1024 * 1024;
export const MAX_APP_DATA_PARTITION_BYTES = 64 * 1024 * 1024;
export const MAX_APP_DATA_PARTITION_KEYS = 4096;

const APP_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const PUBLISHER_ID_RE = /^[a-z0-9][a-z0-9.-]{0,119}$/;
const APP_DATA_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (
    actual.length !== allowed.length
    || actual.some((key, index) => key !== allowed[index])
  ) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

export function validateAppDataAppId(value) {
  if (typeof value !== "string" || !APP_ID_RE.test(value)) {
    throw new TypeError("App Data appId is invalid");
  }
  return value;
}

export function validateAppDataPublisherId(value) {
  if (typeof value !== "string" || !PUBLISHER_ID_RE.test(value)) {
    throw new TypeError("App Data publisher id is invalid");
  }
  return value;
}

export function validateAppDataIdentity(value) {
  const identity = objectValue(value, "App Data identity");
  exactKeys(identity, ["appId", "publisherId", "ownerScope"], "App Data identity");
  if (identity.ownerScope !== APP_DATA_OWNER_SCOPE) {
    throw new TypeError("App Data v1 supports device-local ownership only");
  }
  return Object.freeze({
    appId: validateAppDataAppId(identity.appId),
    publisherId: validateAppDataPublisherId(identity.publisherId),
    ownerScope: APP_DATA_OWNER_SCOPE,
  });
}

export function validateAppDataKey(value) {
  if (
    typeof value !== "string"
    || value.length > MAX_APP_DATA_KEY_CHARS
    || !APP_DATA_KEY_RE.test(value)
  ) {
    throw new TypeError("App Data key is invalid");
  }
  return value;
}

export function validateAppDataRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("App Data revision must be a non-negative safe integer");
  }
  return value;
}

export function validateAppDataBytes(value) {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError("App Data value must be Uint8Array bytes");
  }
  if (value.byteLength > MAX_APP_DATA_VALUE_BYTES) {
    throw new RangeError("App Data value exceeds the per-value hard bound");
  }
  return new Uint8Array(value);
}

export function validateAppDataPut(value) {
  const command = objectValue(value, "App Data put command");
  exactKeys(command, ["key", "value", "expectedRevision"], "App Data put command");
  return Object.freeze({
    key: validateAppDataKey(command.key),
    value: validateAppDataBytes(command.value),
    expectedRevision: validateAppDataRevision(command.expectedRevision),
  });
}

export function validateAppDataDelete(value) {
  const command = objectValue(value, "App Data delete command");
  exactKeys(command, ["key", "expectedRevision"], "App Data delete command");
  return Object.freeze({
    key: validateAppDataKey(command.key),
    expectedRevision: validateAppDataRevision(command.expectedRevision),
  });
}

export function assertAppDataPort(value) {
  const port = objectValue(value, "App Data port");
  if (port.schema !== APP_DATA_SCHEMA) {
    throw new TypeError("App Data port schema is incompatible");
  }
  if (port.authority !== APP_DATA_AUTHORITY) {
    throw new TypeError("App Data port metadata must not carry authority");
  }
  validateAppDataIdentity(port.identity);
  for (const method of ["get", "list", "put", "delete"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`App Data port is missing ${method}()`);
    }
  }
  return port;
}
