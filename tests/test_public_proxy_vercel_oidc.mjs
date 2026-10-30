import assert from "node:assert/strict";
import test from "node:test";

import {
  VERCEL_PUBLIC_PROXY_IDENTITY,
  verifyPublicProxyIdentity,
} from "../infra/supabase/functions/ordax-public-account-gateway/vercel_oidc.mjs";

const TOKEN = `${"a".repeat(24)}.${"b".repeat(32)}.${"c".repeat(32)}`;
const ISSUER = "https://oidc.vercel.com/ordaxsystems";
const AUDIENCE = "https://vercel.com/ordaxsystems";
const PUBLIC_SUBJECT = "owner:ordaxsystems:project:ordax-os-public:environment:production";
const WEB_SUBJECT = "owner:ordaxsystems:project:ordax-web:environment:production";

function payload(subject = PUBLIC_SUBJECT) {
  return Object.freeze({ iss: ISSUER, aud: AUDIENCE, sub: subject });
}

function request(headers = {}) {
  return new Request("https://edge.example/functions/v1/ordax-public-account-gateway/auth/session", {
    headers,
  });
}

test("canonical public proxy identities are exact production projects under one team", () => {
  assert.deepEqual(VERCEL_PUBLIC_PROXY_IDENTITY, {
    issuer: ISSUER,
    audience: AUDIENCE,
    subjects: [PUBLIC_SUBJECT, WEB_SUBJECT],
    jwks: "https://oidc.vercel.com/.well-known/jwks",
    environment: "production",
    projects: ["ordax-os-public", "ordax-web"],
    team: "ordaxsystems",
  });
  for (const subject of VERCEL_PUBLIC_PROXY_IDENTITY.subjects) {
    assert.doesNotMatch(subject, /environment:preview/);
  }
});

test("both canonical production projects are accepted after verifier success", async () => {
  for (const subject of [PUBLIC_SUBJECT, WEB_SUBJECT]) {
    const seen = [];
    const result = await verifyPublicProxyIdentity(
      request({ authorization: `Bearer ${TOKEN}`, "x-ordax-public-site": "1" }),
      {
        verifyToken: async (token) => {
          seen.push(token);
          return { payload: payload(subject) };
        },
      },
    );
    assert.deepEqual(seen, [TOKEN]);
    assert.deepEqual(result, {
      ok: true,
      source: "vercel-production-oidc",
      subject,
    });
  }
});

test("missing marker, malformed token and verification failure all fail closed", async () => {
  const expected = payload();
  const missingMarker = await verifyPublicProxyIdentity(
    request({ authorization: `Bearer ${TOKEN}` }),
    { verifyToken: async () => ({ payload: expected }) },
  );
  assert.deepEqual(missingMarker, { ok: false, code: "public-proxy-authentication-required" });

  const malformed = await verifyPublicProxyIdentity(
    request({ authorization: "Bearer browser-token", "x-ordax-public-site": "1" }),
    { verifyToken: async () => ({ payload: expected }) },
  );
  assert.deepEqual(malformed, { ok: false, code: "public-proxy-authentication-required" });

  const rejected = await verifyPublicProxyIdentity(
    request({ authorization: `Bearer ${TOKEN}`, "x-ordax-public-site": "1" }),
    { verifyToken: async () => { throw new Error("invalid-signature"); } },
  );
  assert.deepEqual(rejected, { ok: false, code: "public-proxy-authentication-required" });
});

test("preview, unknown projects, wrong team and wrong audience cannot impersonate production", async () => {
  const expected = payload();
  const variants = [
    { ...expected, sub: "owner:ordaxsystems:project:ordax-os-public:environment:preview" },
    { ...expected, sub: "owner:ordaxsystems:project:ordax-web:environment:preview" },
    { ...expected, sub: "owner:ordaxsystems:project:other:environment:production" },
    { ...expected, iss: "https://oidc.vercel.com/other-team" },
    { ...expected, aud: "https://vercel.com/other-team" },
    { ...expected, iss: "https://oidc.vercel.com/jogo-brasils-projects" },
    { ...expected, aud: "https://vercel.com/jogo-brasils-projects" },
    { ...expected, sub: "owner:jogo-brasils-projects:project:ordax-os-public:environment:production" },
    { ...expected, sub: "owner:jogo-brasils-projects:project:ordax-web:environment:production" },
  ];

  for (const candidate of variants) {
    const result = await verifyPublicProxyIdentity(
      request({ authorization: `Bearer ${TOKEN}`, "x-ordax-public-site": "1" }),
      { verifyToken: async () => ({ payload: candidate }) },
    );
    assert.deepEqual(result, { ok: false, code: "public-proxy-authentication-required" });
  }
});
