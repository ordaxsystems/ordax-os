import assert from "node:assert/strict";
import test from "node:test";

import {
  USER_CLOUD_STORAGE_OBJECT_SCHEMA,
  USER_CLOUD_STORAGE_RESERVATION_SCHEMA,
  validateUploadReservation,
  validateUserCloudObject,
} from "../system/contracts/user-cloud-storage.mjs";
import {
  USER_CLOUD_STORAGE_POLICY_SCHEMA,
  evaluateUserCloudUpload,
  verifyUploadFinalization,
} from "../system/services/user-cloud-storage/policy.mjs";

const digest = "a".repeat(64);
const future = "2030-01-01T00:00:00.000Z";
const now = Date.parse("2029-01-01T00:00:00.000Z");

function reservation(overrides = {}) {
  return {
    reservationId: "reservation:12345678",
    objectId: "object:12345678",
    ownerType: "account",
    ownerId: "account-a",
    spaceId: null,
    expectedSizeBytes: 42,
    expectedSha256: digest,
    expiresAt: future,
    ...overrides,
  };
}

function quota(overrides = {}) {
  return {
    subjectType: "account",
    subjectId: "account-a",
    key: "storage.user.bytes",
    decision: "allowed",
    authority: "server",
    ...overrides,
  };
}

test("cloud object contract keeps provider key opaque and owner-bound", () => {
  const value = validateUserCloudObject({
    objectId: "object:12345678",
    ownerType: "space",
    ownerId: "account-a",
    spaceId: "space-a",
    displayName: "model.glb",
    mediaType: "model/gltf-binary",
    sizeBytes: 42,
    sha256: digest,
    provider: "supabase-storage",
    providerObjectKey: "acct/opaque-object-key",
    state: "active",
    serverRevision: 1,
    createdAt: "2029-01-01T00:00:00Z",
    updatedAt: "2029-01-01T00:00:00Z",
  });
  assert.equal(value.schema, USER_CLOUD_STORAGE_OBJECT_SCHEMA);
  assert.equal(value.spaceId, "space-a");
  assert.throws(() => validateUserCloudObject({ ...value, providerObjectKey: "../escape" }));
});

test("reservation never carries action authority", () => {
  const value = validateUploadReservation(reservation());
  assert.equal(value.schema, USER_CLOUD_STORAGE_RESERVATION_SCHEMA);
  assert.equal(value.actionAuthority, "none");
});

test("remote upload requires a server-authoritative quota decision", () => {
  assert.throws(
    () => evaluateUserCloudUpload({ reservation: reservation(), quotaDecision: quota({ authority: "local-default" }), now }),
    /server-authoritative/,
  );
});

test("quota downgrade blocks only new growth", () => {
  const result = evaluateUserCloudUpload({
    reservation: reservation(),
    quotaDecision: quota({ decision: "limited" }),
    now,
  });
  assert.equal(result.schema, USER_CLOUD_STORAGE_POLICY_SCHEMA);
  assert.equal(result.uploadAuthorized, false);
  assert.equal(result.reason, "quota-growth-blocked");
  assert.equal(result.actionAuthority, "none");
});

test("quota subject cannot be replayed across accounts", () => {
  const result = evaluateUserCloudUpload({
    reservation: reservation(),
    quotaDecision: quota({ subjectId: "account-b" }),
    now,
  });
  assert.equal(result.uploadAuthorized, false);
  assert.equal(result.reason, "quota-subject-mismatch");
});

test("successful reservation remains bounded by expected size and digest", () => {
  const result = evaluateUserCloudUpload({ reservation: reservation(), quotaDecision: quota(), now });
  assert.equal(result.uploadAuthorized, true);
  assert.equal(result.actionAuthority, "none");
  const finalized = verifyUploadFinalization({
    reservation: reservation(),
    actualSizeBytes: 42,
    actualSha256: digest,
    now,
  });
  assert.equal(finalized.finalizationAccepted, true);
  assert.throws(() => verifyUploadFinalization({
    reservation: reservation(),
    actualSizeBytes: 43,
    actualSha256: digest,
    now,
  }), /size/);
  assert.throws(() => verifyUploadFinalization({
    reservation: reservation(),
    actualSizeBytes: 42,
    actualSha256: "b".repeat(64),
    now,
  }), /digest/);
});
