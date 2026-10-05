import assert from "node:assert/strict";
import test from "node:test";

import {
  trustedPublicClientAddress,
  validateRateLimitRpcResult,
} from "../infra/supabase/functions/ordax-public-account-gateway/public_auth_rate_limit.mjs";

function request(headers = {}) {
  return new Request("https://edge.example/functions/v1/ordax-public-account-gateway/auth/login", {
    method: "POST",
    headers,
  });
}

test("trusted public client address accepts only one bounded address assertion", () => {
  assert.deepEqual(
    trustedPublicClientAddress(request({ "x-ordax-client-address": "203.0.113.20" })),
    { ok: true, address: "203.0.113.20" },
  );
  assert.deepEqual(
    trustedPublicClientAddress(request({ "x-ordax-client-address": "2001:db8::20" })),
    { ok: true, address: "2001:db8::20" },
  );

  for (const value of ["", "not-an-ip", "203.0.113.20, 10.0.0.1"]) {
    assert.deepEqual(
      trustedPublicClientAddress(request({ "x-ordax-client-address": value })),
      { ok: false, code: "trusted-client-address-required" },
    );
  }
  assert.deepEqual(
    trustedPublicClientAddress(request({ "cf-connecting-ip": "203.0.113.20" })),
    { ok: false, code: "trusted-client-address-required" },
  );
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
