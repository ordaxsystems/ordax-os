import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeGatewayUrl,
  normalizeProductPath,
  normalizePublicOrigin,
  normalizeTrustedEdgeAddress,
  normalizeUpstreamLocation,
  normalizeVercelOidcToken,
  proxyPublicAccountRequest,
  trustedSetCookie,
} from "../api/account-proxy.mjs";

const GATEWAY = "https://example.supabase.co/functions/v1/ordax-public-account-gateway";
const PUBLIC_ORIGIN = "https://ordax-os-public.vercel.app";
const OIDC_TOKEN = `${"a".repeat(24)}.${"b".repeat(32)}.${"c".repeat(32)}`;

function options(extra = {}) {
  return {
    gatewayUrl: GATEWAY,
    oidcToken: OIDC_TOKEN,
    publicOrigin: PUBLIC_ORIGIN,
    ...extra,
  };
}

function request(path, init = {}) {
  const method = init.method ?? "GET";
  return new Request(
    `${PUBLIC_ORIGIN}/api/account-proxy?ordax_path=${encodeURIComponent(path)}`,
    {
      method,
      headers: {
        host: init.host ?? "attacker-controlled.example",
        "x-forwarded-for": "203.0.113.15",
        ...(method === "POST"
          ? { origin: PUBLIC_ORIGIN, "sec-fetch-site": "same-origin" }
          : {}),
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

test("public origin is exact https origin only", () => {
  assert.equal(normalizePublicOrigin(PUBLIC_ORIGIN), PUBLIC_ORIGIN);
  assert.equal(normalizePublicOrigin(`${PUBLIC_ORIGIN}/`), PUBLIC_ORIGIN);
  for (const invalid of [
    "http://ordax-os-public.vercel.app",
    "https://user@ordax-os-public.vercel.app",
    `${PUBLIC_ORIGIN}/auth/`,
    `${PUBLIC_ORIGIN}?x=1`,
    "https://evil.example",
  ]) {
    assert.equal(normalizePublicOrigin(invalid), null);
  }
});

test("only auth and sync product paths are accepted", () => {
  assert.equal(normalizeProductPath("/auth/session"), "/auth/session");
  assert.equal(normalizeProductPath("/sync/snapshot?limit=1"), "/sync/snapshot?limit=1");
  assert.equal(normalizeProductPath("/network/v2/messages/send"), null);
  assert.equal(normalizeProductPath("/auth/../network"), null);
  assert.equal(normalizeProductPath("/auth/%2e%2e/network"), null);
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

test("redirect and cookie passthrough are fail-closed", () => {
  assert.equal(normalizeUpstreamLocation("/conta/?ok=1"), "/conta/?ok=1");
  assert.equal(normalizeUpstreamLocation("https://evil.example/steal"), null);
  assert.equal(normalizeUpstreamLocation("//evil.example/steal"), null);
  assert.equal(normalizeUpstreamLocation("/safe\\evil"), null);

  const valid = "ordax_access=value; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600";
  assert.equal(trustedSetCookie(valid), valid);
  assert.equal(
    trustedSetCookie("evil=value; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600"),
    null,
  );
  assert.equal(
    trustedSetCookie("ordax_access=value; Domain=evil.example; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600"),
    null,
  );
  assert.equal(
    trustedSetCookie("ordax_access=value; Path=/; Secure; SameSite=Lax; Max-Age=3600"),
    null,
  );
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

test("proxy rejects non-canonical incoming origins before upstream access", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("unexpected");
  };
  try {
    const response = await proxyPublicAccountRequest(
      new Request("https://preview.example/api/account-proxy?ordax_path=%2Fauth%2Fsession", {
        headers: { "x-forwarded-for": "203.0.113.15" },
      }),
      options(),
    );
    assert.equal(response.status, 421);
    assert.equal((await response.json()).error, "public-origin-mismatch");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxy rejects POST without exact Origin and same-origin Fetch Metadata before upstream access", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("unexpected");
  };
  try {
    const noOrigin = new Request(
      `${PUBLIC_ORIGIN}/api/account-proxy?ordax_path=%2Fauth%2Flogin`,
      {
        method: "POST",
        headers: {
          "x-forwarded-for": "203.0.113.15",
          "content-type": "application/x-www-form-urlencoded",
          "sec-fetch-site": "same-origin",
        },
        body: "email=a%40b.test&password=example-password",
      },
    );
    let response = await proxyPublicAccountRequest(noOrigin, options());
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "browser-origin-required");

    const wrongSite = request("/auth/login", {
      method: "POST",
      headers: { "sec-fetch-site": "same-site" },
      body: "email=a%40b.test&password=example-password",
    });
    response = await proxyPublicAccountRequest(wrongSite, options());
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "same-origin-fetch-metadata-required");

    const wrongOrigin = request("/auth/login", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: "email=a%40b.test&password=example-password",
    });
    response = await proxyPublicAccountRequest(wrongOrigin, options());
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "browser-origin-mismatch");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxy derives forwarded authority from canonical config, never browser Host", async () => {
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
        host: "evil.example",
        headers: {
          authorization: "Bearer browser-must-not-cross-boundary",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "http",
          "x-ordax-public-origin": "https://evil.example",
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
    assert.equal(observed.init.headers.get("x-forwarded-host"), "ordax-os-public.vercel.app");
    assert.equal(observed.init.headers.get("x-forwarded-proto"), "https");
    assert.equal(observed.init.headers.get("x-ordax-public-origin"), PUBLIC_ORIGIN);
    assert.equal(observed.init.headers.has("x-ordax-public-proxy-secret"), false);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(response.headers.has("access-control-allow-origin"), false);
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxy rejects unsafe upstream redirects and cookies", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, {
      status: 303,
      headers: { location: "https://evil.example/steal" },
    });
    let response = await proxyPublicAccountRequest(request("/auth/login"), options());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "unsafe-account-gateway-response");

    globalThis.fetch = async () => new Response("bad", {
      status: 200,
      headers: {
        "set-cookie": "attacker=value; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600",
      },
    });
    response = await proxyPublicAccountRequest(request("/auth/session"), options());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "unsafe-account-gateway-response");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxy fails closed when deployment identity, origin, or trusted edge context is missing", async () => {
  const missingGateway = await proxyPublicAccountRequest(
    request("/auth/session"),
    { gatewayUrl: "", oidcToken: OIDC_TOKEN, publicOrigin: PUBLIC_ORIGIN },
  );
  assert.equal(missingGateway.status, 503);

  const missingOidc = await proxyPublicAccountRequest(
    request("/auth/session"),
    { gatewayUrl: GATEWAY, oidcToken: "", publicOrigin: PUBLIC_ORIGIN },
  );
  assert.equal(missingOidc.status, 503);
  assert.equal((await missingOidc.json()).error, "public-proxy-identity-unavailable");

  const missingOrigin = await proxyPublicAccountRequest(
    request("/auth/session"),
    { gatewayUrl: GATEWAY, oidcToken: OIDC_TOKEN, publicOrigin: "" },
  );
  assert.equal(missingOrigin.status, 503);
  assert.equal((await missingOrigin.json()).error, "public-origin-unconfigured");

  const missingEdgeIp = await proxyPublicAccountRequest(
    new Request(`${PUBLIC_ORIGIN}/api/account-proxy?ordax_path=%2Fauth%2Fsession`),
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
