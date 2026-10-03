import assert from "node:assert/strict";
import test from "node:test";

import {
  SERVICE_QUOTA_POLICY_SCHEMA,
  SERVICE_QUOTA_USAGE_SCHEMA,
} from "../system/contracts/service-quota.mjs";
import { evaluateServiceQuota } from "../system/services/entitlements/quota.mjs";

function policy(overrides = {}) {
  return {
    schema: SERVICE_QUOTA_POLICY_SCHEMA,
    subjectType: "account",
    subjectId: "account-a",
    key: "memory.cloud.bytes",
    unit: "bytes",
    limit: 1_000,
    authority: "server",
    expiresAt: null,
    ...overrides,
  };
}

function usage(overrides = {}) {
  return {
    schema: SERVICE_QUOTA_USAGE_SCHEMA,
    subjectType: "account",
    subjectId: "account-a",
    key: "memory.cloud.bytes",
    unit: "bytes",
    used: 400,
    reserved: 100,
    authority: "server",
    measuredAt: "2026-10-03T12:00:00Z",
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    subjectType: "account",
    subjectId: "account-a",
    key: "memory.cloud.bytes",
    unit: "bytes",
    requested: 200,
    ...overrides,
  };
}

test("quota allows bounded growth below the server limit without creating action authority", () => {
  const decision = evaluateServiceQuota({ policy: policy(), usage: usage(), request: request() });
  assert.equal(decision.state, "within-quota");
  assert.equal(decision.canAllocate, true);
  assert.equal(decision.remaining, 500);
  assert.equal(decision.actionAuthority, "none");
});

test("quota denies only new growth when the request would exceed the limit", () => {
  const decision = evaluateServiceQuota({
    policy: policy(),
    usage: usage(),
    request: request({ requested: 600 }),
  });
  assert.equal(decision.state, "quota-exceeded");
  assert.equal(decision.canAllocate, false);
  assert.equal(decision.retainExisting, true);
});

test("downgrade overage retains existing data and blocks additional allocation", () => {
  const decision = evaluateServiceQuota({
    policy: policy({ limit: 300 }),
    usage: usage({ used: 700, reserved: 0 }),
    request: request({ requested: 1 }),
  });
  assert.equal(decision.state, "over-quota-retained");
  assert.equal(decision.canAllocate, false);
  assert.equal(decision.retainExisting, true);
  assert.equal(decision.remaining, 0);
});

test("remote quota usage and policy cannot be client-claimed", () => {
  assert.throws(
    () => evaluateServiceQuota({
      policy: policy({ authority: "local-default" }),
      usage: usage(),
      request: request(),
    }),
    /server-authoritative policy/,
  );
  assert.throws(
    () => evaluateServiceQuota({
      policy: policy(),
      usage: usage({ authority: "client" }),
      request: request(),
    }),
    /server-authoritative/,
  );
});

test("quota refuses mismatched account, key or unit boundaries", () => {
  assert.throws(
    () => evaluateServiceQuota({
      policy: policy(),
      usage: usage({ subjectId: "account-b" }),
      request: request(),
    }),
    /same subject\/key\/unit/,
  );
});

test("unmetered policy is explicit and still does not grant action authority", () => {
  const decision = evaluateServiceQuota({
    policy: policy({ limit: null }),
    usage: usage({ used: 50_000, reserved: 0 }),
    request: request({ requested: 50_000 }),
  });
  assert.equal(decision.state, "unmetered");
  assert.equal(decision.canAllocate, true);
  assert.equal(decision.remaining, null);
  assert.equal(decision.actionAuthority, "none");
});
