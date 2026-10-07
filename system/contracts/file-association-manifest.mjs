export const FILE_ASSOCIATION_MANIFEST_SCHEMA = "ordax.file-association-manifest/1";

const APP_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const EXTENSION_RE = /^[a-z0-9][a-z0-9+_-]{0,31}$/;
const ROLES = new Set(["viewer"]);

export function validateFileAssociationManifest(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("File association manifest must be an object");
  }
  const fields = new Set(["schema", "appId", "appVersion", "authority", "role", "extensions"]);
  const keys = Object.keys(value);
  if (keys.length !== fields.size || keys.some((key) => !fields.has(key))) {
    throw new TypeError("File association manifest fields are not canonical");
  }
  if (value.schema !== FILE_ASSOCIATION_MANIFEST_SCHEMA) {
    throw new TypeError("File association manifest schema is incompatible");
  }
  if (typeof value.appId !== "string" || !APP_ID_RE.test(value.appId)) {
    throw new TypeError("File association app id is invalid");
  }
  if (typeof value.appVersion !== "string" || !SEMVER_RE.test(value.appVersion)) {
    throw new TypeError("File association app version is invalid");
  }
  if (expected.appId !== undefined && value.appId !== expected.appId) {
    throw new TypeError("File association app identity drifted");
  }
  if (expected.appVersion !== undefined && value.appVersion !== expected.appVersion) {
    throw new TypeError("File association app version drifted");
  }
  if (value.authority !== "none") {
    throw new TypeError("File association manifest must not carry authority");
  }
  if (!ROLES.has(value.role)) {
    throw new TypeError("File association role is unsupported");
  }
  if (
    !Array.isArray(value.extensions)
    || value.extensions.length === 0
    || value.extensions.length > 128
  ) {
    throw new TypeError("File association extensions must be a bounded non-empty array");
  }
  const extensions = value.extensions.map((extension) => {
    if (
      typeof extension !== "string"
      || extension !== extension.toLowerCase()
      || !EXTENSION_RE.test(extension)
    ) {
      throw new TypeError("File association extension is invalid");
    }
    return extension;
  });
  if (new Set(extensions).size !== extensions.length) {
    throw new TypeError("File association extensions must be unique");
  }
  const sorted = [...extensions].sort();
  if (sorted.some((extension, index) => extension !== extensions[index])) {
    throw new TypeError("File association extensions must be sorted");
  }
  return Object.freeze({
    schema: FILE_ASSOCIATION_MANIFEST_SCHEMA,
    appId: value.appId,
    appVersion: value.appVersion,
    authority: "none",
    role: value.role,
    extensions: Object.freeze(extensions),
  });
}
