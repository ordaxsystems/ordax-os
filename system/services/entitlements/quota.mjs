import {
  SERVICE_QUOTA_DECISION_SCHEMA,
  validateServiceQuotaAdmissionRequest,
  validateServiceQuotaPolicy,
  validateServiceQuotaUsage,
} from "../../contracts/service-quota.mjs";

function sameBoundary(left, right) {
  return left.subjectType === right.subjectType
    && left.subjectId === right.subjectId
    && left.key === right.key
    && left.unit === right.unit;
}

function assertSameBoundary(policy, usage, request) {
  if (!sameBoundary(policy, usage) || !sameBoundary(policy, request)) {
    throw new TypeError("Quota policy, usage and request must target the same subject/key/unit");
  }
}

function remaining(limit, used, reserved) {
  if (limit === null) return null;
  return Math.max(0, limit - used - reserved);
}

export function evaluateServiceQuota({ policy: policyValue, usage: usageValue, request: requestValue } = {}) {
  const policy = validateServiceQuotaPolicy(policyValue);
  const usage = validateServiceQuotaUsage(usageValue);
  const request = validateServiceQuotaAdmissionRequest(requestValue);
  assertSameBoundary(policy, usage, request);

  if (policy.authority !== "server") {
    throw new TypeError("Remote quota admission requires a server-authoritative policy");
  }

  const available = remaining(policy.limit, usage.used, usage.reserved);
  const projected = usage.used + usage.reserved + request.requested;
  const overQuotaBeforeRequest = policy.limit !== null && usage.used + usage.reserved > policy.limit;
  const canAllocate = policy.limit === null || projected <= policy.limit;
  const state = policy.limit === null
    ? "unmetered"
    : overQuotaBeforeRequest
      ? "over-quota-retained"
      : canAllocate
        ? "within-quota"
        : "quota-exceeded";

  return Object.freeze({
    schema: SERVICE_QUOTA_DECISION_SCHEMA,
    subjectType: policy.subjectType,
    subjectId: policy.subjectId,
    key: policy.key,
    unit: policy.unit,
    state,
    canAllocate,
    retainExisting: true,
    used: usage.used,
    reserved: usage.reserved,
    requested: request.requested,
    limit: policy.limit,
    remaining: available,
    authority: "server-quota-only",
    actionAuthority: "none",
  });
}
