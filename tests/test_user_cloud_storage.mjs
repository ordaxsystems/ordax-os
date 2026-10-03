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
    accountId: "account-a",
    spaceId: null,
    expectedSizeBytes: 42,
    expectedSha256: digest,
    expiresAt: future,
    ...overrides,
  };
}

function quota(overrides = {}) {
  return {
    schema: "ordax.service-quota-decision/1",
    subjectType: "account",
    subjectId: "account-a",
    key: "storage.user.bytes",
    unit: "bytes",
    state: "within-quota",
    canAllocate: true,
    retainExisting: true,
    used: 100,
    reserved: 0,
    requested: 42,
    limit: 1000,
    remaining: 900,
    authority: "server-quota-only",
    actionAuthority: "none",
    ...overrides,
  };
}

test("cloud object contract derives quota subject from account or Space context", () => {
  const value = validateUserCloudObject({
    objectId: "object:12345678",
    accountId: "account-a",
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
  assert.equal(value.subjectType, "space");
  assert.equal(value.subjectId, "space-a");
  assert.equal(value.accountId, "account-a");
  assert.throws(() => validateUserCloudObject({ ...value, providerObjectKey: "../escape" }));
});

test("reservation never carries action authority", () => {
  const value = validateUploadReservation(reservation());
  assert.equal(value.schema, USER_CLOUD_STORAGE_RESERVATION_SCHEMA);
  assert.equal(value.subjectType, "account");
  assert.equal(value.subjectId, "account-a");
  assert.equal(value.actionAuthority, "none");
});

test("Space reservation uses Space as the quota subject without losing account actor", () => {
  const value = validateUploadReservation(reservation({ spaceId: "space-a" }));
  assert.equal(value.accountId, "account-a");
  assert.equal(value.subjectType, "space");
  assert.equal(value.subjectId, "space-a");
});

test("remote upload requires the canonical server-quota-only decision boundary", () => {
  assert.throws(
    () => evaluateUserCloudUpload({
      reservation: reservation(),
      quotaDecision: quota({ authority: "server", actionAuthority: "none" }),
      now,
    }),
    /server quota boundary/,
  );
  assert.throws(
    () => evaluateUserCloudUpload({
      reservation: reservation(),
      quotaDecision: quota({ actionAuthority: "grant" }),
      now,
    }),
    /server quota boundary/,
  );
});

test("quota downgrade blocks only new growth", () => {
  const result = evaluateUserCloudUpload({
    reservation: reservation(),
    quotaDecision: quota({ state: "over-quota-retained", canAllocate: false }),
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

test("quota reservation cannot authorize more or fewer bytes than the exact upload", () => {
  const result = evaluateUserCloudUpload({
    reservation: reservation(),
    quotaDecision: quota({ requested: 41 }),
    now,
  });
  assert.equal(result.uploadAuthorized, false);
  assert.equal(result.reason, "quota-reservation-size-mismatch");
});

test("successful reservation remains bounded by expected size and digest", () => {
  const result = evaluateUserCloudUpload({ reservation: reservation(), quotaDecision: quota(), now });
  assert.equal(result.uploadAuthorized, true);
  assert.equal(result.subjectType, "account");
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
