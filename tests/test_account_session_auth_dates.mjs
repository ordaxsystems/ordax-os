import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../infra/supabase/functions/ordax-account-gateway/index.ts", import.meta.url), "utf8");
const start = source.indexOf("function safeAccountAuthTimestamp(value: unknown): string | null {");
const end = source.indexOf("\n}\n\nasync function readAccountDisplayName(", start);
assert.ok(start > 0 && end > start, "canonical Auth timestamp validator required");
const implementation = source.slice(start, end + 2)
  .replace("value: unknown): string | null", "value)");
const validate = new Function(implementation + "\nreturn safeAccountAuthTimestamp;")();

test("valid Supabase Auth timestamps are canonicalized in UTC", () => {
  assert.equal(validate("2025-06-15T10:15:30+03:00"), "2025-06-15T07:15:30.000Z");
  assert.equal(validate("2024-01-01T00:00:00.000Z"), "2024-01-01T00:00:00.000Z");
});
test("absence, malformed, ambiguous and future Auth timestamps never become account history", () => {
  for (const invalid of [
    null, undefined, 123, "", "today", "2024-01-01", "2024-01-01T00:00:00",
    "2024/01/01 00:00:00", "2100-01-01T00:00:00Z", "1970-01-01T00:00:00Z",
    "2024-11-02T11:00:00+99:00", "2024-01-01T00:00:00Z ".repeat(3),
  ]) assert.equal(validate(invalid), null);
});
test("Account session only projects timestamps supplied by authenticated Supabase Auth user", () => {
  const pos = source.lastIndexOf('if (path === "/auth/session" && req.method === "GET")');
  assert.ok(pos > 0);
  const route = source.slice(pos, source.indexOf('if (path === "/auth/login" && req.method === "GET")', pos));
  assert.match(route,/const session = await authenticated\(req\)/);
  assert.match(route,/if \(!session\.user\)/);
  assert.match(route,/safeAccountAuthTimestamp\(session\.user\.created_at\)/);
  assert.match(route,/safeAccountAuthTimestamp\(session\.user\.last_sign_in_at\)/);
  assert.match(route,/\.\.\.\(registeredAt \? \{ registeredAt \} : \{\}\)/);
  assert.match(route,/\.\.\.\(lastSignInAt \? \{ lastSignInAt \} : \{\}\)/);
  assert.doesNotMatch(route,/user_metadata|raw_user_meta_data|localStorage/);
});
