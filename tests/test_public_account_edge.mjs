import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLIC_ACCOUNT_EDGE_POLICY,
  handlePublicAccountRequest,
} from "../infra/cloudflare/ordax-public-account-edge/index.mjs";

function limiter(success = true) {
  return {
    calls: [],
    async limit(input) {
      this.calls.push(input);
      return { success };
    },
  };
}

function env(overrides = {}) {
  return {
    AUTH_CREDENTIALS_RATE_LIMITER: limiter(),
    AUTH_RECOVERY_REQUEST_RATE_LIMITER: limiter(),
    AUTH_RECOVERY_COMPLETION_RATE_LIMITER: limiter(),
    ACCOUNT_MUTATION_RATE_LIMITER: limiter(),
    ...overrides,
  };
}

function request(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", "203.0.113.7");
  return new Request(`https://ordax.com.br${path}`, { ...init, headers });
}

test("edge policy is transport-only and owns account routes including /account", () => {
  assert.equal(PUBLIC_ACCOUNT_EDGE_POLICY.schema, "prototype-ordax.public-account-edge/1");
  assert.equal(PUBLIC_ACCOUNT_EDGE_POLICY.authority, "transport-only");
  assert.equal(PUBLIC_ACCOUNT_EDGE_POLICY.upstreamOrigin, "https://eobcxuyvhkvdmkbaihwh.supabase.co");
  assert.equal(PUBLIC_ACCOUNT_EDGE_POLICY.routes.includes("POST /auth/register"), true);
  assert.equal(PUBLIC_ACCOUNT_EDGE_POLICY.routes.includes("GET /account/export"), true);
  assert.equal(PUBLIC_ACCOUNT_EDGE_POLICY.routes.includes("POST /account/close"), true);
  assert.equal(PUBLIC_ACCOUNT_EDGE_POLICY.routes.includes("POST /sync/mutate"), true);
});

test("unsupported hosts, insecure transport and unowned routes fail closed", async () => {
  const fakeFetch = async () => { throw new Error("must not fetch"); };

  const insecure = await handlePublicAccountRequest(
    new Request("http://ordax.com.br/auth/session", { headers: { "cf-connecting-ip": "203.0.113.7" } }),
    env(),
    fakeFetch,
  );
  assert.equal(insecure.status, 400);

  const foreign = await handlePublicAccountRequest(
    new Request("https://evil.example/auth/session", { headers: { "cf-connecting-ip": "203.0.113.7" } }),
    env(),
    fakeFetch,
  );
  assert.equal(foreign.status, 404);

  const unowned = await handlePublicAccountRequest(request("/network/v2/messages/send", { method: "POST" }), env(), fakeFetch);
  assert.equal(unowned.status, 404);

  const wrongMethod = await handlePublicAccountRequest(request("/auth/login", { method: "DELETE" }), env(), fakeFetch);
  assert.equal(wrongMethod.status, 405);
});

test("edge rebuilds trusted forwarding headers and never forwards browser authorization", async () => {
  let observed;
  const fakeFetch = async (url, init) => {
    observed = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      },
    });
  };

  const req = request("/auth/session?probe=1", {
    headers: {
      authorization: "Bearer browser-supplied-token",
      cookie: "ordax_access=session-cookie",
      origin: "https://ordax.com.br",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "198.51.100.99",
      "x-forwarded-host": "evil.example",
      "x-real-ip": "198.51.100.100",
    },
  });
  const response = await handlePublicAccountRequest(req, env(), fakeFetch);

  assert.equal(response.status, 200);
  assert.equal(
    observed.url,
    "https://eobcxuyvhkvdmkbaihwh.supabase.co/functions/v1/ordax-account-gateway/auth/session?probe=1",
  );
  assert.equal(observed.init.redirect, "manual");
  assert.equal(observed.init.headers.get("authorization"), null);
  assert.equal(observed.init.headers.get("cookie"), "ordax_access=session-cookie");
  assert.equal(observed.init.headers.get("origin"), "https://ordax.com.br");
  assert.equal(observed.init.headers.get("x-forwarded-host"), "ordax.com.br");
  assert.equal(observed.init.headers.get("x-forwarded-proto"), "https");
  assert.equal(observed.init.headers.get("x-forwarded-for"), "203.0.113.7");
  assert.equal(observed.init.headers.get("x-real-ip"), "203.0.113.7");
  assert.equal(observed.init.headers.get("x-ordax-public-site"), "1");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});

test("credential routes fail closed without the configured limiter", async () => {
  const response = await handlePublicAccountRequest(
    request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=a%40b.test&password=example",
    }),
    env({ AUTH_CREDENTIALS_RATE_LIMITER: undefined }),
    async () => { throw new Error("must not fetch"); },
  );
  assert.equal(response.status, 503);
  assert.match(await response.text(), /edge-rate-limit-unavailable/);
});

test("credential limiter keys only on the Cloudflare-provided client address", async () => {
  const credentials = limiter(true);
  let forwarded = false;
  const response = await handlePublicAccountRequest(
    request("/auth/register", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": "192.0.2.200",
      },
      body: "email=a%40b.test&password=long-enough&legal_acceptance=accepted",
    }),
    env({ AUTH_CREDENTIALS_RATE_LIMITER: credentials }),
    async () => {
      forwarded = true;
      return new Response("{}", { status: 503 });
    },
  );

  assert.equal(forwarded, true);
  assert.deepEqual(credentials.calls, [{ key: "203.0.113.7" }]);
  assert.equal(response.status, 503);
});

test("rate limited requests return 429 before reaching Supabase", async () => {
  let forwarded = false;
  const response = await handlePublicAccountRequest(
    request("/auth/recover", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=a%40b.test",
    }),
    env({ AUTH_RECOVERY_REQUEST_RATE_LIMITER: limiter(false) }),
    async () => {
      forwarded = true;
      return new Response("unexpected");
    },
  );
  assert.equal(forwarded, false);
  assert.equal(response.status, 429);
});

test("unexpected absolute redirects from upstream are rejected", async () => {
  const response = await handlePublicAccountRequest(
    request("/auth/login"),
    env(),
    async () => new Response(null, {
      status: 303,
      headers: { location: "https://attacker.example/steal" },
    }),
  );
  assert.equal(response.status, 502);
  assert.match(await response.text(), /edge-invalid-upstream-redirect/);
});

test("relative redirects and Set-Cookie remain browser same-origin", async () => {
  const response = await handlePublicAccountRequest(
    request("/auth/login"),
    env(),
    async () => new Response(null, {
      status: 303,
      headers: {
        location: "/login/",
        "set-cookie": "ordax_access=value; Path=/; HttpOnly; Secure; SameSite=Lax",
      },
    }),
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login/");
  assert.match(response.headers.get("set-cookie") ?? "", /ordax_access=value/);
});
