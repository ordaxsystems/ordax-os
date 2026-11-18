import test from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT_SUBSCRIPTION_VIEW_SCHEMA, projectAccountSubscription } from "../system/services/entitlements/subscription.mjs";

const id = "8bce09bf-963b-4ccb-8f67-e1b02e44a873";
const other = "33f58c01-65f2-4e2f-b3cd-179b76a5469b";
const now = Date.parse("2026-11-18T12:00:00.000Z");
const paid = () => ({
  owner_user_id: id, plan_id: "personal", lifecycle: "active",
  source: "verified-provider", verified_at: "2026-11-18T10:00:00.000Z",
  current_period_start: "2026-11-01T00:00:00.000Z",
  current_period_end: "2026-12-01T00:00:00.000Z",
  cancel_at_period_end: false,
});
test("absence is unverified, never Free, active or paid", () => {
  assert.deepEqual(projectAccountSubscription({ accountId: id, asOf: now }), {
    schema: ACCOUNT_SUBSCRIPTION_VIEW_SCHEMA, source: "server", status: "unverified",
    planId: null, lifecycle: null, currentPeriodEnd: null, cancellationScheduled: false,
    billing: "unavailable", entitlements: "separate-authority",
  });
});
test("verified paid subscription is a read-only projection without granting entitlements", () => {
  const view = projectAccountSubscription({ accountId: id, row: paid(), asOf: now });
  assert.equal(view.status, "verified");
  assert.equal(view.planId, "personal");
  assert.equal(view.entitlements, "separate-authority");
  assert.equal(view.billing, "separate-authority");
  assert.equal(Object.isFrozen(view), true);
  assert.equal("provider_id" in view, false);
});
test("explicit Free from operator authority is separate from absent record", () => {
  const row = { ...paid(), plan_id: "free", lifecycle: "active", source: "operator-free",
    current_period_start: null, current_period_end: null };
  const view = projectAccountSubscription({ accountId: id, row, asOf: now });
  assert.equal(view.status, "verified");
  assert.equal(view.planId, "free");
});
test("stale paid period never displays verified status", () => {
  assert.equal(projectAccountSubscription({ accountId: id, row: { ...paid(),
    current_period_end: "2026-11-18T11:00:00.000Z" }, asOf: now }).status, "stale");
});
test("cancellation and past-due are faithfully surfaced without inventing paid authority", () => {
  const view = projectAccountSubscription({ accountId: id, row: {
    ...paid(), lifecycle: "past_due", cancel_at_period_end: true,
  }, asOf: now });
  assert.equal(view.lifecycle, "past_due");
  assert.equal(view.cancellationScheduled, true);
});
test("rejects subject swap, client-provided paid state and invalid timing", () => {
  for (const row of [
    { ...paid(), owner_user_id: other },
    { ...paid(), source: "operator-free" },
    { ...paid(), plan_id: "enterprise" },
    { ...paid(), verified_at: "2027-01-01T00:00:00.000Z" },
    { ...paid(), current_period_end: "2026-11-01T00:00:00.000Z" },
    { ...paid(), extra: "injected" },
    { ...paid(), cancel_at_period_end: "true" },
    { ...paid(), source: "browser" },
    { ...paid(), verified_at: null },
  ]) assert.throws(() => projectAccountSubscription({ accountId: id, row, asOf: now }),
    /account-subscription-row-invalid/);
});
test("rejects missing subject, invalid clock and Free fabricated as a paid purchase", () => {
  assert.throws(() => projectAccountSubscription({ accountId: other.slice(1), asOf: now }));
  assert.throws(() => projectAccountSubscription({ accountId: id, asOf: NaN }));
  assert.throws(() => projectAccountSubscription({ accountId: id, row: {
    ...paid(), plan_id: "free",
  }, asOf: now }));
});
