export const PROFILE_INSTALL_RECEIPT_SCHEMA = "ordax.profile-install-receipt/1";

const COMPONENT_ID_PATTERN = /^[a-z][a-z0-9._-]{1,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const COMPONENT_KINDS = new Set([
  "app",
  "knowledge-pack",
  "skill-pack",
  "model-pack",
  "connector",
]);
const SIGNATURE_ALGORITHMS = new Set(["ed25519"]);

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exactFields(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((field, index) => field !== wanted[index])) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

function text(value, label, max = 240) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value.includes("\0")) {
    throw new TypeError(`${label} must be bounded text`);
  }
  return value;
}

function sha256(value, label) {
  const result = text(value, label, 64);
  if (!SHA256_PATTERN.test(result)) throw new TypeError(`${label} is invalid`);
  return result;
}

function epoch(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative epoch millisecond`);
  }
  return value;
}

export function validateProfileInstallReceipt(value) {
  const receipt = objectValue(value, "Profile install receipt");
  exactFields(receipt, [
    "schema",
    "artifact",
    "verification",
    "health",
    "installedAt",
  ], "Profile install receipt");
  if (receipt.schema !== PROFILE_INSTALL_RECEIPT_SCHEMA) {
    throw new TypeError("Unsupported Profile install receipt schema");
  }

  const artifact = objectValue(receipt.artifact, "Profile install receipt artifact");
  exactFields(artifact, [
    "id",
    "kind",
    "version",
    "sha256",
    "sizeBytes",
  ], "Profile install receipt artifact");
  const id = text(artifact.id, "artifact id", 128);
  if (!COMPONENT_ID_PATTERN.test(id)) throw new TypeError("artifact id is invalid");
  if (!COMPONENT_KINDS.has(artifact.kind)) throw new TypeError("artifact kind is invalid");
  const version = text(artifact.version, "artifact version", 64);
  if (!SEMVER_PATTERN.test(version)) throw new TypeError("artifact version is invalid");
  if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
    throw new TypeError("artifact sizeBytes is invalid");
  }

  const verification = objectValue(receipt.verification, "Profile install receipt verification");
  exactFields(verification, [
    "signatureAlgorithm",
    "keyId",
    "manifestSha256",
    "verifiedAt",
  ], "Profile install receipt verification");
  if (!SIGNATURE_ALGORITHMS.has(verification.signatureAlgorithm)) {
    throw new TypeError("Profile install receipt signature algorithm is unsupported");
  }

  const health = objectValue(receipt.health, "Profile install receipt health");
  exactFields(health, ["state", "checkedAt"], "Profile install receipt health");
  if (health.state !== "healthy") {
    throw new TypeError("Profile install receipt requires healthy activation proof");
  }

  return Object.freeze({
    schema: PROFILE_INSTALL_RECEIPT_SCHEMA,
    artifact: Object.freeze({
      id,
      kind: artifact.kind,
      version,
      sha256: sha256(artifact.sha256, "artifact sha256"),
      sizeBytes: artifact.sizeBytes,
    }),
    verification: Object.freeze({
      signatureAlgorithm: verification.signatureAlgorithm,
      keyId: text(verification.keyId, "verification keyId", 160),
      manifestSha256: sha256(verification.manifestSha256, "manifest sha256"),
      verifiedAt: epoch(verification.verifiedAt, "verification verifiedAt"),
    }),
    health: Object.freeze({
      state: "healthy",
      checkedAt: epoch(health.checkedAt, "health checkedAt"),
    }),
    installedAt: epoch(receipt.installedAt, "installedAt"),
  });
}

export function inventoryEntryFromVerifiedReceipt(receipt, receiptSha256) {
  const value = validateProfileInstallReceipt(receipt);
  return Object.freeze({
    id: value.artifact.id,
    kind: value.artifact.kind,
    version: value.artifact.version,
    sha256: value.artifact.sha256,
    installedAt: value.installedAt,
    receiptSha256: sha256(receiptSha256, "receipt sha256"),
  });
}
