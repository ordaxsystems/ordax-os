import assert from "node:assert/strict";
import test from "node:test";

import {
  VERCEL_PUBLIC_PROXY_IDENTITY,
  verifyPublicProxyIdentity,
} from "../infra/supabase/functions/ordax-public-account-gateway/vercel_oidc.mjs";

const TOKEN = `${"a".repeat(24)}.${"b".repeat(32)}.${"c".repeat(32)}`;
const EXPECTED_PAYLOAD = Object.freeze({
  iss: "https://oidc.vercel.com/ordaxsystems",
  aud: "https://vercel.com/ordaxsystems",
  sub: "owner:ordaxsystems:project:ordax-os-public:environment:production",
});

function request(headers = {}) {
  return new Request("https://edge.example/functions/v1/ordax-public-account-gateway/auth/session", {
    headers,
  });
}

test("canonical public proxy identity is production-only and fully scoped", () => {
  assert.deepEqual(VERCEL_PUBLIC_PROXY_IDENTITY, {
    issuer: EXPECTED_PAYLOAD.iss,
    audience: EXPECTED_PAYLOAD.aud,
    subject: EXPECTED_PAYLOAD.sub,
    jwks: "https://oidc.vercel.com/.well-known/jwks",
    environment: "production",
    project: "ordax-os-public",
    team: "ordaxsystems",
  });
  assert.doesNotMatch(VERCEL_PUBLIC_PROXY_IDENTITY.subject, /environment:preview/);
});

test("production OIDC identity is accepted only after verifier success and exact claims", async () => {
  const seen = [];
  const valid = await verifyPublicProxyIdentity(
    request({
      authorization: `Bearer ${TOKEN}`,
      "x-ordax-public-site": "1",
    }),
    {
      verifyToken: async (token) => {
        seen.push(token);
        return { payload: EXPECTED_PAYLOAD };
      },
    },
  );
  assert.deepEqual(seen, [TOKEN]);
  assert.deepEqual(valid, {
    ok: true,
    source: "vercel-production-oidc",
    subject: EXPECTED_PAYLOAD.sub,
  });
});

test("missing marker, malformed token and verification failure all fail closed", async () => {
  const missingMarker = await verifyPublicProxyIdentity(
    request({ authorization: `Bearer ${TOKEN}` }),
    { verifyToken: async () => ({ payload: EXPECTED_PAYLOAD }) },
  );
  assert.deepEqual(missingMarker, { ok: false, code: "public-proxy-authentication-required" });

  const malformed = await verifyPublicProxyIdentity(
    request({ authorization: "Bearer browser-token", "x-ordax-public-site": "1" }),
    { verifyToken: async () => ({ payload: EXPECTED_PAYLOAD }) },
  );
  assert.deepEqual(malformed, { ok: false, code: "public-proxy-authentication-required" });

  const rejected = await verifyPublicProxyIdentity(
    request({ authorization: `Bearer ${TOKEN}`, "x-ordax-public-site": "1" }),
    { verifyToken: async () => { throw new Error("invalid-signature"); } },
  );
  assert.deepEqual(rejected, { ok: false, code: "public-proxy-authentication-required" });
});

test("preview, wrong project, wrong team and wrong audience cannot impersonate production", async () => {
  const variants = [
    { ...EXPECTED_PAYLOAD, sub: "owner:ordaxsystems:project:ordax-os-public:environment:preview" },
    { ...EXPECTED_PAYLOAD, sub: "owner:ordaxsystems:project:other:environment:production" },
    { ...EXPECTED_PAYLOAD, iss: "https://oidc.vercel.com/other-team" },
    { ...EXPECTED_PAYLOAD, aud: "https://vercel.com/other-team" },
    { ...EXPECTED_PAYLOAD, iss: "https://oidc.vercel.com/jogo-brasils-projects" },
    { ...EXPECTED_PAYLOAD, aud: "https://vercel.com/jogo-brasils-projects" },
    { ...EXPECTED_PAYLOAD, sub: "owner:jogo-brasils-projects:project:ordax-os-public:environment:production" },
  ];

  for (const payload of variants) {
    const result = await verifyPublicProxyIdentity(
      request({ authorization: `Bearer ${TOKEN}`, "x-ordax-public-site": "1" }),
      { verifyToken: async () => ({ payload }) },
    );
    assert.deepEqual(result, { ok: false, code: "public-proxy-authentication-required" });
  }
});
