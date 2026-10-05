import { validateServiceQuotaDecision } from "../../contracts/service-quota.mjs";
import { validateUploadReservation } from "../../contracts/user-cloud-storage.mjs";

export const USER_CLOUD_STORAGE_POLICY_SCHEMA = "ordax.user-cloud-storage-policy/1";

function decision({ decision, reason, extra = {} }) {
  return Object.freeze({
    schema: USER_CLOUD_STORAGE_POLICY_SCHEMA,
    decision,
    reason,
    uploadAuthorized: decision === "allow-reservation",
    actionAuthority: "none",
    ...extra,
  });
}

export function evaluateUserCloudUpload({ reservation, quotaDecision, now = Date.now() }) {
  const validated = validateUploadReservation(reservation);
  const quota = validateServiceQuotaDecision(quotaDecision);
  if (!Number.isFinite(now) || now < 0) throw new TypeError("Current time is invalid");

  if (Date.parse(validated.expiresAt) <= now) {
    return decision({ decision: "deny", reason: "reservation-expired" });
  }
  if (quota.key !== "storage.user.bytes" || quota.unit !== "bytes") {
    throw new TypeError("Quota decision must target storage.user.bytes in bytes");
  }
  if (quota.subjectType !== validated.subjectType || quota.subjectId !== validated.subjectId) {
    return decision({ decision: "deny", reason: "quota-subject-mismatch" });
  }
  if (quota.requested !== validated.expectedSizeBytes) {
    return decision({ decision: "deny", reason: "quota-reservation-size-mismatch" });
  }
  if (!quota.canAllocate) {
    return decision({
      decision: "deny",
      reason: quota.state === "over-quota-retained" ? "quota-growth-blocked" : "quota-denied",
    });
  }

  return decision({
    decision: "allow-reservation",
    reason: "server-quota-and-reservation-valid",
    extra: {
      reservationId: validated.reservationId,
      objectId: validated.objectId,
      subjectType: validated.subjectType,
      subjectId: validated.subjectId,
      expectedSizeBytes: validated.expectedSizeBytes,
      expectedSha256: validated.expectedSha256,
      expiresAt: validated.expiresAt,
    },
  });
}

export function verifyUploadFinalization({ reservation, actualSizeBytes, actualSha256, now = Date.now() }) {
  const validated = validateUploadReservation(reservation);
  if (!Number.isFinite(now) || now < 0) throw new TypeError("Current time is invalid");
  if (Date.parse(validated.expiresAt) <= now) {
    throw new Error("Upload reservation expired before finalization");
  }
  if (!Number.isSafeInteger(actualSizeBytes) || actualSizeBytes < 0) {
    throw new TypeError("Actual upload size is invalid");
  }
  if (actualSizeBytes !== validated.expectedSizeBytes) {
    throw new Error("Uploaded object size does not match reservation");
  }
  const actualDigest = typeof actualSha256 === "string" ? actualSha256.trim().toLowerCase() : "";
  if (actualDigest !== validated.expectedSha256) {
    throw new Error("Uploaded object digest does not match reservation");
  }
  return Object.freeze({
    schema: USER_CLOUD_STORAGE_POLICY_SCHEMA,
    finalizationAccepted: true,
    reservationId: validated.reservationId,
    objectId: validated.objectId,
    subjectType: validated.subjectType,
    subjectId: validated.subjectId,
    actionAuthority: "none",
  });
}
