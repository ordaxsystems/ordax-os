import {
  normalizePublicOrigin,
  verifyBrowserOriginContext,
} from "../infra/supabase/functions/ordax-public-account-gateway/public_request_context.mjs";
import { readBoundedBody } from "../infra/supabase/functions/_shared/bounded_body.mjs";

export { normalizePublicOrigin };

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const ALLOWED_METHODS = new Set(["GET", "POST"]);
const ALLOWED_PREFIXES = ["/auth/", "/sync/"];
const PUBLIC_ACCOUNT_ROUTES = new Map([
  ["/account/export", "GET"],
  ["/account/spaces", "GET"],
  ["/account/entitlements/memory-cloud", "GET"],
  ["/account/close", "POST"],
]);
const PUBLIC_GATEWAY_PATH = "/functions/v1/ordax-public-account-gateway";
const VERCEL_OIDC_TOKEN_RE = /^[A-Za-z0-9_-]{16,4096}\.[A-Za-z0-9_-]{2,16384}\.[A-Za-z0-9_-]{16,16384}$/;
const EDGE_ADDRESS_RE = /^[0-9A-Fa-f:.]{3,64}$/;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_FIELD = "cf-turnstile-response";
const TURNSTILE_ACTION = "ordax-account";
const TURNSTILE_PROTECTED_PATHS = new Set(["/auth/login", "/auth/register", "/auth/recover"]);
const MAX_TURNSTILE_TOKEN_BYTES = 2048;
const MAX_TURNSTILE_RESPONSE_BYTES = 64 * 1024;
const MAX_COOKIE_ENVELOPE_BYTES = 32 * 1024;
const MAX_COOKIE_COUNT = 5;
const COOKIE_ENVELOPE_HEADER = "x-ordax-cookie-envelope";
const SAFE_COOKIE_NAMES = new Set([
  "ordax_access",
  "ordax_refresh",
  "ordax_recovery",
  "ordax_recovery_access",
  "ordax_recovery_refresh",
]);
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

export function normalizeProductPath(raw, method) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  if (!ALLOWED_METHODS.has(method)) return null;
  let value;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!value.startsWith("/") || value.includes("\\") || value.includes("\0")) return null;
  const parsed = new URL(value, "https://ordax.invalid");
  if (parsed.pathname.includes("/../") || parsed.pathname.endsWith("/..")) return null;
  const prefixAllowed = ALLOWED_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix));
  const accountMethod = PUBLIC_ACCOUNT_ROUTES.get(parsed.pathname);
  if (!prefixAllowed && accountMethod !== method) return null;
  if (accountMethod && accountMethod !== method) return null;
  return `${parsed.pathname}${parsed.search}`;
}

export function normalizeVercelOidcToken(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return VERCEL_OIDC_TOKEN_RE.test(value) ? value : null;
}

async function getRuntimeVercelOidcToken() {
  try {
    const runtime = await import("@vercel/oidc");
    if (typeof runtime.getVercelOidcToken !== "function") return null;
    return await runtime.getVercelOidcToken();
  } catch {
    return null;
  }
}

export async function resolveVercelOidcToken(
  explicitToken,
  runtimeResolver = getRuntimeVercelOidcToken,
) {
  if (explicitToken !== undefined) return normalizeVercelOidcToken(explicitToken);
  if (typeof runtimeResolver !== "function") return null;
  try {
    return normalizeVercelOidcToken(await runtimeResolver());
  } catch {
    return null;
  }
}

export function normalizeTrustedEdgeAddress(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!EDGE_ADDRESS_RE.test(value) || value.includes(",")) return null;
  return value;
}

export function normalizeUpstreamLocation(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) {
    return null;
  }
  try {
    const parsed = new URL(raw, "https://ordax.invalid");
    if (parsed.origin !== "https://ordax.invalid") return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function trustedSetCookie(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 16_384) return null;
  if (/[\r\n]/.test(raw)) return null;
  const parts = raw.split(";").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 5) return null;
  const first = parts[0];
  const separator = first.indexOf("=");
  if (separator < 1) return null;
  const name = first.slice(0, separator);
  if (!SAFE_COOKIE_NAMES.has(name)) return null;

  const attributes = new Map();
  for (const part of parts.slice(1)) {
    const index = part.indexOf("=");
    const key = (index < 0 ? part : part.slice(0, index)).trim().toLowerCase();
    const value = index < 0 ? "" : part.slice(index + 1).trim();
    if (!key || attributes.has(key)) return null;
    attributes.set(key, value);
  }
  if (attributes.has("domain")) return null;
  if (!attributes.has("secure") || !attributes.has("httponly")) return null;
  const expectedPath = name.startsWith("ordax_recovery") ? "/auth/recover" : "/";
  if (attributes.get("path") !== expectedPath) return null;
  if ((attributes.get("samesite") ?? "").toLowerCase() !== "lax") return null;
  const maxAge = attributes.get("max-age");
  if (maxAge === undefined || !/^-?\d{1,10}$/.test(maxAge)) return null;
  return raw;
}

