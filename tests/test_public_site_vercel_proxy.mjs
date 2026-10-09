import assert from "node:assert/strict";
import test from "node:test";
import { productCookiesFromUpstream } from "../infra/supabase/functions/_shared/account_cookie_policy.mjs";

import { PUBLIC_ACCOUNT_ORIGIN, PUBLIC_SIGNUP_REDIRECT, PUBLIC_CONFIRMATION_URL, parseSignupConfirmation } from "../infra/supabase/functions/_shared/account_email_confirmation.mjs";

import {
  normalizeGatewayUrl,
  forwardPublicConfirmationQuery,
  normalizeProductPath,
  normalizePublicOrigin,
  normalizeTrustedEdgeAddress,
  normalizeUpstreamLocation,
  normalizeVercelOidcToken,
  proxyPublicAccountRequest,
  stripTurnstileToken,
  trustedCookieEnvelope,
  trustedSetCookie,
  verifyTurnstileToken,
} from "../api/account-proxy.mjs";

const GATEWAY = "https://example.supabase.co/functions/v1/ordax-public-account-gateway";
const PUBLIC_ORIGIN = "https://ordax.com.br";
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

test("signup confirmation allows only one email token hash and canonical OrdaX paths", () => {
  assert.equal(PUBLIC_ACCOUNT_ORIGIN, PUBLIC_ORIGIN);
  assert.equal(PUBLIC_SIGNUP_REDIRECT, PUBLIC_ORIGIN + "/login/");
  assert.equal(PUBLIC_CONFIRMATION_URL, PUBLIC_ORIGIN + "/auth/confirm");
  const hash = "a".repeat(64);
  const liveFormatHash = "b".repeat(56);
  assert.equal(parseSignupConfirmation(new URL(PUBLIC_CONFIRMATION_URL + "?token_hash=" + hash + "&type=email")), hash);
  assert.equal(parseSignupConfirmation(new URL(PUBLIC_CONFIRMATION_URL + "?token_hash=" + liveFormatHash + "&type=email")), liveFormatHash);
  for (const tooShortOrLong of ["a".repeat(31), "b".repeat(129), "g".repeat(56)]) {
    assert.equal(parseSignupConfirmation(new URL(PUBLIC_CONFIRMATION_URL + "?token_hash=" + tooShortOrLong + "&type=email")), null);
  }
  for (const u of [
    PUBLIC_CONFIRMATION_URL + "?token_hash=" + hash + "&type=signup",
    PUBLIC_CONFIRMATION_URL + "?token_hash=" + hash + "&type=email&type=email",
    PUBLIC_CONFIRMATION_URL + "?token_hash=invalid&type=email",
    PUBLIC_CONFIRMATION_URL + "?token_hash=" + hash + "&type=email&return_to=https://evil.test",
    PUBLIC_ORIGIN + "/auth/login?token_hash=" + hash + "&type=email",
  ]) assert.equal(parseSignupConfirmation(new URL(u)), null);
});

