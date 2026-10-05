const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const ALLOWED_METHODS = new Set(["GET", "POST"]);
const ALLOWED_PREFIXES = ["/auth/", "/sync/"];
const PUBLIC_GATEWAY_PATH = "/functions/v1/ordax-public-account-gateway";
const PROXY_SECRET_RE = /^[A-Za-z0-9_-]{32,128}$/;
const EDGE_ADDRESS_RE = /^[0-9A-Fa-f:.]{3,64}$/;
const PASSTHROUGH_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "cookie",
  "origin",
  "sec-fetch-site",
  "user-agent",
];
const PASSTHROUGH_RESPONSE_HEADERS = [
  "content-type",
  "location",
  "pragma",
  "x-content-type-options",
];

function error(status, code) {
  return new Response(
    JSON.stringify({
      $schema: "prototype-ordax.public-site-proxy-error/1",
      error: code,
    }) + "\n",
    {
      status,
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "application/json; charset=utf-8",
        pragma: "no-cache",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export function normalizeGatewayUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== PUBLIC_GATEWAY_PATH
  ) {
    return null;
  }
  return url;
}

export function normalizeProductPath(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  let value;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!value.startsWith("/") || value.includes("\\") || value.includes("\0")) return null;
  const parsed = new URL(value, "https://ordax.invalid");
  if (!ALLOWED_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) return null;
  if (parsed.pathname.includes("/../") || parsed.pathname.endsWith("/..")) return null;
  return `${parsed.pathname}${parsed.search}`;
}

export function normalizeProxySecret(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return PROXY_SECRET_RE.test(value) ? value : null;
}

export function normalizeTrustedEdgeAddress(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!EDGE_ADDRESS_RE.test(value) || value.includes(",")) return null;
  return value;
}

function copyResponseHeaders(upstream) {
  const headers = new Headers();
  headers.set("cache-control", "no-store, max-age=0");
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  const getSetCookie = upstream.headers.getSetCookie;
  if (typeof getSetCookie === "function") {
    for (const value of getSetCookie.call(upstream.headers)) headers.append("set-cookie", value);
  } else {
    const value = upstream.headers.get("set-cookie");
    if (value) headers.append("set-cookie", value);
  }
  return headers;
}

async function boundedBody(request) {
  if (request.method === "GET") return undefined;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new RangeError("request-too-large");
  const value = new Uint8Array(await request.arrayBuffer());
  if (value.byteLength > MAX_BODY_BYTES) throw new RangeError("request-too-large");
  return value;
}

export async function proxyPublicAccountRequest(
  request,
  {
    gatewayUrl = process.env.ORDAX_ACCOUNT_GATEWAY_URL,
    proxySecret = process.env.ORDAX_PUBLIC_PROXY_SECRET,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {},
) {
  if (!request || typeof request.url !== "string") return error(400, "invalid-request");
  if (!ALLOWED_METHODS.has(request.method)) {
    const response = error(405, "method-not-allowed");
    response.headers.set("allow", "GET, POST");
    return response;
  }

  const incoming = new URL(request.url);
  const productPath = normalizeProductPath(incoming.searchParams.get("ordax_path"));
  if (!productPath) return error(404, "unsupported-account-route");

  const gateway = normalizeGatewayUrl(gatewayUrl);
  if (!gateway) return error(503, "account-gateway-unconfigured");

  const trustedProxySecret = normalizeProxySecret(proxySecret);
  if (!trustedProxySecret) return error(503, "public-proxy-auth-unconfigured");

  let body;
  try {
    body = await boundedBody(request);
  } catch (cause) {
    if (cause instanceof RangeError) return error(413, "request-too-large");
    return error(400, "invalid-request-body");
  }

  const headers = new Headers();
  for (const name of PASSTHROUGH_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const realIp = normalizeTrustedEdgeAddress(request.headers.get("x-forwarded-for"));
  const host = (request.headers.get("host") ?? incoming.host).trim();
  if (!realIp || !host) return error(400, "trusted-edge-context-required");

  // Vercel overwrites x-forwarded-for at its edge, so this value cannot be
  // selected by an arbitrary Internet client. The dedicated OrdaX header is
  // authenticated separately by the public Edge boundary before quotas run.
  // Never forward browser-supplied authorization, proxy credentials or client
  // address assertions through this boundary.
  headers.set("x-forwarded-for", realIp);
  headers.set("x-real-ip", realIp);
  headers.set("x-forwarded-host", host);
  headers.set("x-forwarded-proto", "https");
  headers.set("x-ordax-public-site", "1");
  headers.set("x-ordax-client-address", realIp);
  headers.set("x-ordax-public-proxy-secret", trustedProxySecret);

  const target = new URL(`${gateway.pathname}${productPath}`, gateway.origin);
  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return error(503, "account-gateway-unavailable");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: copyResponseHeaders(upstream),
  });
}

export default {
  fetch(request) {
    return proxyPublicAccountRequest(request);
  },
};
