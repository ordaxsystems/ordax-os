const SHA256_RE = /^[0-9a-f]{64}$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,128}$/;
export const MAX_APP_ARTIFACT_BYTES = 64 * 1024 * 1024;

export function validateAppArtifactIdentity(value, label = "App artifact") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} identity must be an object`);
  }
  const keys = Object.keys(value).sort();
  const expected = ["name", "sha256", "size"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} identity fields are not canonical`);
  }
  if (
    typeof value.name !== "string"
    || !NAME_RE.test(value.name)
    || typeof value.sha256 !== "string"
    || !SHA256_RE.test(value.sha256)
    || !Number.isSafeInteger(value.size)
    || value.size <= 0
    || value.size > MAX_APP_ARTIFACT_BYTES
  ) {
    throw new TypeError(`${label} identity is invalid`);
  }
  return Object.freeze({
    name: value.name,
    sha256: value.sha256,
    size: value.size,
  });
}
