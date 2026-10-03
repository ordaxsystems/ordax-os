export const USER_CLOUD_STORAGE_OBJECT_SCHEMA = "ordax.user-cloud-object/1";
export const USER_CLOUD_STORAGE_RESERVATION_SCHEMA = "ordax.user-cloud-upload-reservation/1";

const STATES = new Set(["active", "deleted"]);
const SHA256_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function optionalBoundedText(value, label, max) {
  if (value == null) return null;
  return boundedText(value, label, max);
}

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function timestamp(value, label) {
  const normalized = boundedText(value, label, 64);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  return normalized;
}

function storageSubject(accountId, spaceId) {
  return Object.freeze({
    subjectType: spaceId === null ? "account" : "space",
    subjectId: spaceId ?? accountId,
  });
}

export function validateUserCloudObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("User cloud object must be an object");
  }
  if (!STATES.has(value.state)) {
    throw new TypeError("User cloud object state is invalid");
  }
  const digest = boundedText(value.sha256, "User cloud object SHA-256", 64).toLowerCase();
  if (!SHA256_RE.test(digest)) {
    throw new TypeError("User cloud object SHA-256 is invalid");
  }
  const objectId = boundedText(value.objectId, "User cloud object id", 160);
  const providerObjectKey = boundedText(value.providerObjectKey, "Provider object key", 512);
  if (!ID_RE.test(objectId)) {
    throw new TypeError("User cloud object id is invalid");
  }
  if (providerObjectKey.startsWith("/") || providerObjectKey.includes("../")) {
    throw new TypeError("Provider object key must be opaque and relative");
  }
  const accountId = boundedText(value.accountId, "User cloud object account id", 160);
  const spaceId = optionalBoundedText(value.spaceId, "User cloud object Space id", 160);
  const subject = storageSubject(accountId, spaceId);
  return Object.freeze({
    schema: USER_CLOUD_STORAGE_OBJECT_SCHEMA,
    objectId,
    accountId,
    spaceId,
    ...subject,
    displayName: boundedText(value.displayName, "User cloud object display name", 255),
    mediaType: boundedText(value.mediaType, "User cloud object media type", 160),
    sizeBytes: nonNegativeSafeInteger(value.sizeBytes, "User cloud object size"),
    sha256: digest,
    provider: boundedText(value.provider, "User cloud object provider", 80),
    providerObjectKey,
    state: value.state,
    serverRevision: nonNegativeSafeInteger(value.serverRevision, "User cloud object server revision"),
    createdAt: timestamp(value.createdAt, "User cloud object createdAt"),
    updatedAt: timestamp(value.updatedAt, "User cloud object updatedAt"),
  });
}

export function validateUploadReservation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Upload reservation must be an object");
  }
  const reservationId = boundedText(value.reservationId, "Upload reservation id", 160);
  const objectId = boundedText(value.objectId, "Upload reservation object id", 160);
  if (!ID_RE.test(reservationId) || !ID_RE.test(objectId)) {
    throw new TypeError("Upload reservation identifiers are invalid");
  }
  const digest = boundedText(value.expectedSha256, "Upload reservation SHA-256", 64).toLowerCase();
  if (!SHA256_RE.test(digest)) {
    throw new TypeError("Upload reservation SHA-256 is invalid");
  }
  const accountId = boundedText(value.accountId, "Upload reservation account id", 160);
  const spaceId = optionalBoundedText(value.spaceId, "Upload reservation Space id", 160);
  const subject = storageSubject(accountId, spaceId);
  return Object.freeze({
    schema: USER_CLOUD_STORAGE_RESERVATION_SCHEMA,
    reservationId,
    objectId,
    accountId,
    spaceId,
    ...subject,
    expectedSizeBytes: nonNegativeSafeInteger(value.expectedSizeBytes, "Upload reservation size"),
    expectedSha256: digest,
    expiresAt: timestamp(value.expiresAt, "Upload reservation expiresAt"),
    actionAuthority: "none",
  });
}
