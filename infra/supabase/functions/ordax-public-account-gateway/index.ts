import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  trustedPublicClientAddress,
  validateRateLimitRpcResult,
} from "./public_auth_rate_limit.mjs";
import { authRateLimitBucket } from "../_shared/auth_rate_limit.mjs";
import { verifyTrustedPublicRequestContext } from "./public_request_context.mjs";
import { verifyPublicProxyIdentity } from "./vercel_oidc.mjs";
import { readBoundedBody } from "../_shared/bounded_body.mjs";
import { accountBridgeSecret } from "../_shared/account_service_bridge.mjs";
import { stripEdgeFunctionPrefix } from "../_shared/account_transport_admission.mjs";

const ERROR_SCHEMA = "prototype-ordax.public-identity-error/1";
const MAX_BODY = 64 * 1024;
const MAX_UPSTREAM_RESPONSE = 2 * 1024 * 1024;
const MAX_COOKIE_ENVELOPE_BYTES = 32 * 1024;
const MAX_COOKIE_COUNT = 5;
const COOKIE_ENVELOPE_HEADER = "x-ordax-cookie-envelope";
const ALLOWED_METHODS = new Set(["GET", "POST"]);
const ALLOWED_PREFIXES = ["/auth/", "/sync/"];
const PUBLIC_ACCOUNT_ROUTES = new Map([
  ["/account/export", "GET"],
  ["/account/spaces", "GET"],
  ["/account/entitlements/memory-cloud", "GET"],
  ["/account/close", "POST"],
]);
const REQUEST_HEADERS = [
  "accept",
  "content-type",
  "cookie",
  "origin",
  "sec-fetch-site",
  "user-agent",
  "x-forwarded-host",
  "x-forwarded-proto",
];
const RESPONSE_HEADERS = [
  "content-type",
  "location",
  "pragma",
  "x-content-type-options",
];

