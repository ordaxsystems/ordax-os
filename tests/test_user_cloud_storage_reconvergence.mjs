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
const accountId = "11111111-1111-4111-8111-111111111111";
const otherAccountId = "22222222-2222-4222-8222-222222222222";
const spaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const objectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const reservationId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

function reservation(overrides = {}) {
  return {
    reservationId,
    objectId,
    accountId,
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
    subjectId: accountId,
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

test("cloud object is UUID owner-scoped and provider key is opaque relative data", () => {
  const value = validateUserCloudObject({
    objectId,
    accountId,
    spaceId,
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
  assert.equal(value.subjectId, spaceId);
  assert.equal(value.accountId, accountId);
  for (const unsafe of ["../escape", "acct/../escape", "/absolute", "\\absolute", "acct//empty"]) {
    assert.throws(() => validateUserCloudObject({ ...value, providerObjectKey: unsafe }));
  }
});

test("storage identities, provider and revision match the PostgreSQL schema", () => {
  const base = {
    objectId,
    accountId,
    spaceId: null,
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
  };

  for (const invalid of [
    { objectId: "object:12345678" },
    { accountId: "account-a" },
    { spaceId: "space-a" },
    { provider: "unknown-provider" },
    { serverRevision: 0 },
  ]) {
    assert.throws(() => validateUserCloudObject({ ...base, ...invalid }));
  }

  assert.throws(() => validateUploadReservation(reservation({ reservationId: "reservation:12345678" })));
  assert.throws(() => validateUploadReservation(reservation({ objectId: "object:12345678" })));
  assert.throws(() => validateUploadReservation(reservation({ accountId: "account-a" })));
  assert.throws(() => validateUploadReservation(reservation({ spaceId: "space-a" })));
});

test("reservation derives account or Space quota subject and never carries action authority", () => {
  const account = validateUploadReservation(reservation());
  assert.equal(account.schema, USER_CLOUD_STORAGE_RESERVATION_SCHEMA);
  assert.equal(account.subjectType, "account");
  assert.equal(account.subjectId, accountId);
  assert.equal(account.actionAuthority, "none");

  const space = validateUploadReservation(reservation({ spaceId }));
  assert.equal(space.accountId, accountId);
  assert.equal(space.subjectType, "space");
  assert.equal(space.subjectId, spaceId);
});

test("upload admission consumes the canonical service-quota decision fail-closed", () => {
  assert.throws(
    () => evaluateUserCloudUpload({
      reservation: reservation(),
      quotaDecision: quota({ authority: "server" }),
      now,
    }),
    /authority/,
  );
  assert.throws(
    () => evaluateUserCloudUpload({
      reservation: reservation(),
      quotaDecision: quota({ state: "quota-exceeded", canAllocate: true }),
      now,
    }),
    /inconsistent/,
  );
});

test("quota downgrade retains existing data but blocks new growth", () => {
  const result = evaluateUserCloudUpload({
    reservation: reservation(),
    quotaDecision: quota({
      state: "over-quota-retained",
      canAllocate: false,
      used: 1200,
      limit: 1000,
      remaining: 0,
    }),
    now,
  });
  assert.equal(result.schema, USER_CLOUD_STORAGE_POLICY_SCHEMA);
  assert.equal(result.uploadAuthorized, false);
  assert.equal(result.reason, "quota-growth-blocked");
  assert.equal(result.actionAuthority, "none");
});

test("quota decision cannot be replayed across subjects or byte reservations", () => {
  const crossAccount = evaluateUserCloudUpload({
    reservation: reservation(),
    quotaDecision: quota({ subjectId: otherAccountId }),
    now,
  });
  assert.equal(crossAccount.reason, "quota-subject-mismatch");

  const sizeMismatch = evaluateUserCloudUpload({
    reservation: reservation(),
    quotaDecision: quota({ requested: 41 }),
    now,
  });
  assert.equal(sizeMismatch.reason, "quota-reservation-size-mismatch");
});

test("successful reservation and finalization remain bound to exact size and digest", () => {
  const result = evaluateUserCloudUpload({ reservation: reservation(), quotaDecision: quota(), now });
  assert.equal(result.uploadAuthorized, true);
  assert.equal(result.actionAuthority, "none");
  assert.equal(result.expectedSizeBytes, 42);
  assert.equal(result.expectedSha256, digest);

  const finalized = verifyUploadFinalization({
    reservation: reservation(),
    actualSizeBytes: 42,
    actualSha256: digest,
    now,
  });
  assert.equal(finalized.finalizationAccepted, true);
  assert.equal(finalized.actionAuthority, "none");
  assert.throws(() => verifyUploadFinalization({
    reservation: reservation(), actualSizeBytes: 43, actualSha256: digest, now,
  }), /size/);
  assert.throws(() => verifyUploadFinalization({
    reservation: reservation(), actualSizeBytes: 42, actualSha256: "b".repeat(64), now,
  }), /digest/);
});

test("expired reservation never authorizes upload or finalization", () => {
  const expired = reservation({ expiresAt: "2028-01-01T00:00:00.000Z" });
  const admission = evaluateUserCloudUpload({ reservation: expired, quotaDecision: quota(), now });
  assert.equal(admission.uploadAuthorized, false);
  assert.equal(admission.reason, "reservation-expired");
  assert.throws(() => verifyUploadFinalization({
    reservation: expired, actualSizeBytes: 42, actualSha256: digest, now,
  }), /expired/);
});
