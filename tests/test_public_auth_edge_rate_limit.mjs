import assert from "node:assert/strict";
import test from "node:test";

import {
  sha256Hex,
  trustedRateLimitAddress,
  validateRateLimitRpcResult,
} from "../infra/supabase/functions/ordax-account-gateway/public_auth_rate_limit.mjs";

const TEST_SECRET = "test_proxy_secret_0123456789_ABCDEFGHIJKLMN";
const TEST_SECRET_SHA256 = await sha256Hex(TEST_SECRET);

function request(headers = {}) {
  return new Request("https://edge.example/functions/v1/ordax-account-gateway/auth/login", {
    method: "POST",
    headers,
  });
}

test("native/direct traffic trusts only the Supabase edge client address", async () => {
  const result = await trustedRateLimitAddress(request({
    "cf-connecting-ip": "203.0.113.20",
    "x-forwarded-for": "198.51.100.99",
    "x-real-ip": "198.51.100.98",
  }), { publicProxySecretSha256: TEST_SECRET_SHA256 });

  assert.deepEqual(result, {
    ok: true,
    address: "203.0.113.20",
    source: "supabase-edge",
  });
});

test("marked public traffic requires the authenticated proxy secret before trusting client address", async () => {
  const valid = await trustedRateLimitAddress(request({
    "x-ordax-public-site": "1",
    "x-ordax-public-proxy-secret": TEST_SECRET,
    "x-ordax-client-address": "2001:db8::20",
    "cf-connecting-ip": "192.0.2.40",
  }), { publicProxySecretSha256: TEST_SECRET_SHA256 });
  assert.deepEqual(valid, {
    ok: true,
    address: "2001:db8::20",
    source: "authenticated-public-proxy",
  });

  for (const secret of ["", "wrong_secret_0123456789_ABCDEFGHIJKLMN"] ) {
    const invalid = await trustedRateLimitAddress(request({
      "x-ordax-public-site": "1",
      "x-ordax-public-proxy-secret": secret,
      "x-ordax-client-address": "203.0.113.30",
      "cf-connecting-ip": "192.0.2.40",
    }), { publicProxySecretSha256: TEST_SECRET_SHA256 });
    assert.deepEqual(invalid, { ok: false, code: "public-proxy-authentication-required" });
  }
});

test("missing or ambiguous client address fails closed", async () => {
  const missing = await trustedRateLimitAddress(request({}), {
    publicProxySecretSha256: TEST_SECRET_SHA256,
  });
  assert.deepEqual(missing, { ok: false, code: "trusted-client-address-required" });

  const chained = await trustedRateLimitAddress(request({
    "x-ordax-public-site": "1",
    "x-ordax-public-proxy-secret": TEST_SECRET,
    "x-ordax-client-address": "203.0.113.30, 10.0.0.1",
  }), { publicProxySecretSha256: TEST_SECRET_SHA256 });
  assert.deepEqual(chained, { ok: false, code: "trusted-client-address-required" });
});

test("rate-limit RPC result is shape-checked and bucket-bound", () => {
  const allowed = [{
    schema: "prototype-ordax.public-auth-rate-limit/1",
    bucket: "credentials",
    decision: "allowed",
    limit_count: 10,
    remaining: 9,
    retry_after_seconds: null,
    reset_at: "2026-10-04T23:59:00.000Z",
  }];
  assert.deepEqual(validateRateLimitRpcResult(allowed, "credentials"), allowed[0]);
  assert.equal(validateRateLimitRpcResult(allowed, "recovery-request"), null);

  const limited = [{
    ...allowed[0],
    decision: "rate_limited",
    remaining: 0,
    retry_after_seconds: 42,
  }];
  assert.deepEqual(validateRateLimitRpcResult(limited, "credentials"), limited[0]);
  assert.equal(validateRateLimitRpcResult([{ ...limited[0], retry_after_seconds: 0 }], "credentials"), null);
  assert.equal(validateRateLimitRpcResult([{ ...allowed[0], remaining: 11 }], "credentials"), null);
});
