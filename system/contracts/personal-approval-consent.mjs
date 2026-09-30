export const PERSONAL_APPROVAL_CONSENT_SCHEMA = "ordax.personal-approval-consent/1";

export function assertPersonalApprovalConsent(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== PERSONAL_APPROVAL_CONSENT_SCHEMA
    || typeof value.canApprove !== "function"
    || typeof value.approve !== "function"
    || typeof value.deny !== "function"
  ) {
    throw new TypeError("A compatible Personal OrdaX approval consent port is required");
  }
  return value;
}