function json(status: number, value: unknown, extraHeaders: HeadersInit = {}) {
  const headers = new Headers({
    "cache-control": "no-store, max-age=0",
    "content-type": "application/json; charset=utf-8",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  return new Response(JSON.stringify(value) + "\n", { status, headers });
}

function error(status: number, code: string, message: string, extraHeaders: HeadersInit = {}) {
  return json(status, { $schema: ERROR_SCHEMA, error: code, message }, extraHeaders);
}

function firstNamedKey(raw: string, name: string) {
  if (!raw.trim()) return null;
  try {
    const value = JSON.parse(raw);
    const key = value && typeof value === "object" ? value[name] : null;
    return typeof key === "string" && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

function providerConfig() {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/$/, "");
  const publishableKey = firstNamedKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "", "default")
    ?? (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  if (!url || !publishableKey) throw new Error("provider-unconfigured");
  return { url, publishableKey };
}

function serverSecretKey() {
  const secretKey = firstNamedKey(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "", "default")
    ?? (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!secretKey) throw new Error("provider-admin-unconfigured");
  return secretKey;
}

function publicBridgeKey() {
  const key = accountBridgeSecret(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "");
  if (!key) throw new Error("account-public-bridge-unconfigured");
  return key;
}

function adminClient() {
  const { url } = providerConfig();
  const secretKey = serverSecretKey();
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function routePath(url: URL, method: string) {
  const pathname = stripEdgeFunctionPrefix(url.pathname, "ordax-public-account-gateway");
  if (pathname === null) return null;
  if (
    pathname.length > 2048
    || !pathname.startsWith("/")
    || pathname.includes("\\")
    || pathname.includes("\0")
  ) return null;
  const prefixAllowed = ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const accountMethod = PUBLIC_ACCOUNT_ROUTES.get(pathname);
  if (!prefixAllowed && accountMethod !== method) return null;
  if (accountMethod && accountMethod !== method) return null;
  return `${pathname}${url.search}`;
}

async function boundedRequestBody(req: Request) {
  if (req.method === "GET") return undefined;
  return readBoundedBody(req.body, req.headers.get("content-length"), MAX_BODY);
}

function upstreamHeaders(req: Request, serverSecret: string) {
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  // The public marker is privileged provenance. The inner gateway accepts it
  // only after matching the dedicated, named backend bridge secret.
  headers.set("apikey", serverSecret);
  headers.set("x-ordax-public-site", "1");
  return headers;
}

function upstreamCookies(upstream: Response) {
  const getSetCookie = upstream.headers.getSetCookie;
  const values = typeof getSetCookie === "function"
    ? getSetCookie.call(upstream.headers)
    : upstream.headers.get("set-cookie")
      ? [upstream.headers.get("set-cookie") as string]
      : [];
  if (values.length > MAX_COOKIE_COUNT) throw new RangeError("too-many-account-cookies");
  let totalBytes = 0;
  for (const value of values) {
    if (typeof value !== "string" || !value || /[\r\n]/.test(value)) {
      throw new TypeError("invalid-account-cookie");
    }
    totalBytes += new TextEncoder().encode(value).byteLength;
  }
  if (totalBytes > MAX_COOKIE_ENVELOPE_BYTES) {
    throw new RangeError("account-cookie-envelope-too-large");
  }
  return values;
}

function responseHeaders(upstream: Response) {
  const headers = new Headers({
    "cache-control": "no-store, max-age=0",
  });
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  const cookies = upstreamCookies(upstream);
  if (cookies.length) {
    headers.set(COOKIE_ENVELOPE_HEADER, JSON.stringify(cookies));
  }
  return headers;
}

async function boundedUpstreamResponse(upstream: Response) {
  let body;
  try {
    body = await readBoundedBody(
      upstream.body,
      upstream.headers.get("content-length"),
      MAX_UPSTREAM_RESPONSE,
    );
    return new Response(body, {
      status: upstream.status,
      headers: responseHeaders(upstream),
    });
  } catch (cause) {
    return cause instanceof RangeError
      ? error(502, "account-gateway-response-too-large", "Resposta de Conta inválida.")
      : error(502, "account-gateway-response-invalid", "Resposta de Conta inválida.");
  }
}

Deno.serve(async (req: Request) => {
  if (!ALLOWED_METHODS.has(req.method)) {
    return error(405, "method-not-allowed", "Método não permitido.", { allow: "GET, POST" });
  }

  const url = new URL(req.url);
  const productPath = routePath(url, req.method);
  if (!productPath) {
    return error(404, "gateway-route-not-found", "Rota inexistente.");
  }
  const productUrl = new URL(productPath, "https://ordax.invalid");

  const identity = await verifyPublicProxyIdentity(req);
  if (!identity.ok || identity.source !== "vercel-production-oidc") {
    return error(403, "public-proxy-authentication-required", "Boundary público não autenticado.");
  }

  const requestContext = verifyTrustedPublicRequestContext(req);
  if (!requestContext.ok) {
    return error(403, "public-request-context-rejected", "Contexto público inválido.");
  }

  const trustedAddress = trustedPublicClientAddress(req);
  if (!trustedAddress.ok) {
    return error(400, "trusted-client-address-required", "Endereço de origem confiável ausente.");
  }

  let body;
  try {
    body = await boundedRequestBody(req);
  } catch (cause) {
    if (cause instanceof RangeError) {
      return error(413, "request-too-large", "A solicitação excede o limite permitido.");
    }
    return error(400, "invalid-request-body", "Solicitação inválida.");
  }

  const bucket = authRateLimitBucket(req.method, productUrl.pathname);
  if (bucket) {
    let data: unknown;
    let rpcError: unknown;
    try {
      const result = await adminClient().rpc("ordax_consume_public_auth_rate_limit_v1", {
        p_bucket: bucket,
        p_client_address: trustedAddress.address,
      });
      data = result.data;
      rpcError = result.error;
    } catch {
      return error(503, "auth-rate-limit-unavailable", "A proteção de acesso está temporariamente indisponível.");
    }
    const decision = rpcError ? null : validateRateLimitRpcResult(data, bucket);
    if (!decision) {
      return error(503, "auth-rate-limit-unavailable", "A proteção de acesso está temporariamente indisponível.");
    }
    if (decision.decision === "rate_limited") {
      return error(
        429,
        "auth-rate-limited",
        "Muitas tentativas. Tente novamente mais tarde.",
        { "retry-after": String(decision.retry_after_seconds) },
      );
    }
  }

  let config;
  try {
    config = providerConfig();
  } catch {
    return error(503, "account-gateway-unconfigured", "O serviço de Conta está indisponível.");
  }

  const innerTarget = new URL(
    `/functions/v1/ordax-account-gateway${productUrl.pathname}${productUrl.search}`,
    config.url,
  );

  let upstream: Response;
  try {
    upstream = await fetch(innerTarget, {
      method: req.method,
      headers: upstreamHeaders(req, publicBridgeKey()),
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return error(503, "account-gateway-unavailable", "O serviço de Conta está indisponível.");
  }

  return boundedUpstreamResponse(upstream);
});
