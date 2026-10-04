const UPSTREAM_ORIGIN = "https://eobcxuyvhkvdmkbaihwh.supabase.co";
const UPSTREAM_FUNCTION_PREFIX = "/functions/v1/ordax-account-gateway";
const MAX_QUERY_CHARACTERS = 4096;

const ALLOWED_HOSTS = new Set(["ordax.com.br", "www.ordax.com.br"]);

const ROUTES = new Map([
  ["GET /auth/registration-policy", null],
  ["GET /auth/session", null],
  ["GET /auth/login", null],
  ["GET /auth/register", null],
  ["POST /auth/login", "AUTH_CREDENTIALS_RATE_LIMITER"],
  ["POST /auth/register", "AUTH_CREDENTIALS_RATE_LIMITER"],
  ["POST /auth/logout", null],
  ["POST /auth/recover", "AUTH_RECOVERY_REQUEST_RATE_LIMITER"],
  ["GET /auth/recover/verify", "AUTH_RECOVERY_COMPLETION_RATE_LIMITER"],
  ["POST /auth/recover/complete", "AUTH_RECOVERY_COMPLETION_RATE_LIMITER"],
  ["GET /account/export", null],
  ["GET /account/spaces", null],
  ["GET /account/entitlements/memory-cloud", null],
  ["POST /account/close", "ACCOUNT_MUTATION_RATE_LIMITER"],
  ["GET /sync/snapshot", null],
  ["GET /sync/changes", null],
  ["GET /sync/objects", null],
  ["POST /sync/mutate", null],
]);

const FORWARDED_REQUEST_HEADERS = Object.freeze([
  "accept",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "user-agent",
]);

const STRIPPED_RESPONSE_HEADERS = Object.freeze([
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-expose-headers",
]);

function jsonError(status, code, message) {
  return new Response(JSON.stringify({
    $schema: "prototype-ordax.public-account-edge-error/1",
    error: code,
    message,
  }) + "\n", {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
      "pragma": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}

function normalizedClientIp(request) {
  const value = (request.headers.get("cf-connecting-ip") ?? "").trim();
  if (!value || value.length > 64 || /[\r\n,]/.test(value)) return null;
  return value;
}

function routeKey(request, url) {
  return `${request.method.toUpperCase()} ${url.pathname}`;
}

async function enforceRateLimit(bindingName, request, env) {
  if (!bindingName) return null;
  const clientIp = normalizedClientIp(request);
  const limiter = env?.[bindingName];
  if (!clientIp || !limiter || typeof limiter.limit !== "function") {
    return jsonError(
      503,
      "edge-rate-limit-unavailable",
      "A proteção de acesso à Conta OrdaX está temporariamente indisponível.",
    );
  }

  try {
    const result = await limiter.limit({ key: clientIp });
    if (!result || result.success !== true) {
      return jsonError(429, "edge-rate-limited", "Tente novamente mais tarde.");
    }
  } catch {
    return jsonError(
      503,
      "edge-rate-limit-unavailable",
      "A proteção de acesso à Conta OrdaX está temporariamente indisponível.",
    );
  }
  return null;
}

function buildUpstreamHeaders(request, url, clientIp) {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", "https");
  headers.set("x-ordax-public-site", "1");
  if (clientIp) {
    headers.set("x-forwarded-for", clientIp);
    headers.set("x-real-ip", clientIp);
  }
  return headers;
}

function sanitizeUpstreamResponse(response) {
  const headers = new Headers(response.headers);
  for (const name of STRIPPED_RESPONSE_HEADERS) headers.delete(name);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("x-content-type-options", "nosniff");

  if (response.status >= 300 && response.status < 400) {
    const location = headers.get("location");
    if (location && !location.startsWith("/")) {
      return jsonError(
        502,
        "edge-invalid-upstream-redirect",
        "A Conta OrdaX retornou uma navegação inválida.",
      );
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handlePublicAccountRequest(request, env, fetchImpl = fetch) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return jsonError(400, "edge-invalid-url", "Solicitação inválida.");
  }

  if (url.protocol !== "https:") {
    return jsonError(400, "edge-https-required", "HTTPS é obrigatório para a Conta OrdaX.");
  }
  if (!ALLOWED_HOSTS.has(url.hostname) || url.username || url.password) {
    return jsonError(404, "edge-host-not-found", "Rota inexistente.");
  }
  if (url.search.length > MAX_QUERY_CHARACTERS) {
    return jsonError(414, "edge-query-too-large", "A solicitação excede o limite permitido.");
  }

  const key = routeKey(request, url);
  if (!ROUTES.has(key)) {
    const pathIsOwned = url.pathname.startsWith("/auth/")
      || url.pathname.startsWith("/account/")
      || url.pathname.startsWith("/sync/");
    return jsonError(
      pathIsOwned ? 405 : 404,
      pathIsOwned ? "edge-method-or-route-not-allowed" : "edge-route-not-found",
      pathIsOwned ? "Método ou rota não permitidos." : "Rota inexistente.",
    );
  }

  const limitResponse = await enforceRateLimit(ROUTES.get(key), request, env);
  if (limitResponse) return limitResponse;

  const clientIp = normalizedClientIp(request);
  const upstreamUrl = new URL(`${UPSTREAM_ORIGIN}${UPSTREAM_FUNCTION_PREFIX}${url.pathname}`);
  upstreamUrl.search = url.search;

  let upstream;
  try {
    upstream = await fetchImpl(upstreamUrl, {
      method: request.method,
      headers: buildUpstreamHeaders(request, url, clientIp),
      body: ["GET", "HEAD"].includes(request.method.toUpperCase()) ? undefined : request.body,
      redirect: "manual",
    });
  } catch {
    return jsonError(503, "edge-upstream-unavailable", "A Conta OrdaX está temporariamente indisponível.");
  }

  return sanitizeUpstreamResponse(upstream);
}

export const PUBLIC_ACCOUNT_EDGE_POLICY = Object.freeze({
  schema: "prototype-ordax.public-account-edge/1",
  upstreamOrigin: UPSTREAM_ORIGIN,
  upstreamFunctionPrefix: UPSTREAM_FUNCTION_PREFIX,
  allowedHosts: Object.freeze([...ALLOWED_HOSTS]),
  routes: Object.freeze([...ROUTES.keys()]),
  authority: "transport-only",
});

export default {
  fetch(request, env) {
    return handlePublicAccountRequest(request, env, fetch);
  },
};