export function trustedCookieEnvelope(raw) {
  if (raw === null || raw === undefined || raw === "") return [];
  if (typeof raw !== "string") throw new TypeError("invalid-cookie-envelope");
  if (new TextEncoder().encode(raw).byteLength > MAX_COOKIE_ENVELOPE_BYTES) {
    throw new RangeError("cookie-envelope-too-large");
  }
  let values;
  try {
    values = JSON.parse(raw);
  } catch {
    throw new TypeError("invalid-cookie-envelope");
  }
  if (!Array.isArray(values) || values.length > MAX_COOKIE_COUNT) {
    throw new TypeError("invalid-cookie-envelope");
  }
  const names = new Set();
  const cookies = [];
  for (const rawCookie of values) {
    const cookie = trustedSetCookie(rawCookie);
    if (!cookie) throw new TypeError("unsafe-upstream-cookie");
    const name = cookie.slice(0, cookie.indexOf("="));
    if (names.has(name)) throw new TypeError("duplicate-upstream-cookie");
    names.add(name);
    cookies.push(cookie);
  }
  return cookies;
}

function copyResponseHeaders(upstream) {
  const headers = new Headers();
  headers.set("cache-control", "no-store, max-age=0");
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  const location = upstream.headers.get("location");
  if (location) {
    const trustedLocation = normalizeUpstreamLocation(location);
    if (!trustedLocation) throw new TypeError("unsafe-upstream-location");
    headers.set("location", trustedLocation);
  }

  // Infrastructure cookies (for example Cloudflare bot-management cookies on
  // the Supabase transport) never cross the OrdaX same-origin boundary.
  // Product cookies are carried only inside the authenticated gateway envelope.
  const cookies = trustedCookieEnvelope(upstream.headers.get(COOKIE_ENVELOPE_HEADER));
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return headers;
}

async function boundedBody(request) {
  if (request.method === "GET") return undefined;
  return readBoundedBody(request.body, request.headers.get("content-length"), MAX_BODY_BYTES);
}


function protectedTurnstileRoute(method, productPath) {
  if (method !== "POST") return false;
  const parsed = new URL(productPath, "https://ordax.invalid");
  return TURNSTILE_PROTECTED_PATHS.has(parsed.pathname);
}

export function stripTurnstileToken(body, contentType) {
  if (!(body instanceof Uint8Array)) throw new TypeError("turnstile-form-required");
  if (typeof contentType !== "string" || !contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    throw new TypeError("turnstile-form-required");
  }
  const raw = new TextDecoder().decode(body);
  const form = new URLSearchParams(raw);
  const tokens = form.getAll(TURNSTILE_FIELD);
  if (tokens.length !== 1) throw new TypeError("turnstile-token-required");
  const token = tokens[0].trim();
  const bytes = new TextEncoder().encode(token);
  if (
    bytes.byteLength < 1
    || bytes.byteLength > MAX_TURNSTILE_TOKEN_BYTES
    || /[\u0000-\u0020\u007f]/.test(token)
  ) {
    throw new TypeError("turnstile-token-invalid");
  }
  form.delete(TURNSTILE_FIELD);
  return {
    token,
    body: new TextEncoder().encode(form.toString()),
  };
}

export async function verifyTurnstileToken(
  token,
  {
    secret,
    remoteIp,
    expectedHostname,
    timeoutMs = 5000,
    fetchImpl = fetch,
  } = {},
) {
  if (typeof secret !== "string" || !secret.trim()) throw new TypeError("turnstile-secret-unconfigured");
  if (typeof remoteIp !== "string" || !normalizeTrustedEdgeAddress(remoteIp)) {
    throw new TypeError("turnstile-remote-ip-invalid");
  }
  if (typeof expectedHostname !== "string" || !expectedHostname.trim() || expectedHostname.includes("/")) {
    throw new TypeError("turnstile-hostname-invalid");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("turnstile-fetch-invalid");

  const payload = new URLSearchParams({
    secret: secret.trim(),
    response: token,
    remoteip: remoteIp,
    idempotency_key: crypto.randomUUID(),
  });

  const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: payload.toString(),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error("turnstile-siteverify-unavailable");
  // Enforce the limit while reading, not after response.text() buffers
  // an arbitrarily large untrusted Cloudflare response into memory.
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(
    await readBoundedBody(
      response.body,
      response.headers.get("content-length"),
      MAX_TURNSTILE_RESPONSE_BYTES,
    ),
  );
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error("turnstile-siteverify-invalid-json");
  }
  return Boolean(
    result
    && result.success === true
    && result.hostname === expectedHostname
    && result.action === TURNSTILE_ACTION
  );
}

