import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gateway = readFileSync(new URL("../infra/supabase/functions/ordax-account-gateway/index.ts", import.meta.url), "utf8");
const admission = readFileSync(new URL("../infra/supabase/functions/_shared/account_transport_admission.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("../infra/supabase/product/migrations/20261017143000_space_members_action_capabilities_v1.sql", import.meta.url), "utf8").toLowerCase();

function routeBlock() {
  const start = gateway.indexOf('if (path === "/account/space-members" && req.method === "GET")');
  const end = gateway.indexOf('if (path === "/account/space-actor-capability"', start);
  assert.ok(start >= 0 && end > start, "members route must have an isolated handler block");
  return gateway.slice(start, end);
}

test("gateway uses exact GET-only members RPC", () => {
  const block = routeBlock();
  assert.match(gateway, /SPACE_MEMBERS_PAGE_SCHEMA = "ordax\.space-members-page\/3"/);
  assert.match(block, /supabase\.rpc\("ordax_list_space_members_v1"/);
  assert.match(block, /p_limit: MAX_SPACE_MEMBERS_PAGE_SIZE/);
  assert.match(gateway, /MAX_SPACE_MEMBERS_PAGE_SIZE = 128/);
  assert.doesNotMatch(gateway, /path === "\/account\/space-members" && req\.method === "POST"/);
});

test("members gateway validates and maps target action projection from the canonical RPC", () => {
  const block = routeBlock();
  for (const field of ["can_change_role", "can_suspend", "can_reactivate", "can_remove", "assignable_roles"]) {
    assert.match(block, new RegExp(`raw\\.${field}`));
  }
  assert.match(block, /SPACE_MEMBERSHIP_ASSIGNABLE_ROLES\.has\(role\)/);
  assert.match(block, /new Set\(raw\.assignable_roles\)\.size !== raw\.assignable_roles\.length/);
  assert.match(block, /canChangeRole: raw\.can_change_role/);
  assert.match(block, /assignableRoles: raw\.assignable_roles/);
  assert.match(block, /raw\.state === "active" && raw\.can_reactivate/);
  assert.match(block, /raw\.state === "suspended" && raw\.can_suspend/);
  assert.doesNotMatch(block, /\.from\("ordax_space_members"\)/);
});

test("target action rules are centralized in one private database projection", () => {
  assert.match(migration, /create or replace function private\.ordax_space_member_action_capabilities_v1/);
  assert.match(migration, /p_actor_user_id <> p_target_user_id/);
  assert.match(migration, /not coalesce\(p_target_is_owner, false\)/);
  assert.match(migration, /p_target_role <> 'admin'/);
  assert.match(migration, /cross join lateral private\.ordax_space_member_action_capabilities_v1/);
  assert.match(migration, /from private\.ordax_space_member_action_capabilities_v1/);
  assert.match(migration, /revoke all on function private\.ordax_space_member_action_capabilities_v1/);
  assert.doesNotMatch(migration, /grant\s+execute\s+on\s+function\s+private\.ordax_space_member_action_capabilities_v1/);
});

test("mutation preserves authorization-before-idempotency replay and consumes the shared projection", () => {
  const start = migration.indexOf("create or replace function public.ordax_mutate_space_membership_v1");
  assert.ok(start >= 0);
  const mutation = migration.slice(start);
  const receipt = mutation.indexOf("from private.ordax_space_membership_action_receipts");
  const replay = mutation.indexOf("return query", receipt);
  const projection = mutation.indexOf("from private.ordax_space_member_action_capabilities_v1", replay);
  assert.ok(receipt >= 0 && replay > receipt && projection > replay);
  assert.match(mutation.slice(0, receipt), /v_actor_can_admin := ordax_policy\.can_admin_space\(p_space_id\)/);
  assert.match(mutation, /v_role = any\(coalesce\(v_capability\.assignable_roles/);
});

test("members gateway rejects repeated or regressive provider pages after the requested cursor", () => {
  const block = routeBlock();
  assert.match(block, /const spaceId = requestedSpaceId\.toLowerCase\(\)/);
  assert.match(block, /const cursor = requestedCursor === null \? null : requestedCursor\.toLowerCase\(\)/);
  assert.match(block, /p_after_user_id: cursor/);
  assert.match(block, /let previousUserId = cursor/);
  assert.match(block, /previousUserId !== null && raw\.user_id <= previousUserId/);
  assert.match(block, /previousUserId = raw\.user_id/);
  assert.match(block, /raw\.user_id !== raw\.user_id\.toLowerCase\(\)/);
  assert.match(block, /nextCursor: data\.length === MAX_SPACE_MEMBERS_PAGE_SIZE \? previousUserId : null/);
});

test("transport admits exact GET-only member read", () => {
  assert.match(admission, /["\/account\/space-members", Object\.freeze\({ method: "GET", preActivation: true })]/);
});
