// Canonical server subscription projection for the Account gateway. No checkout or grant authority.
// Keep it inside Supabase's function source closure: one module, no copied validator.
// A missing subscription must never be presented as Free or as a confirmed cancellation.
export const ACCOUNT_SUBSCRIPTION_VIEW_SCHEMA = "ordax.account-subscription-view/1";
export const PLAN_IDS = Object.freeze(["free", "personal", "professional", "team"]);
export const SUBSCRIPTION_STATES = Object.freeze([
  "trialing", "active", "past_due", "unpaid", "canceled", "incomplete", "expired",
]);

const planIds = new Set(PLAN_IDS);
const states = new Set(SUBSCRIPTION_STATES);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const iso = value => {
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
};
const validDate = value => value === null || iso(value) !== null;

export function projectAccountSubscription({ accountId, row = null, asOf } = {}) {
  if (!uuid.test(accountId)) throw new TypeError("account-subscription-subject-invalid");
  if (!Number.isSafeInteger(asOf) || asOf < 0) throw new TypeError("account-subscription-clock-invalid");
  // No verified state is not equivalent to being on a free plan.
  if (row === null) return Object.freeze({
    schema: ACCOUNT_SUBSCRIPTION_VIEW_SCHEMA,
    source: "server",
    status: "unverified",
    planId: null,
    lifecycle: null,
    currentPeriodEnd: null,
    cancellationScheduled: false,
    billing: "unavailable",
    entitlements: "separate-authority",
  });
  if (!exactKeys(row, [
    "owner_user_id", "plan_id", "lifecycle", "source", "verified_at",
    "current_period_start", "current_period_end", "cancel_at_period_end",
  ]) || row.owner_user_id !== accountId
      || !planIds.has(row.plan_id) || !states.has(row.lifecycle)
      || !["operator-free", "verified-provider"].includes(row.source)
      || !validDate(row.verified_at) || row.verified_at === null
      || !validDate(row.current_period_start)
      || !validDate(row.current_period_end)
      || typeof row.cancel_at_period_end !== "boolean"
      || iso(row.verified_at) > asOf
      || (row.plan_id === "free" && row.source !== "operator-free")
      || (row.plan_id !== "free" && row.source !== "verified-provider")
      || (row.plan_id === "free" && row.lifecycle !== "active")
      || (row.plan_id !== "free" && (row.current_period_start === null || row.current_period_end === null))
      || (row.current_period_start !== null && row.current_period_end !== null
        && iso(row.current_period_start) >= iso(row.current_period_end))
      || (row.source === "operator-free" && (row.cancel_at_period_end
        || row.current_period_start !== null || row.current_period_end !== null))) {
    throw new TypeError("account-subscription-row-invalid");
  }
  const periodExpired = row.current_period_end !== null && iso(row.current_period_end) <= asOf;
  const periodNotStarted = row.current_period_start !== null && iso(row.current_period_start) > asOf;
  // A stale paid period is not a confirmed paid entitlement or an active subscription.
  return Object.freeze({
    schema: ACCOUNT_SUBSCRIPTION_VIEW_SCHEMA,
    source: "server",
    status: periodExpired || periodNotStarted ? "stale" : "verified",
    planId: row.plan_id,
    lifecycle: row.lifecycle,
    currentPeriodEnd: row.current_period_end,
    cancellationScheduled: row.cancel_at_period_end,
    billing: "separate-authority",
    entitlements: "separate-authority",
  });
}
