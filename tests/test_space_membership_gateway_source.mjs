import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gateway = readFileSync(new URL("../infra/supabase/functions/ordax-account-gateway/index.ts", import.meta.url), "utf8");
const admission = readFileSync(new URL("../infra/supabase/functions/_shared/account_transport_admission.mjs", import.meta.url), "utf8");

function routeBlock() {
  const startMarker = 'if (path === "/account/space-membership-actions" && req.method === "POST")';
  const endMarker = 'if (path === "/account/entitlements/memory-cloud")';
  const start = gateway.indexOf(startMarker);
  const end = gateway.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "membership action route must have an isolated handler block");
  return gateway.slice(start, end);
}

test("transport admits one exact POST membership action route", () => {
  assert.match(
    admission,
    /\["\/account\/space-membership-actions", Object\.freeze\(\{ method: "POST", preActivation: false \}\)\]/,
  );
  assert.doesNotMatch(admission, /\["\/account\/space-membership-actions", Object\.freeze\(\{ method: "GET"/);
});

test("gateway membership action route delegates only to canonical RPC", () => {
  const block = routeBlock();
  assert.match(block, /ordax_mutate_space_membership_v1/);
  assert.match(block, /p_space_id: request\.spaceId/);
  assert.match(block, /p_target_user_id: request\.targetUserId/);
  assert.match(block, /p_action: request\.action/);
  assert.match(block, /p_role: request\.role/);
  assert.match(block, /p_idempotency_key: request\.idempotencyKey/);
  assert.doesNotMatch(block, /\.from\("ordax_space_members"\)/);
  assert.doesNotMatch(block, /actorId|actorRole|ownerId|authorized/);
});

test("gateway validates exact request and response shapes at transport boundary", () => {
  assert.match(gateway, /function parseSpaceMembershipActionBody\(raw: string\)/);
  assert.match(gateway, /Object\.keys\(value\)\.some\(\(key\) => !allowed\.has\(key\)\)/);
  assert.match(gateway, /SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA/);
  assert.match(gateway, /SPACE_MEMBERSHIP_ACTION_RESULT_SCHEMA/);
  const block = routeBlock();
  assert.match(block, /mediaType !== "application\/json"/);
  assert.match(block, /Array\.isArray\(data\) \|\| data\.length !== 1/);
  assert.match(block, /result\.space_id !== request\.spaceId/);
  assert.match(block, /result\.target_user_id !== request\.targetUserId/);
});
