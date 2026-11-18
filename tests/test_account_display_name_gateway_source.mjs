import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const src = readFileSync(new URL("infra/supabase/functions/ordax-account-gateway/index.ts", root), "utf8");
const transport = readFileSync(new URL("infra/supabase/functions/_shared/account_transport_admission.mjs", root), "utf8");
const migration = readFileSync(new URL(
  "infra/supabase/product/migrations/20261118061000_account_display_name_column_write_v1.sql", root), "utf8");

test("display-name route uses one Account owner, authenticated user and explicit allowlist", () => {
  assert.match(src, /if \(path === "\/account\/profile\/display-name"\)/);
  assert.match(src, /\.from\("ordax_accounts"\)\s*\.update\(\{ display_name: name \}\)/);
  assert.match(src, /\.eq\("user_id", session\.user\.id\)/);
  assert.match(src, /if \(!session\.user \|\| !session\.access\)/);
  assert.match(transport,
    /\["\/account\/profile\/display-name", Object\.freeze\(\{ method: "POST", preActivation: false \}\)\]/);
  assert.doesNotMatch(src, /adminConfig\(\)[\s\S]{0,130}\.update\(\{ display_name/);
});
test("backend accepts only one validated name and returns no tokens or identifiers", () => {
  const route = src.slice(src.indexOf('if (path === "/account/profile/display-name")'),
    src.indexOf("// A subscription is a verified commercial record"));
  assert.match(route, /exactObjectKeys\(payload, \["display_name"\]\)/);
  assert.match(route, /safeAccountDisplayName\(payload\.display_name\)/);
  assert.match(route, /name !== payload\.display_name/);
  assert.match(route, /data\.display_name !== name/);
  assert.match(route, /schema: "ordax\.account-display-name-update\/1"/);
  assert.doesNotMatch(route, /access_token|refresh_token|service_role/i);
});
test("existing owner scoped RLS and only display_name column write are required", () => {
  assert.match(migration, /grant update\(display_name\).*authenticated/i);
  assert.match(migration, /ordax_accounts_update_own/);
  assert.match(migration, /char_length\(display_name\) between 1 and 120/);
  assert.doesNotMatch(migration, /create\s+table|create\s+policy/i);
});
