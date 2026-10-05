import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeGatewayUrl,
  normalizeProductPath,
  normalizeTrustedEdgeAddress,
  normalizeVercelOidcToken,
  proxyPublicAccountRequest,
} from "../api/account-proxy.mjs";

const GATEWAY = "https://example.supabase.co/functions/v1/ordax-public-account-gateway";
const OIDC_TOKEN = `${"a".repeat(24)}.${"b".repeat(32)}.${"c".repeat(32)}`;

function options(extra = {}) {
  return { gatewayUrl: GATEWAY, oidcToken: OIDC_TOKEN, ...extra };
}

function request(path, init = {}) {
  return new Request(
    `https://ordax.com.br/api/account-proxy?ordax_path=${encodeURIComponent(path)}`,
    {
      method: init.method ?? "GET",
      headers: {
        host: "ordax.com.br",
        "x-forwarded-for": "203.0.113.15",
        ...(init.headers ?? {}),
      },
      body: init.body,
    },
  );
}

test("gateway configuration is strict https and exact public account gateway path", () => {
  assert.equal(normalizeGatewayUrl(GATEWAY)?.origin, "https://example.supabase.co");
  for (const invalid of [
    "http://example.supabase.co/functions/v1/ordax-public-account-gateway",
    "https://user@example.supabase.co/functions/v1/ordax-public-account-gateway",
    "https://example.supabase.co/functions/v1/ordax-account-gateway",
    "https://example.supabase.co/functions/v1/other",
    "https://example.supabase.co/functions/v1/ordax-public-account-gateway?x=1",
  ]) {
    assert.equal(normalizeGatewayUrl(invalid), null);
  }
});

test("only auth and sync product paths are accepted", () => {
  assert.equal(normalizeProductPath("/auth/session"), "/auth/session");
  assert.equal(normalizeProductPath("/sync/snapshot?limit=1"), "/sync/snapshot?limit=1");
  assert.equal(normalizeProductPath("/network/v2/messages/send"), null);
  assert.equal(normalizeProductPath("/auth/../network"), null);
});

test("Vercel OIDC token and edge address are bounded before upstream use", () => {
  assert.equal(normalizeVercelOidcToken(OIDC_TOKEN), OIDC_TOKEN);
  assert.equal(normalizeVercelOidcToken("not-a-jwt"), null);
  assert.equal(normalizeVercelOidcToken("a.b.c"), null);

  assert.equal(normalizeTrustedEdgeAddress("203.0.113.15"), "203.0.113.15");
  assert.equal(normalizeTrustedEdgeAddress("2001:db8::1"), "2001:db8::1");
  assert.equal(normalizeTrustedEdgeAddress("203.0.113.15, 10.0.0.1"), null);
  assert.equal(normalizeTrustedEdgeAddress("not-an-ip"), null);
});

test("public proxy accepts only GET and POST", async () => {
  for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    const response = await proxyPublicAccountRequest(
      request("/auth/session", { method }),
      options(),
    );
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "GET, POST");
  }
});

test("proxy replaces browser authority with Vercel runtime OIDC and trusted edge address", async () => {
  const originalFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, init) => {
    observed = { url: String(url), init };
    return new Response(
      JSON.stringify({ error: "public-account-access-disabled" }) + "\n",
      {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=999",
          "access-control-allow-origin": "*",
          "set-cookie": "ordax_access=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        },
      },
    );
  };
  try {
    const response = await proxyPublicAccountRequest(
      request("/auth/session", {
        headers: {
          authorization: "Bearer browser-must-not-cross-boundary",
          "x-ordax-client-address": "198.51.100.99",
        },
      }),
      options({ timeoutMs: 1000 }),
    );
    assert.equal(response.status, 503);
    assert.equal(observed.url, `${GATEWAY}/auth/session`);
    assert.equal(observed.init.headers.get("authorization"), `Bearer ${OIDC_TOKEN}`);
    assert.equal(observed.init.headers.get("x-ordax-public-site"), "1");
    assert.equal(observed.init.headers.get("x-forwarded-for"), "203.0.113.15");
    assert.equal(observed.init.headers.get("x-real-ip"), "203.0.113.15");
    assert.equal(observed.init.headers.get("x-ordax-client-address"), "203.0.113.15");
    assert.equal(observed.init.headers.get("x-forwarded-host"), "ordax.com.br");
    assert.equal(observed.init.headers.get("x-forwarded-proto"), "https");
    assert.equal(observed.init.headers.has("x-ordax-public-proxy-secret"), false);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(response.headers.has("access-control-allow-origin"), false);
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxy fails closed when deployment identity or trusted edge context is missing", async () => {
  const missingGateway = await proxyPublicAccountRequest(
    request("/auth/session"),
    { gatewayUrl: "", oidcToken: OIDC_TOKEN },
  );
  assert.equal(missingGateway.status, 503);

  const missingOidc = await proxyPublicAccountRequest(
    request("/auth/session"),
    { gatewayUrl: GATEWAY, oidcToken: "" },
  );
  assert.equal(missingOidc.status, 503);
  assert.equal((await missingOidc.json()).error, "public-proxy-identity-unavailable");

  const missingEdgeIp = await proxyPublicAccountRequest(
    new Request("https://ordax.com.br/api/account-proxy?ordax_path=%2Fauth%2Fsession", {
      headers: { host: "ordax.com.br" },
    }),
    options(),
  );
  assert.equal(missingEdgeIp.status, 400);
});

test("proxy rejects oversized bodies before upstream access", async () => {
  const response = await proxyPublicAccountRequest(
    request("/auth/login", {
      method: "POST",
      headers: {
        "content-length": String(64 * 1024 + 1),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "x=1",
    }),
    options(),
  );
  assert.equal(response.status, 413);
});
