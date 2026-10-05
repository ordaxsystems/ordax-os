import assert from "node:assert/strict";
import test from "node:test";

import {
  USER_CLOUD_STORAGE_OBJECT_SCHEMA,
  USER_CLOUD_STORAGE_RESERVATION_SCHEMA,
  validateUploadReservation,
  validateUserCloudObject,
} from "../system/contracts/user-cloud-storage.mjs";
import {
  SERVICE_QUOTA_POLICY_SCHEMA,
  SERVICE_QUOTA_USAGE_SCHEMA,
} from "../system/contracts/service-quota.mjs";
import { evaluateServiceQuota } from "../system/services/entitlements/quota.mjs";
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

function cloudObject(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function quotaDecision({
  subjectType = "account",
  subjectId = "account-a",
  used = 100,
  reserved = 0,
  requested = 42,
  limit = 1000,
} = {}) {
  return evaluateServiceQuota({
    policy: {
      schema: SERVICE_QUOTA_POLICY_SCHEMA,
      subjectType,
      subjectId,
      key: "storage.user.bytes",
      unit: "bytes",
      limit,
      authority: "server",
      expiresAt: null,
    },
    usage: {
      schema: SERVICE_QUOTA_USAGE_SCHEMA,
      subjectType,
      subjectId,
      key: "storage.user.bytes",
      unit: "bytes",
      used,
      reserved,
      authority: "server",
      measuredAt: "2029-01-01T00:00:00Z",
    },
    request: {
      subjectType,
      subjectId,
      key: "storage.user.bytes",
      unit: "bytes",
      requested,
    },
  });
}

test("cloud object contract derives quota subject from account or Space context", () => {
  const value = validateUserCloudObject(cloudObject());
  assert.equal(value.schema, USER_CLOUD_STORAGE_OBJECT_SCHEMA);
  assert.equal(value.subjectType, "space");
  assert.equal(value.subjectId, "space-a");
  assert.equal(value.accountId, "account-a");
});

test("provider object keys and revisions fail closed at the same bounds as storage source", () => {
  for (const providerObjectKey of [
    "../escape-key",
    "acct/../escape",
    "acct/./escape",
    "acct/path/..",
    "acct\\escape",
    "/absolute/key",
  ]) {
    assert.throws(() => validateUserCloudObject(cloudObject({ providerObjectKey })));
  }
  assert.throws(() => validateUserCloudObject(cloudObject({ serverRevision: 0 })), /positive safe integer/);
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

test("remote upload consumes the canonical validated quota decision", () => {
  const quota = quotaDecision();
  const result = evaluateUserCloudUpload({ reservation: reservation(), quotaDecision: quota, now });
  assert.equal(result.uploadAuthorized, true);
  assert.equal(result.actionAuthority, "none");
  assert.throws(
    () => evaluateUserCloudUpload({
      reservation: reservation(),
      quotaDecision: { ...quota, actionAuthority: "grant" },
      now,
    }),
    /authority is invalid/,
  );
});

test("quota downgrade blocks only new growth", () => {
  const result = evaluateUserCloudUpload({
    reservation: reservation(),
    quotaDecision: quotaDecision({ used: 100, requested: 42, limit: 50 }),
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
    quotaDecision: quotaDecision({ subjectId: "account-b" }),
    now,
  });
  assert.equal(result.uploadAuthorized, false);
  assert.equal(result.reason, "quota-subject-mismatch");
});

test("quota reservation cannot authorize a different byte count", () => {
  const result = evaluateUserCloudUpload({
    reservation: reservation(),
    quotaDecision: quotaDecision({ requested: 41 }),
    now,
  });
  assert.equal(result.uploadAuthorized, false);
  assert.equal(result.reason, "quota-reservation-size-mismatch");
});

test("expired reservation cannot be authorized", () => {
  const result = evaluateUserCloudUpload({
    reservation: reservation({ expiresAt: "2028-01-01T00:00:00Z" }),
    quotaDecision: quotaDecision(),
    now,
  });
  assert.equal(result.uploadAuthorized, false);
  assert.equal(result.reason, "reservation-expired");
});

test("successful finalization remains bound to exact size and digest", () => {
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
