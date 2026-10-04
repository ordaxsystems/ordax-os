import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeGatewayUrl,
  normalizeProductPath,
  proxyPublicAccountRequest,
} from "../api/account-proxy.mjs";

const GATEWAY = "https://example.supabase.co/functions/v1/ordax-account-gateway";

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

test("gateway configuration is strict https and exact account gateway path", () => {
  assert.equal(normalizeGatewayUrl(GATEWAY)?.origin, "https://example.supabase.co");
  for (const invalid of [
    "http://example.supabase.co/functions/v1/ordax-account-gateway",
    "https://user@example.supabase.co/functions/v1/ordax-account-gateway",
    "https://example.supabase.co/functions/v1/other",
    "https://example.supabase.co/functions/v1/ordax-account-gateway?x=1",
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

test("public proxy accepts only GET and POST", async () => {
  for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    const response = await proxyPublicAccountRequest(
      request("/auth/session", { method }),
      { gatewayUrl: GATEWAY },
    );
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "GET, POST");
  }
});

test("proxy injects trusted public-site provenance and never forwards browser authorization", async () => {
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
        headers: { authorization: "Bearer must-not-cross-boundary" },
      }),
      { gatewayUrl: GATEWAY, timeoutMs: 1000 },
    );
    assert.equal(response.status, 503);
    assert.equal(observed.url, `${GATEWAY}/auth/session`);
    assert.equal(observed.init.headers.get("x-ordax-public-site"), "1");
    assert.equal(observed.init.headers.get("x-forwarded-for"), "203.0.113.15");
    assert.equal(observed.init.headers.get("x-real-ip"), "203.0.113.15");
    assert.equal(observed.init.headers.get("x-forwarded-host"), "ordax.com.br");
    assert.equal(observed.init.headers.get("x-forwarded-proto"), "https");
    assert.equal(observed.init.headers.has("authorization"), false);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(response.headers.has("access-control-allow-origin"), false);
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxy fails closed when deployment context or configuration is missing", async () => {
  const missingGateway = await proxyPublicAccountRequest(request("/auth/session"), { gatewayUrl: "" });
  assert.equal(missingGateway.status, 503);

  const missingEdgeIp = await proxyPublicAccountRequest(
    new Request("https://ordax.com.br/api/account-proxy?ordax_path=%2Fauth%2Fsession", {
      headers: { host: "ordax.com.br" },
    }),
    { gatewayUrl: GATEWAY },
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
    { gatewayUrl: GATEWAY },
  );
  assert.equal(response.status, 413);
});
