import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(fs.readFileSync(
  path.join(ROOT, "docs/contracts/entitlements.json"),
  "utf8",
));
const migration = fs.readFileSync(
  path.join(
    ROOT,
    "infra/supabase/product/migrations/20261016043000_space_active_quota_guard_v1.sql",
  ),
  "utf8",
);

test("database fallback matches the canonical Free active-Space entitlement", () => {
  const free = contract.plan_catalog.plans.find((plan) => plan.id === "free");
  assert.ok(free);
  assert.equal(free.mvp_assignable, true);
  assert.equal(contract.commercial_policy.default_plan_id, "free");
  assert.equal(contract.commercial_policy.only_free_assignable_before_billing_activation, true);
  assert.equal(contract.commercial_policy.mvp_provisional_private_space_limit, 2);
  assert.equal(free.baseline_entitlements["spaces.active.max"], 2);

  const fallback = migration.match(/if v_policy_count = 0 then\s+return (\d+);/);
  assert.ok(fallback, "migration must expose an explicit no-grant fallback");
  assert.equal(Number(fallback[1]), free.baseline_entitlements["spaces.active.max"]);
});

test("database guard accepts only server quota policy and fail-closed ambiguity", () => {
  assert.match(migration, /entitlement_key = 'spaces\.active\.max'/);
  assert.match(migration, /v_policy_count <> 1/);
  assert.match(migration, /space-quota-policy-ambiguous/);
  assert.match(migration, /space-quota-policy-invalid/);
  assert.match(migration, /v_policy_value->>'type' <> 'quota'/);
  assert.match(migration, /v_policy_value->>'unit' <> 'items'/);
  assert.match(migration, /v_limit_text::numeric > 64/);
  assert.match(migration, /spaces-active-quota-exceeded/);
});

test("quota is enforced below the gateway on insert and reactivation", () => {
  assert.match(
    migration,
    /before insert or update of owner_user_id, state on public\.ordax_spaces/,
  );
  assert.match(migration, /for update;/);
  assert.match(migration, /new\.state = 'active'/);
  assert.match(migration, /old\.state is distinct from 'active'/);
  assert.match(migration, /old\.owner_user_id is distinct from new\.owner_user_id/);
  assert.match(migration, /owned-space-limit-reached/);
});

test("all currently assignable plan limits fit the hard abuse ceiling", () => {
  const assignable = contract.plan_catalog.plans.filter((plan) => plan.mvp_assignable);
  assert.ok(assignable.length > 0);
  for (const plan of assignable) {
    const limit = plan.baseline_entitlements["spaces.active.max"];
    assert.equal(Number.isInteger(limit), true);
    assert.ok(limit >= 0 && limit <= 64, `${plan.id} active-Space limit is outside MVP ceiling`);
  }
});