test("Vercel rewritten signup callback preserves only exact one-time OTP params", async () => {
  const hash = "a".repeat(56);
  const valid = new URLSearchParams({ordax_path: "/auth/confirm", token_hash: hash, type:"email"});
  const result = forwardPublicConfirmationQuery("/auth/confirm", valid);
  const augmented = new URLSearchParams("ordax_path=/auth/confirm&ordax_path=/auth/login&token_hash=" + hash + "&type=email&next=https://evil.invalid");
  assert.equal(forwardPublicConfirmationQuery("/auth/confirm", augmented), "/auth/confirm?token_hash=" + hash + "&type=email");
  const containedHash = "/auth/confirm?token_hash=" + hash + "&type=email";
  const doubled = new URLSearchParams({ordax_path: containedHash, token_hash: hash, type:"email"});
  assert.equal(forwardPublicConfirmationQuery(containedHash, doubled), "/auth/confirm?token_hash=" + hash + "&type=email");
  assert.equal(forwardPublicConfirmationQuery("/auth/confirm", new URLSearchParams("ordax_path=/auth/confirm")), "/auth/confirm");
  assert.equal(result, "/auth/confirm?token_hash=" + hash + "&type=email");
  assert.equal(forwardPublicConfirmationQuery("/auth/confirm", new URLSearchParams({ordax_path: "/auth/confirm"})), "/auth/confirm");
  // Vercel may duplicate the same destination rewrite field. That must not
  // make the legitimate confirmation link look like an unsupported route.
  const twice = new URLSearchParams("ordax_path=/auth/confirm&ordax_path=/auth/confirm&token_hash=" + hash + "&type=email");
  assert.equal(forwardPublicConfirmationQuery("/auth/confirm", twice), "/auth/confirm?token_hash=" + hash + "&type=email");
  for(const invalid of [
    new URLSearchParams({ordax_path: "/auth/login", token_hash:hash, type:"email"}),
    new URLSearchParams("ordax_path=/auth/confirm&token_hash=" + hash + "&type=signup"),
    new URLSearchParams("ordax_path=/auth/confirm&token_hash=" + hash + "&token_hash=" + "b".repeat(64) + "&type=email"),
  ]) {
    assert.equal(forwardPublicConfirmationQuery(invalid.get("ordax_path"), invalid), null);
  }
  const original = globalThis.fetch;
  let upstreamUrl;
  globalThis.fetch = async (url) => {
    upstreamUrl = String(url);
    return new Response(null, {status:303,headers:{"location":"/login/?cadastro=confirmado"}});
  };
  try {
    const req = new Request(PUBLIC_ORIGIN + "/api/account-proxy?" + valid.toString(), {
      headers: { "x-forwarded-for": "203.0.113.15" },
    });
    const response = await proxyPublicAccountRequest(req, options());
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("location"), "/login/?cadastro=confirmado");
    assert.ok(upstreamUrl.includes("/auth/confirm?token_hash="));
    assert.match(upstreamUrl, /type=email/);

    // Reproduce Vercel's repeatable rewrite field in an actual GET callback.
    const withDuplicateRewrite = new Request(PUBLIC_ORIGIN + "/api/account-proxy?" + twice.toString(), {
      headers: {"x-forwarded-for":"203.0.113.15"},
    });
    const repeatedResponse = await proxyPublicAccountRequest(withDuplicateRewrite, options());
    assert.equal(repeatedResponse.status, 303);
    assert.ok(upstreamUrl.includes("/auth/confirm?token_hash="));
  } finally {
    globalThis.fetch = original;
  }
});

