import {
  normalizePublicOrigin,
  verifyBrowserOriginContext,
} from "../infra/supabase/functions/ordax-public-account-gateway/public_request_context.mjs";
import { readBoundedBody } from "../infra/supabase/functions/_shared/bounded_body.mjs";
import { isPublicBridgeRoute } from "../infra/supabase/functions/_shared/account_transport_admission.mjs";
import { PUBLIC_ACCOUNT_ORIGIN, PUBLIC_CONFIRMATION_PATH, parseSignupConfirmation } from "../infra/supabase/functions/_shared/account_email_confirmation.mjs";
import { trustedCookieEnvelope } from "../infra/supabase/functions/_shared/account_cookie_policy.mjs";
export { trustedCookieEnvelope, trustedSetCookie } from "../infra/supabase/functions/_shared/account_cookie_policy.mjs";

export { normalizePublicOrigin };

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const ALLOWED_METHODS = new Set(["GET", "POST"]);
const PUBLIC_GATEWAY_PATH = "/functions/v1/ordax-public-account-gateway";
const VERCEL_OIDC_TOKEN_RE = /^[A-Za-z0-9_-]{16,4096}\.[A-Za-z0-9_-]{2,16384}\.[A-Za-z0-9_-]{16,16384}$/;
const EDGE_ADDRESS_RE = /^[0-9A-Fa-f:.]{3,64}$/;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_FIELD = "cf-turnstile-response";
const TURNSTILE_ACTION = "ordax-account";
const TURNSTILE_PROTECTED_PATHS = new Set(["/auth/login", "/auth/register", "/auth/recover"]);
const MAX_TURNSTILE_TOKEN_BYTES = 2048;
const MAX_TURNSTILE_RESPONSE_BYTES = 64 * 1024;
const COOKIE_ENVELOPE_HEADER = "x-ordax-cookie-envelope";
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
  if (!isPublicBridgeRoute(method, parsed.pathname)) return null;
  return `${parsed.pathname}${parsed.search}`;
}

// Vercel may attach original URL parameters to the rewritten API route
// separately from ordax_path. Preserve only the fixed public OTP callback
// parameters. No arbitrary query forwarding is introduced for other endpoints.
// Only the two approved OTP values are reconstructed from request routing.
// Deployment rewrite parameters are never interpreted as verification data,
// and unrelated URL parameters are never sent to the identity provider.
// This avoids Vercel's internal query-shape differences without weakening
// the one-time token validation or allowing arbitrary redirect targets.
export function forwardPublicConfirmationQuery(normalizedPath, params) {
  if (typeof normalizedPath !== "string"
    || !params
    || typeof params.getAll !== "function") return null;
  const route = new URL(normalizedPath, PUBLIC_ACCOUNT_ORIGIN);
  if (route.pathname !== PUBLIC_CONFIRMATION_PATH) return null;

  const query = new URLSearchParams(route.search);
  const hashes = [...query.getAll("token_hash"), ...params.getAll("token_hash")];
  const types = [...query.getAll("type"), ...params.getAll("type")];
  if (hashes.length === 0 && types.length === 0) return PUBLIC_CONFIRMATION_PATH;
  if (hashes.length === 0 || types.length === 0) return null;
  // A rewrite can duplicate the same value in both path and query metadata.
  // Contradictory values are untrusted and never forwarded.
  if (!hashes.every(hash => hash === hashes[0])
    || !types.every(type => type === types[0])) return null;
  const canonical = new URL(PUBLIC_CONFIRMATION_PATH, PUBLIC_ACCOUNT_ORIGIN);
  canonical.searchParams.set("token_hash", hashes[0]);
  canonical.searchParams.set("type", types[0]);
  return parseSignupConfirmation(canonical) ? canonical.pathname + canonical.search : null;
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


// Browser form posts always return to a safe public page on challenge failure.
 // API clients retain machine-readable HTTP errors; no credential, token or query
 // values from the request are copied into the redirect.
function botError(request, productPath, status, code) {
  if (request.method === "POST" && request.headers.get("accept")?.includes("text/html")) {
    const path = new URL(productPath, "https://ordax.invalid").pathname;
    const destination = {
      "/auth/login": "/login/",
      "/auth/register": "/cadastro/",
      "/auth/recover": "/recuperar/",
    }[path];
    if (destination) {
      const reason = status === 503 ? "seguranca-indisponivel" : "verificacao-falhou";
      return new Response(null, {
        status: 303,
        headers: {
          location: `${destination}?erro=${reason}`,
          "cache-control": "no-store, max-age=0",
          pragma: "no-cache",
          "x-content-type-options": "nosniff",
        },
      });
    }
  }
  return error(status, code);
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
  const verified = Boolean(
    result
    && result.success === true
    && result.hostname === expectedHostname
    && result.action === TURNSTILE_ACTION
  );
  if (!verified) {
    // Fixed category only. Never log the challenge token, IP, secret, email
    // or untrusted Cloudflare payload.
    const known = new Set([
      "invalid-input-secret", "missing-input-secret", "invalid-input-response",
      "missing-input-response", "timeout-or-duplicate", "bad-request", "internal-error",
    ]);
    const errors = Array.isArray(result?.["error-codes"]) ? result["error-codes"] : [];
    const cloudflareCode = errors.find((value) => typeof value === "string" && known.has(value));
    const reason = cloudflareCode ?? (
      result?.success === true && result?.hostname !== expectedHostname
        ? "hostname-mismatch"
        : result?.success === true && result?.action !== TURNSTILE_ACTION
          ? "action-mismatch"
          : "verification-rejected"
    );
    console.warn("ordax.turnstile.verification_rejected", reason);
  }
  return verified;
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

  const route = normalizeProductPath(incoming.searchParams.get("ordax_path"), request.method);
  // Production Vercel rewrites may contribute extra query parameters. Only
  // the email-confirmation callback needs their strict OTP validation. Every
  // other already-allowlisted route must retain its normalized path unchanged.
  // Passing ordinary /auth/session or /auth/registration-policy through the
  // OTP parser caused a production 404 and incorrectly gated both forms.
  const isConfirmation = route && new URL(route, PUBLIC_ACCOUNT_ORIGIN).pathname === PUBLIC_CONFIRMATION_PATH;
  const productPath = isConfirmation
    ? forwardPublicConfirmationQuery(route, incoming.searchParams)
    : route;
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
      return botError(request, productPath, 503, "bot-protection-unconfigured");
    }
    let challenge;
    try {
      challenge = stripTurnstileToken(body, request.headers.get("content-type") ?? "");
    } catch {
      return botError(request, productPath, 403, "bot-verification-required");
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
      return botError(request, productPath, 503, "bot-verification-unavailable");
    }
    if (!verified) return botError(request, productPath, 403, "bot-verification-failed");
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
  // Upstream CDNs may replace RFC forwarding headers with their own
  // authority. Use private, Vercel-derived values across the signed OIDC
  // boundary rather than trusting mutable proxy hop metadata.
  headers.set("x-forwarded-host", canonical.host);
  headers.set("x-forwarded-proto", "https");
  headers.set("x-ordax-public-origin", trustedPublicOrigin);
  headers.set("x-ordax-public-host", canonical.host);
  headers.set("x-ordax-public-proto", "https");
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

  if (request.method === "GET" && new URL(productPath, PUBLIC_ACCOUNT_ORIGIN).pathname === PUBLIC_CONFIRMATION_PATH) {
    responseHeaders.set("referrer-policy", "no-referrer");
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