export async function proxyPublicAccountRequest(
  request,
  {
    gatewayUrl = process.env.ORDAX_ACCOUNT_GATEWAY_URL,
    oidcToken,
    oidcTokenResolver,
    publicOrigin = process.env.ORDAX_PUBLIC_ORIGIN,
    turnstileSecret = process.env.ORDAX_TURNSTILE_SECRET_KEY,
    turnstileVerifier = verifyTurnstileToken,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {},
) {
  if (!request || typeof request.url !== "string") return error(400, "invalid-request");
  if (!ALLOWED_METHODS.has(request.method)) {
    const response = error(405, "method-not-allowed");
    response.headers.set("allow", "GET, POST");
    return response;
  }

  const trustedPublicOrigin = normalizePublicOrigin(publicOrigin);
  if (!trustedPublicOrigin) return error(503, "public-origin-unconfigured");

  const incoming = new URL(request.url);
  if (incoming.origin !== trustedPublicOrigin) return error(421, "public-origin-mismatch");

  const browserContext = verifyBrowserOriginContext(request, trustedPublicOrigin);
  if (!browserContext.ok) return error(403, browserContext.code);

  const productPath = normalizeProductPath(incoming.searchParams.get("ordax_path"), request.method);
  if (!productPath) return error(404, "unsupported-account-route");

  const gateway = normalizeGatewayUrl(gatewayUrl);
  if (!gateway) return error(503, "account-gateway-unconfigured");

  const trustedOidcToken = await resolveVercelOidcToken(oidcToken, oidcTokenResolver);
  if (!trustedOidcToken) return error(503, "public-proxy-identity-unavailable");

  let body;
  try {
    body = await boundedBody(request);
  } catch (cause) {
    if (cause instanceof RangeError) return error(413, "request-too-large");
    return error(400, "invalid-request-body");
  }

  const realIp = normalizeTrustedEdgeAddress(request.headers.get("x-forwarded-for"));
  if (!realIp) return error(400, "trusted-edge-context-required");

  if (protectedTurnstileRoute(request.method, productPath)) {
    if (typeof turnstileSecret !== "string" || !turnstileSecret.trim()) {
      return error(503, "bot-protection-unconfigured");
    }
    let challenge;
    try {
      challenge = stripTurnstileToken(body, request.headers.get("content-type") ?? "");
    } catch {
      return error(403, "bot-verification-required");
    }
    let verified = false;
    try {
      verified = await turnstileVerifier(challenge.token, {
        secret: turnstileSecret,
        remoteIp: realIp,
        expectedHostname: new URL(trustedPublicOrigin).hostname,
        timeoutMs: Math.min(timeoutMs, 5000),
      });
    } catch {
      return error(503, "bot-verification-unavailable");
    }
    if (!verified) return error(403, "bot-verification-failed");
    body = challenge.body;
  }

  const headers = new Headers();
  for (const name of PASSTHROUGH_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const canonical = new URL(trustedPublicOrigin);
  // Vercel overwrites x-forwarded-for at its edge. The short-lived OIDC token
  // authenticates this deployment downstream. Host/proto/origin are derived
  // from deployment configuration, never from browser-controlled headers.
  headers.set("authorization", `Bearer ${trustedOidcToken}`);
  headers.set("x-forwarded-for", realIp);
  headers.set("x-real-ip", realIp);
  headers.set("x-forwarded-host", canonical.host);
  headers.set("x-forwarded-proto", "https");
  headers.set("x-ordax-public-origin", trustedPublicOrigin);
  headers.set("x-ordax-public-site", "1");
  headers.set("x-ordax-client-address", realIp);

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

  let responseHeaders;
  try {
    responseHeaders = copyResponseHeaders(upstream);
  } catch {
    return error(502, "unsafe-account-gateway-response");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export default {
  fetch(request) {
    return proxyPublicAccountRequest(request);
  },
};
