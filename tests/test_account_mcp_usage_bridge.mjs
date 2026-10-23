import assert from "node:assert/strict";
import test from "node:test";
import { isPublicBridgeRoute, isPublicAccountPreActivationRoute } from "../infra/supabase/functions/_shared/account_transport_admission.mjs";
import { ACCOUNT_MCP_USAGE_PATH, PRODUCT_MCP_USAGE_READ_URL, validateAccountMcpUsage, readAccountMcpUsage } from "../infra/supabase/functions/_shared/account_mcp_usage.mjs";

const original = {
  ok: true, schema: "ordax.product-mcp-usage/1", observed_only: true,
  billable: false, coverage: "partial_observational", quota: null, charge: null,
  collection_active_now: true,
  current_month: "2026-10-01", previous_month: "2026-09-01",
  entries: [{ month: "2026-10-01", tool_name: "ordax_targets", tool_calls: 3 }],
};
const response = (payload, opts = {}) => {
  const inner = Response.json(payload, opts);
  return { ok: inner.ok, status: inner.status, headers: inner.headers, body: inner.body,
    url: PRODUCT_MCP_USAGE_READ_URL };
};
const token = "fixture.valid.signed.jwt.token";

test("only the exact GET consumption path is allowed after Account activation", () => {
  assert.equal(isPublicBridgeRoute("GET", ACCOUNT_MCP_USAGE_PATH), true);
  assert.equal(isPublicBridgeRoute("POST", ACCOUNT_MCP_USAGE_PATH), false);
  assert.equal(isPublicAccountPreActivationRoute("GET", ACCOUNT_MCP_USAGE_PATH), false);
  assert.equal(isPublicBridgeRoute("GET", ACCOUNT_MCP_USAGE_PATH + "/other"), false);
  assert.equal(isPublicBridgeRoute("GET", ACCOUNT_MCP_USAGE_PATH + "?owner_id=1"), false);
});

test("signed bearer is forwarded server-side only to the fixed branded MCP owner path", async () => {
  const requests = [];
  const fetcher = async (url, config) => {
    requests.push({ url, config });
    return response(original);
  };
  const result = await readAccountMcpUsage(token, fetcher);
  assert.deepEqual(result.entries, original.entries);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, PRODUCT_MCP_USAGE_READ_URL);
  assert.equal(requests[0].config.redirect, "error");
  assert.equal(requests[0].config.cache, "no-store");
  assert.equal(requests[0].config.headers.Authorization, "Bearer " + token);
  assert.equal(result.billable, false);
  assert.equal(result.quota, null);
});

test("observational schema rejects billing, data leakage, duplicates and invalid counts", () => {
  assert.deepEqual(validateAccountMcpUsage(original).entries, original.entries);
  for (const patch of [
    { billable: true }, { quota: 1000 }, { charge: 9 }, { observed_only: false },
    { collection_active_now: "true" },
    { coverage: "complete" }, { entries: [...original.entries, ...original.entries] },
    { entries: [{ ...original.entries[0], month: "2023-01-01" }] },
    { entries: [{ ...original.entries[0], tool_calls: Number.MAX_SAFE_INTEGER + 1 }] },
    { entries: [{ ...original.entries[0], tool_name: "../secret" }] },
  ]) assert.equal(validateAccountMcpUsage({ ...original, ...patch }), null, JSON.stringify(patch));
});

test("redirects, malformed upstream data and oversized bodies fail closed", async () => {
  await assert.rejects(() => readAccountMcpUsage("bad token", async () => response(original)));
  await assert.rejects(() => readAccountMcpUsage(token, async () => ({
    ...response(original), url: "https://untrusted.example/data",
  })));
  await assert.rejects(() => readAccountMcpUsage(token, async () => response({ ...original, billable: true })));
  await assert.rejects(() => readAccountMcpUsage(token, async () => {
    const inner = new Response("x".repeat(65537));
    return { ok: true, status: 200, headers: inner.headers, body: inner.body,
      url: PRODUCT_MCP_USAGE_READ_URL };
  }));
});
