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

function safeAdd(left, right, label) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum) || sum < 0) {
    throw new TypeError(`${label} exceeds safe integer bounds`);
  }
  return sum;
}

function assertPolicyActive(policy) {
  if (policy.expiresAt === null) return;
  const expiresAt = Date.parse(policy.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new TypeError("Service quota policy is expired");
  }
}

export function evaluateServiceQuota({ policy: policyValue, usage: usageValue, request: requestValue } = {}) {
  const policy = validateServiceQuotaPolicy(policyValue);
  const usage = validateServiceQuotaUsage(usageValue);
  const request = validateServiceQuotaAdmissionRequest(requestValue);
  assertSameBoundary(policy, usage, request);

  if (policy.authority !== "server") {
    throw new TypeError("Remote quota admission requires a server-authoritative policy");
  }
  assertPolicyActive(policy);

  const committed = safeAdd(usage.used, usage.reserved, "Service quota committed usage");
  const projected = safeAdd(committed, request.requested, "Service quota projected usage");
  const available = policy.limit === null ? null : Math.max(0, policy.limit - committed);
  const overQuotaBeforeRequest = policy.limit !== null && committed > policy.limit;
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
