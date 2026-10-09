import test from "node:test";
import assert from "node:assert/strict";
import { accountPrivilegedRpc, ACCOUNT_RPC_NAMES } from "../infra/supabase/functions/_shared/account_privileged_rpc.mjs";

const origin = "https://jhfphsjptrpmtnzkpwud.supabase.co";
const key = "sb_secret_" + "x".repeat(32);
const method = ACCOUNT_RPC_NAMES[0];

test("privileged RPC sends modern opaque key only as apikey", async () => {
  let seen;
  const reply = await accountPrivilegedRpc({
    url: origin, key, name: method,
    fetcher: async (url, options) => {
      seen = { url, options };
      return new Response(JSON.stringify([{ policy_id: "example" }]), { status: 200 });
    },
  });
  assert.deepEqual(reply.data, [{ policy_id: "example" }]);
  assert.equal(reply.error, null);
  assert.equal(seen.url, origin + "/rest/v1/rpc/" + method);
  assert.equal(seen.options.headers.apikey, key);
  assert.ok(!Object.hasOwn(seen.options.headers, "authorization"));
  assert.equal(seen.options.method, "POST");
  assert.equal(seen.options.redirect, "error");
});

test("denies unknown methods and non-canonical origins before using keys", async () => {
  let sent = 0;
  const fetcher = async () => { sent++; throw Error("unexpected fetch"); };
  for (const name of ["../../auth/v1/admin/users", "ordax_custom_data_export", ""]) {
    const out = await accountPrivilegedRpc({ url: origin, key, name, fetcher });
    assert.equal(out.error.code, "account-rpc-method-forbidden");
  }
  for (const url of [
    "http://jhfphsjptrpmtnzkpwud.supabase.co",
    "https://evil.example",
    "https://jhfphsjptrpmtnzkpwud.supabase.co.evil.example",
    "https://jhfphsjptrpmtnzkpwud.supabase.co/anything",
    "https://user@jhfphsjptrpmtnzkpwud.supabase.co",
  ]) {
    const out = await accountPrivilegedRpc({ url, key, name: method, fetcher });
    assert.equal(out.error.code, "account-rpc-origin-invalid");
  }
  assert.equal(sent, 0);
});

test("sanitizes provider errors and bounds response allocations", async () => {
  for (const reply of [
    new Response("private-provider-detail", { status: 401 }),
    new Response("{not-json", { status: 200 }),
    new Response("Z".repeat(17500), { status: 200 }),
  ]) {
    const out = await accountPrivilegedRpc({
      url: origin, key, name: method, fetcher: async () => reply,
    });
    assert.equal(out.data, null);
    assert.equal(out.error.code, "account-rpc-upstream-unavailable");
    assert.ok(!JSON.stringify(out).includes("private-provider-detail"));
    assert.ok(!JSON.stringify(out).includes(key));
  }
});
