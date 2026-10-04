const PUBLIC_SITE_HEADER = "x-ordax-public-site";
const PUBLIC_PROXY_SECRET_HEADER = "x-ordax-public-proxy-secret";
const PUBLIC_CLIENT_ADDRESS_HEADER = "x-ordax-client-address";
const EDGE_CLIENT_ADDRESS_HEADER = "cf-connecting-ip";
const PUBLIC_PROXY_SECRET_SHA256 = "7417269164ec41346a74864a6d9f91dbc9f19960cea9815a9cdbeabf103e51d7";
const PROXY_SECRET_RE = /^[A-Za-z0-9_-]{32,128}$/;
const ADDRESS_RE = /^[0-9A-Fa-f:.]{3,64}$/;
const RATE_LIMIT_SCHEMA = "prototype-ordax.public-auth-rate-limit/1";
const RATE_LIMIT_BUCKETS = new Set([
  "credentials",
  "recovery-request",
  "recovery-completion",
]);

function boundedAddress(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!ADDRESS_RE.test(value) || value.includes(",")) return null;
  return value;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeHexEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function trustedRateLimitAddress(request) {
  const publicSite = (request.headers.get(PUBLIC_SITE_HEADER) ?? "") === "1";
  if (publicSite) {
    const secret = (request.headers.get(PUBLIC_PROXY_SECRET_HEADER) ?? "").trim();
    if (!PROXY_SECRET_RE.test(secret)) {
      return { ok: false, code: "public-proxy-authentication-required" };
    }
    const digest = await sha256Hex(secret);
    if (!constantTimeHexEqual(digest, PUBLIC_PROXY_SECRET_SHA256)) {
      return { ok: false, code: "public-proxy-authentication-required" };
    }
    const address = boundedAddress(request.headers.get(PUBLIC_CLIENT_ADDRESS_HEADER));
    return address
      ? { ok: true, address, source: "authenticated-public-proxy" }
      : { ok: false, code: "trusted-client-address-required" };
  }

  const address = boundedAddress(request.headers.get(EDGE_CLIENT_ADDRESS_HEADER));
  return address
    ? { ok: true, address, source: "supabase-edge" }
    : { ok: false, code: "trusted-client-address-required" };
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
