import { validateUploadReservation } from "../../contracts/user-cloud-storage.mjs";

export const USER_CLOUD_STORAGE_POLICY_SCHEMA = "ordax.user-cloud-storage-policy/1";

function assertServerAuthority(value, label) {
  if (!value || typeof value !== "object" || value.authority !== "server") {
    throw new TypeError(`${label} must be server-authoritative`);
  }
  return value;
}

export function evaluateUserCloudUpload({ reservation, quotaDecision, now = Date.now() }) {
  const validated = validateUploadReservation(reservation);
  const quota = assertServerAuthority(quotaDecision, "Quota decision");
  const expiresAt = Date.parse(validated.expiresAt);

  if (!Number.isFinite(now) || now < 0) {
    throw new TypeError("Current time is invalid");
  }
  if (expiresAt <= now) {
    return Object.freeze({
      schema: USER_CLOUD_STORAGE_POLICY_SCHEMA,
      decision: "deny",
      reason: "reservation-expired",
      uploadAuthorized: false,
      actionAuthority: "none",
    });
  }
  if (quota.subjectType !== validated.ownerType || quota.subjectId !== validated.ownerId) {
    return Object.freeze({
      schema: USER_CLOUD_STORAGE_POLICY_SCHEMA,
      decision: "deny",
      reason: "quota-subject-mismatch",
      uploadAuthorized: false,
      actionAuthority: "none",
    });
  }
  if (quota.decision !== "allowed") {
    return Object.freeze({
      schema: USER_CLOUD_STORAGE_POLICY_SCHEMA,
      decision: "deny",
      reason: quota.decision === "limited" ? "quota-growth-blocked" : "quota-denied",
      uploadAuthorized: false,
      actionAuthority: "none",
    });
  }

  return Object.freeze({
    schema: USER_CLOUD_STORAGE_POLICY_SCHEMA,
    decision: "allow-reservation",
    reason: "server-quota-and-reservation-valid",
    uploadAuthorized: true,
    reservationId: validated.reservationId,
    objectId: validated.objectId,
    expectedSizeBytes: validated.expectedSizeBytes,
    expectedSha256: validated.expectedSha256,
    expiresAt: validated.expiresAt,
    actionAuthority: "none",
  });
}

export function verifyUploadFinalization({ reservation, actualSizeBytes, actualSha256, now = Date.now() }) {
  const validated = validateUploadReservation(reservation);
  if (Date.parse(validated.expiresAt) <= now) {
    throw new Error("Upload reservation expired before finalization");
  }
  if (!Number.isSafeInteger(actualSizeBytes) || actualSizeBytes < 0) {
    throw new TypeError("Actual upload size is invalid");
  }
  if (actualSizeBytes !== validated.expectedSizeBytes) {
    throw new Error("Uploaded object size does not match reservation");
  }
  const digest = typeof actualSha256 === "string" ? actualSha256.trim().toLowerCase() : "";
  if (digest !== validated.expectedSha256) {
    throw new Error("Uploaded object digest does not match reservation");
  }
  return Object.freeze({
    schema: USER_CLOUD_STORAGE_POLICY_SCHEMA,
    finalizationAccepted: true,
    reservationId: validated.reservationId,
    objectId: validated.objectId,
    actionAuthority: "none",
  });
}
