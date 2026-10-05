const PUBLIC_CLIENT_ADDRESS_HEADER = "x-ordax-client-address";
const ADDRESS_RE = /^[0-9A-Fa-f:.]{3,64}$/;
const RATE_LIMIT_SCHEMA = "prototype-ordax.public-auth-rate-limit/1";
const RATE_LIMIT_BUCKETS = new Set([
  "credentials",
  "recovery-request",
  "recovery-completion",
]);

export function trustedPublicClientAddress(request) {
  const raw = request.headers.get(PUBLIC_CLIENT_ADDRESS_HEADER);
  if (typeof raw !== "string") {
    return { ok: false, code: "trusted-client-address-required" };
  }
  const address = raw.trim();
  if (!ADDRESS_RE.test(address) || address.includes(",")) {
    return { ok: false, code: "trusted-client-address-required" };
  }
  return { ok: true, address };
}

export function validateRateLimitRpcResult(value, expectedBucket) {
  if (!RATE_LIMIT_BUCKETS.has(expectedBucket)) return null;
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row = value[0];
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  if (row.schema !== RATE_LIMIT_SCHEMA || row.bucket !== expectedBucket) return null;
  if (!["allowed", "rate_limited"].includes(row.decision)) return null;
  if (!Number.isInteger(row.limit_count) || row.limit_count < 1 || row.limit_count > 1000) return null;
  if (!Number.isInteger(row.remaining) || row.remaining < 0 || row.remaining > row.limit_count) return null;
  if (typeof row.reset_at !== "string" || !Number.isFinite(Date.parse(row.reset_at))) return null;

  if (row.decision === "rate_limited") {
    if (
      !Number.isInteger(row.retry_after_seconds)
      || row.retry_after_seconds < 1
      || row.retry_after_seconds > 60
      || row.remaining !== 0
    ) return null;
  } else if (row.retry_after_seconds !== null) {
    return null;
  }
  return row;
}
