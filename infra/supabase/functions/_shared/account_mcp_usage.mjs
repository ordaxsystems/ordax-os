// OrdaX Account Edge -> canonical Product MCP owner usage read.
// Transport-only: no second meter, entitlement, storage or billing ledger.
import { readBoundedBody } from "./bounded_body.mjs";

export const PRODUCT_MCP_USAGE_READ_URL = "https://mcp.ordax.com.br/v3/product/usage";
export const ACCOUNT_MCP_USAGE_PATH = "/account/usage/mcp";
const MAX_BYTES = 65536;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])-01$/;
const TOOL = /^[a-z][a-z0-9._-]{1,95}$/;

export function validateAccountMcpUsage(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)
      || data.ok !== true || data.schema !== "ordax.product-mcp-usage/1"
      || data.observed_only !== true || data.billable !== false
      || data.coverage !== "partial_observational"
      || data.quota !== null || data.charge !== null
      || typeof data.collection_active_now !== "boolean"
      || typeof data.current_month !== "string" || !MONTH.test(data.current_month)
      || typeof data.previous_month !== "string" || !MONTH.test(data.previous_month)
      || !Array.isArray(data.entries) || data.entries.length > 256) return null;
  const seen = new Set();
  const entries = [];
  for (const row of data.entries) {
    if (!row || typeof row !== "object" || Array.isArray(row)
        || (row.month !== data.current_month && row.month !== data.previous_month)
        || typeof row.tool_name !== "string" || !TOOL.test(row.tool_name)
        || !Number.isSafeInteger(row.tool_calls) || row.tool_calls < 0
        || seen.has(row.month + ":" + row.tool_name)) return null;
    seen.add(row.month + ":" + row.tool_name);
    entries.push({ month: row.month, tool_name: row.tool_name, tool_calls: row.tool_calls });
  }
  return {
    ok: true, schema: "ordax.product-mcp-usage/1", observed_only: true,
    billable: false, coverage: "partial_observational", quota: null, charge: null,
    collection_active_now: data.collection_active_now, current_month: data.current_month,
    previous_month: data.previous_month, entries,
  };
}

export async function readAccountMcpUsage(access, fetcher = fetch) {
  if (typeof access !== "string" || access.length < 16 || access.length > 16384
      || !/^[A-Za-z0-9_.-]+$/.test(access)) throw new Error("mcp-usage-access-invalid");
  // Fixed HTTPS origin. Never forward tokens to a URL from the request or env.
  const response = await fetcher(PRODUCT_MCP_USAGE_READ_URL, {
    method: "GET", redirect: "error", cache: "no-store",
    headers: { Authorization: "Bearer " + access, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || response.status !== 200 || response.url !== PRODUCT_MCP_USAGE_READ_URL) {
    throw new Error("mcp-usage-upstream-unavailable");
  }
  const bytes = await readBoundedBody(response.body, response.headers.get("content-length"), MAX_BYTES);
  const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const usage = validateAccountMcpUsage(raw);
  if (!usage) throw new Error("mcp-usage-response-invalid");
  return usage;
}
