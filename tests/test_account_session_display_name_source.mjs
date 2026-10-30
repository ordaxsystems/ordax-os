import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gateway = readFileSync(new URL(
  "../infra/supabase/functions/ordax-account-gateway/index.ts",
  import.meta.url,
), "utf8");

test("account display name comes from the authenticated user's RLS row", () => {
  const match = gateway.match(/async function readAccountDisplayName\([\s\S]*?\r?\n}\r?\n/);
  assert.ok(match, "readAccountDisplayName owner must exist");
  const owner = match[0];
  assert.match(owner, /client\(access\)/);
  assert.match(owner, /\.from\("ordax_accounts"\)/);
  assert.match(owner, /\.select\("display_name"\)/);
  assert.match(owner, /\.eq\("user_id", userId\)/);
  assert.match(owner, /\.maybeSingle\(\)/);
  assert.match(owner, /safeAccountDisplayName\(data\?\.display_name\)/);
  assert.doesNotMatch(owner, /adminConfig|accountAdminRpc|service_role/i);
  assert.match(owner, /catch \{\s*return null;\s*\}/);
});

test("account session keeps profile display name optional and authentication independent", () => {
  const routeStart = gateway.lastIndexOf('if (path === "/auth/session" && req.method === "GET")');
  const branch = gateway.slice(routeStart,
    gateway.indexOf('if (path === "/auth/login" && req.method === "GET")', routeStart));
  assert.match(branch, /if \(!session\.user\)/);
  assert.match(branch, /readAccountDisplayName\(session\.access, session\.user\.id\)/);
  assert.match(branch, /\.\.\.\(displayName \? \{ displayName \} : \{\}\)/);
  assert.match(branch, /accountCloseEnabled: ACCOUNT_CLOSE_ENABLED/);
});