test("ordinary auth routes survive Vercel rewrite metadata without OTP parsing", async () => {
  const originalFetch = globalThis.fetch;
  const forwarded = [];
  globalThis.fetch = async (url) => {
    forwarded.push(String(url));
    return new Response(JSON.stringify({
      $schema: "prototype-ordax.public-identity-session/1",
      provider: "supabase",
      status: "anonymous",
      authenticated: false,
    }), {status:200,headers:{"content-type":"application/json"}});
  };
  try {
    // Real Vercel routes include internal rewrite query fields. Treat these
    // solely as routing metadata, never as signup verification tokens.
    for (const path of ["/auth/session", "/auth/registration-policy", "/auth/login", "/sync/snapshot", "/account/spaces"]) {
      const url = PUBLIC_ORIGIN + "/api/account-proxy?ordax_path=" + encodeURIComponent(path) +
        "&ordax_path=" + encodeURIComponent(path) + "&request-path=middleware";
      const response = await proxyPublicAccountRequest(
        new Request(url, {headers:{"x-forwarded-for":"203.0.113.15"}}),
        options(),
      );
      assert.equal(response.status, 200, path);
      assert.ok(forwarded.at(-1).endsWith(path), path);
      assert.ok(!forwarded.at(-1).includes("request-path"), path);
    }
    // Contradictory OTP values fail closed, even when rewrite metadata is
    // repeated. Irrelevant query values are dropped, never forwarded.
    const hash = "a".repeat(64);
    for(const qs of [
      "ordax_path=/auth/confirm&token_hash=" + hash + "&token_hash=" + "b".repeat(64) + "&type=email",
      "ordax_path=/auth/confirm&token_hash=" + hash + "&type=signup",
    ]) {
      const before = forwarded.length;
      const bad = await proxyPublicAccountRequest(
        new Request(PUBLIC_ORIGIN + "/api/account-proxy?" + qs, {headers:{"x-forwarded-for":"203.0.113.15"}}),
        options(),
      );
      assert.equal(bad.status, 404);
      assert.equal(forwarded.length, before);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test("public origin normalizer accepts only syntactically safe https origins", () => {
  assert.equal(normalizePublicOrigin(PUBLIC_ORIGIN), PUBLIC_ORIGIN);
  assert.equal(normalizePublicOrigin(`${PUBLIC_ORIGIN}/`), PUBLIC_ORIGIN);
  assert.equal(normalizePublicOrigin("https://evil.example"), "https://evil.example");
  for (const invalid of [
    "http://ordax.com.br",
    "https://user@ordax.com.br",
    `${PUBLIC_ORIGIN}/auth/`,
    `${PUBLIC_ORIGIN}?x=1`,
  ]) {
    assert.equal(normalizePublicOrigin(invalid), null);
  }
});

test("only auth, sync and exact account routes with exact methods are accepted", () => {
  assert.equal(normalizeProductPath("/auth/session", "GET"), "/auth/session");
  assert.equal(normalizeProductPath("/sync/snapshot?limit=1", "GET"), "/sync/snapshot?limit=1");
  assert.equal(normalizeProductPath("/account/export", "GET"), "/account/export");
  assert.equal(normalizeProductPath("/account/spaces", "GET"), "/account/spaces");
  assert.equal(
    normalizeProductPath("/account/entitlements/memory-cloud", "GET"),
    "/account/entitlements/memory-cloud",
  );
  assert.equal(normalizeProductPath("/account/close", "POST"), "/account/close");

  assert.equal(normalizeProductPath("/account/close", "GET"), null);
  assert.equal(normalizeProductPath("/account/export", "POST"), null);
  assert.equal(normalizeProductPath("/account/admin", "GET"), null);
  assert.equal(normalizeProductPath("/network/v2/messages/send", "POST"), null);
  assert.equal(normalizeProductPath("/auth/../network", "GET"), null);
  assert.equal(normalizeProductPath("/auth/%2e%2e/network", "GET"), null);
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
  for (const name of ["ordax_recovery_access", "ordax_recovery_refresh", "ordax_recovery"]) {
    const recovery = `${name}=value; Path=/auth/recover; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
    assert.equal(trustedSetCookie(recovery), recovery);
    assert.equal(
      trustedSetCookie(`${name}=value; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`),
      null,
    );
  }
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

test("cookie envelope accepts only unique validated OrdaX cookies", () => {
  const access = "ordax_access=value; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600";
  const refresh = "ordax_refresh=value; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600";
  assert.deepEqual(
    trustedCookieEnvelope(JSON.stringify([access, refresh])),
    [access, refresh],
  );
  assert.deepEqual(trustedCookieEnvelope(null), []);
  assert.throws(
    () => trustedCookieEnvelope(JSON.stringify([access, access])),
    /duplicate-upstream-cookie/,
  );
  assert.throws(
    () => trustedCookieEnvelope(JSON.stringify([
      "attacker=value; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600",
    ])),
    /unsafe-upstream-cookie/,
  );
  assert.throws(() => trustedCookieEnvelope("{not-json"), /invalid-cookie-envelope/);
});

test("product envelope excludes Supabase and Cloudflare transport cookies", () => {
  const access = "ordax_access=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
  const refresh = "ordax_refresh=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
  const cf = "__cf_bm=bot; Path=/; HttpOnly; Secure; SameSite=None";
  assert.deepEqual(productCookiesFromUpstream([cf, access, refresh]), [access, refresh]);
  assert.deepEqual(productCookiesFromUpstream([cf]), []);
  assert.throws(() => productCookiesFromUpstream([access, access]), /duplicate-upstream-cookie/);
  assert.throws(() => productCookiesFromUpstream([
    "ordax_access=value; Domain=evil.example; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=30",
  ]), /unsafe-upstream-cookie/);
  assert.throws(() => productCookiesFromUpstream([
    "ordax_admin=fake; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=30",
  ]), /unknown-ordax-cookie/);
  assert.throws(() => productCookiesFromUpstream([
    cf, "evil=bad\r\nSet-Cookie:ordax_access=secret",
  ]), /invalid-transport-cookie/);
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
          "set-cookie": "__cf_bm=transport-only; Path=/; HttpOnly; Secure; SameSite=None",
          "x-ordax-cookie-envelope": JSON.stringify([
            "ordax_access=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
          ]),
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
    assert.equal(observed.init.headers.get("x-forwarded-host"), "ordax.com.br");
    assert.equal(observed.init.headers.get("x-forwarded-proto"), "https");
    assert.equal(observed.init.headers.get("x-ordax-public-origin"), PUBLIC_ORIGIN);
    assert.equal(observed.init.headers.get("x-ordax-public-host"), "ordax.com.br");
    assert.equal(observed.init.headers.get("x-ordax-public-proto"), "https");
    assert.equal(observed.init.headers.has("x-ordax-public-proxy-secret"), false);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(response.headers.has("access-control-allow-origin"), false);
    assert.match(response.headers.get("set-cookie") ?? "", /^ordax_access=/);
    assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /__cf_bm/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxy rejects unsafe redirects and cookie envelopes while discarding transport cookies", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, {
      status: 303,
      headers: { location: "https://evil.example/steal" },
    });
    let response = await proxyPublicAccountRequest(request("/auth/login"), options());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "unsafe-account-gateway-response");

    globalThis.fetch = async () => new Response("ok", {
      status: 200,
      headers: {
        "set-cookie": "__cf_bm=transport-only; Path=/; HttpOnly; Secure; SameSite=None",
      },
    });
    response = await proxyPublicAccountRequest(request("/auth/session"), options());
    assert.equal(response.status, 200);
    assert.equal(response.headers.has("set-cookie"), false);

    globalThis.fetch = async () => new Response("bad", {
      status: 200,
      headers: {
        "x-ordax-cookie-envelope": JSON.stringify([
          "attacker=value; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600",
        ]),
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

test("Turnstile form token is bounded, unique and stripped before upstream use", () => {
  const encoded = new TextEncoder().encode(
    "email=a%40b.test&password=example-password&cf-turnstile-response=token-12345678901234567890",
  );
  const parsed = stripTurnstileToken(encoded, "application/x-www-form-urlencoded");
  assert.equal(parsed.token, "token-12345678901234567890");
  const clean = new TextDecoder().decode(parsed.body);
  assert.match(clean, /email=a%40b.test/);
  assert.doesNotMatch(clean, /cf-turnstile-response/);

  assert.throws(
    () => stripTurnstileToken(
      new TextEncoder().encode("email=a%40b.test"),
      "application/x-www-form-urlencoded",
    ),
    /turnstile-token-required/,
  );
  assert.throws(
    () => stripTurnstileToken(
      new TextEncoder().encode("cf-turnstile-response=a&cf-turnstile-response=b"),
      "application/x-www-form-urlencoded",
    ),
    /turnstile-token-required/,
  );
});

test("Turnstile verifier requires success, exact hostname and exact action", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      success: true,
      hostname: "ordax.com.br",
      action: "ordax-account",
    }), { status: 200 });
  };
  const ok = await verifyTurnstileToken("token-12345678901234567890", {
    secret: "server-secret",
    remoteIp: "203.0.113.15",
    expectedHostname: "ordax.com.br",
    fetchImpl,
  });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  const submitted = new URLSearchParams(calls[0].init.body);
  assert.equal(submitted.get("response"), "token-12345678901234567890");
  assert.equal(submitted.get("remoteip"), "203.0.113.15");
  assert.equal(submitted.get("secret"), "server-secret");

  const wrongHost = await verifyTurnstileToken("token-12345678901234567890", {
    secret: "server-secret",
    remoteIp: "203.0.113.15",
    expectedHostname: "evil.example",
    fetchImpl,
  });
  assert.equal(wrongHost, false);
});

test("Turnstile response rejects oversized content-length without pulling remote bytes", async () => {
  let pulled = false;
  const stream = new ReadableStream({
    pull() { pulled = true; },
  }, { highWaterMark: 0 });
  const response = new Response(stream, {
    headers: { "content-length": String(64 * 1024 + 1) },
  });
  await assert.rejects(
    verifyTurnstileToken("token-12345678901234567890", {
      secret: "server-secret",
      remoteIp: "203.0.113.15",
      expectedHostname: "ordax.com.br",
      fetchImpl: async () => response,
    }),
    { name: "RangeError", message: "body-too-large" },
  );
  assert.equal(pulled, false);
  await stream.cancel();
});

test("Turnstile rejects oversized streamed response even with a false small header", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(40 * 1024));
      controller.enqueue(new Uint8Array(40 * 1024));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(
    verifyTurnstileToken("token-12345678901234567890", {
      secret: "server-secret",
      remoteIp: "203.0.113.15",
      expectedHostname: "ordax.com.br",
      fetchImpl: async () => new Response(stream, {
        headers: { "content-length": "3" },
      }),
    }),
    { name: "RangeError", message: "body-too-large" },
  );
  assert.equal(cancelled, true);
});

test("Turnstile fails closed on malformed UTF-8 response without forwarding anything", async () => {
  await assert.rejects(
    verifyTurnstileToken("token-12345678901234567890", {
      secret: "server-secret",
      remoteIp: "203.0.113.15",
      expectedHostname: "ordax.com.br",
      fetchImpl: async () => new Response(new Uint8Array([0xff, 0xfe]), { status: 200 }),
    }),
    TypeError,
  );
});

test("public login fails closed without Turnstile and never forwards challenge token", async () => {
  const originalFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, init) => {
    observed = { url: String(url), init };
    return new Response(JSON.stringify({ error: "public-account-access-disabled" }) + "\n", {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };
  try {
    let response = await proxyPublicAccountRequest(
      request("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "email=a%40b.test&password=example-password",
      }),
      options({ turnstileSecret: "server-secret" }),
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "bot-verification-required");

    response = await proxyPublicAccountRequest(
      request("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "email=a%40b.test&password=example-password&cf-turnstile-response=token-12345678901234567890",
      }),
      options({
        turnstileSecret: "server-secret",
        turnstileVerifier: async () => true,
      }),
    );
    assert.equal(response.status, 503);
    assert.equal(observed.url, `${GATEWAY}/auth/login`);
    const forwarded = new TextDecoder().decode(observed.init.body);
    assert.match(forwarded, /email=a%40b.test/);
    assert.doesNotMatch(forwarded, /cf-turnstile-response/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public auth fails closed when Turnstile server secret is absent or verification service errors", async () => {
  const body = "email=a%40b.test&password=example-password&cf-turnstile-response=token-12345678901234567890";
  let response = await proxyPublicAccountRequest(
    request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
    options({ turnstileSecret: "" }),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "bot-protection-unconfigured");

  response = await proxyPublicAccountRequest(
    request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
    options({
      turnstileSecret: "server-secret",
      turnstileVerifier: async () => { throw new Error("unavailable"); },
    }),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "bot-verification-unavailable");
});


test("HTML auth form failures redirect safely without leaking credentials; API failures keep status", async () => {
  const pathCases = [
    ["/auth/login", "/login/"],
    ["/auth/register", "/cadastro/"],
  ];
  for (const [path, destination] of pathCases) {
    const form = request(path, {
      method: "POST",
      headers: { "accept": "text/html,application/xhtml+xml", "content-type": "application/x-www-form-urlencoded" },
      body: "email=a%40b.test&password=private-password&cf-turnstile-response=token-12345678901234567890",
    });
    const rejected = await proxyPublicAccountRequest(form, options({
      turnstileSecret: "server-secret",
      turnstileVerifier: async () => false,
    }));
    assert.equal(rejected.status, 303);
    assert.equal(rejected.headers.get("location"), destination + "?erro=verificacao-falhou");
    assert.equal(rejected.headers.get("cache-control"), "no-store, max-age=0");
    assert.doesNotMatch(rejected.headers.get("location"), /a%40b|private-password|token/i);

    const api = await proxyPublicAccountRequest(request(path, {
      method: "POST",
      headers: { "accept": "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: "email=a%40b.test&password=private-password&cf-turnstile-response=token-12345678901234567890",
    }), options({ turnstileSecret: "server-secret", turnstileVerifier: async () => false }));
    assert.equal(api.status, 403);
    assert.equal((await api.json()).error, "bot-verification-failed");

    const unavailable = await proxyPublicAccountRequest(request(path, {
      method: "POST",
      headers: { "accept": "text/html", "content-type": "application/x-www-form-urlencoded" },
      body: "email=a%40b.test&password=private-password&cf-turnstile-response=token-12345678901234567890",
    }), options({ turnstileSecret: "", turnstileVerifier: async () => false }));
    assert.equal(unavailable.status, 303);
    assert.equal(unavailable.headers.get("location"), destination + "?erro=seguranca-indisponivel");
  }
});

test("proxy rejects an oversized streamed body even when content-length lies", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("should never reach upstream");
  };
  try {
    const response = await proxyPublicAccountRequest(
      request("/sync/mutate", {
        method: "POST",
        headers: {
          "content-length": "1",
          "content-type": "application/json",
        },
        body: "a".repeat(64 * 1024 + 1),
      }),
      options(),
    );
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, "request-too-large");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
