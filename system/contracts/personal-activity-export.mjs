export const PERSONAL_ACTIVITY_EXPORT_SCHEMA = "ordax.personal-activity-export/1";
export const PERSONAL_ACTIVITY_EXPORT_PORT_SCHEMA = "ordax.personal-activity-export-port/1";
export const MAX_PERSONAL_ACTIVITY_EXPORT_BYTES = 5 * 1024 * 1024;

const FILE_NAME_RE = /^ordax-activity-[0-9]{8}T[0-9]{6}Z\.json$/;

export function validatePersonalActivityExportDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal Activity export document must be an object");
  }
  if (value.schema !== PERSONAL_ACTIVITY_EXPORT_SCHEMA) {
    throw new TypeError("Personal Activity export schema is incompatible");
  }
  if (typeof value.fileName !== "string" || !FILE_NAME_RE.test(value.fileName)) {
    throw new TypeError("Personal Activity export filename is invalid");
  }
  if (value.mediaType !== "application/json") {
    throw new TypeError("Personal Activity export mediaType must be application/json");
  }
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength === 0) {
    throw new TypeError("Personal Activity export bytes must be non-empty");
  }
  if (value.bytes.byteLength > MAX_PERSONAL_ACTIVITY_EXPORT_BYTES) {
    throw new TypeError("Personal Activity export exceeds its byte limit");
  }
  return Object.freeze({
    schema: PERSONAL_ACTIVITY_EXPORT_SCHEMA,
    fileName: value.fileName,
    mediaType: "application/json",
    bytes: value.bytes,
  });
}

export function assertPersonalActivityExportPort(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== PERSONAL_ACTIVITY_EXPORT_PORT_SCHEMA
    || typeof value.save !== "function"
  ) {
    throw new TypeError("Compatible Personal Activity export port is required");
  }
  return value;
}
