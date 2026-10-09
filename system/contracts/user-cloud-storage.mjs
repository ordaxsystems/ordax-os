export const USER_CLOUD_STORAGE_OBJECT_SCHEMA = "ordax.user-cloud-object/1";
export const USER_CLOUD_STORAGE_RESERVATION_SCHEMA = "ordax.user-cloud-upload-reservation/1";

const STATES = new Set(["active", "deleted"]);
const PROVIDERS = new Set(["supabase-storage", "cloudflare-r2", "other"]);
const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function uuid(value, label) {
  const normalized = boundedText(value, label, 36);
  if (!UUID_RE.test(normalized)) throw new TypeError(`${label} must be a UUID`);
  return normalized.toLowerCase();
}

function optionalUuid(value, label) {
  return value == null ? null : uuid(value, label);
}

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function timestamp(value, label) {
  const normalized = boundedText(value, label, 64);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be an ISO timestamp`);
  return new Date(parsed).toISOString();
}

function storageSubject(accountId, spaceId) {
  return Object.freeze({
    subjectType: spaceId === null ? "account" : "space",
    subjectId: spaceId ?? accountId,
  });
}

function digest(value, label) {
  const normalized = boundedText(value, label, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function provider(value) {
  const normalized = boundedText(value, "User cloud object provider", 80);
  if (!PROVIDERS.has(normalized)) throw new TypeError("User cloud object provider is invalid");
  return normalized;
}

function providerObjectKey(value) {
  const normalized = boundedText(value, "Provider object key", 512);
  if (/^[\\/]/.test(normalized)) {
    throw new TypeError("Provider object key must be opaque and relative");
  }
  const segments = normalized.split(/[\\/]/);
  if (segments.some(segment => segment === "." || segment === ".." || !segment)) {
    throw new TypeError("Provider object key contains an unsafe path segment");
  }
  return normalized;
}

export function validateUserCloudObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("User cloud object must be an object");
  }
  if (!STATES.has(value.state)) throw new TypeError("User cloud object state is invalid");
  const accountId = uuid(value.accountId, "User cloud object account id");
  const spaceId = optionalUuid(value.spaceId, "User cloud object Space id");
  return Object.freeze({
    schema: USER_CLOUD_STORAGE_OBJECT_SCHEMA,
    objectId: uuid(value.objectId, "User cloud object id"),
    accountId,
    spaceId,
    ...storageSubject(accountId, spaceId),
    displayName: boundedText(value.displayName, "User cloud object display name", 255),
    mediaType: boundedText(value.mediaType, "User cloud object media type", 160),
    sizeBytes: nonNegativeSafeInteger(value.sizeBytes, "User cloud object size"),
    sha256: digest(value.sha256, "User cloud object SHA-256"),
    provider: provider(value.provider),
    providerObjectKey: providerObjectKey(value.providerObjectKey),
    state: value.state,
    serverRevision: positiveSafeInteger(value.serverRevision, "User cloud object server revision"),
    createdAt: timestamp(value.createdAt, "User cloud object createdAt"),
    updatedAt: timestamp(value.updatedAt, "User cloud object updatedAt"),
  });
}

export function validateUploadReservation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Upload reservation must be an object");
  }
  const accountId = uuid(value.accountId, "Upload reservation account id");
  const spaceId = optionalUuid(value.spaceId, "Upload reservation Space id");
  return Object.freeze({
    schema: USER_CLOUD_STORAGE_RESERVATION_SCHEMA,
    reservationId: uuid(value.reservationId, "Upload reservation id"),
    objectId: uuid(value.objectId, "Upload reservation object id"),
    accountId,
    spaceId,
    ...storageSubject(accountId, spaceId),
    expectedSizeBytes: nonNegativeSafeInteger(value.expectedSizeBytes, "Upload reservation size"),
    expectedSha256: digest(value.expectedSha256, "Upload reservation SHA-256"),
    expiresAt: timestamp(value.expiresAt, "Upload reservation expiresAt"),
    actionAuthority: "none",
  });
}
