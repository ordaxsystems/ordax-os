import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_CLOUD_ENTITLEMENT_KEY,
  MEMORY_ENTITLEMENT_READ_ENDPOINT,
  createWebMemoryEntitlements,
} from "../system/adapters/web/entitlements.mjs";

function response(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
  };
}

function decision(overrides = {}) {
  return {
    subjectType: "account",
    subjectId: "account-a",
    key: MEMORY_CLOUD_ENTITLEMENT_KEY,
    decision: "allowed",
    value: null,
    authority: "server",
    expiresAt: null,
    ...overrides,
  };
}

test("Memory entitlement adapter uses only the fixed same-origin GET boundary", async () => {
  const calls = [];
  const adapter = createWebMemoryEntitlements({
    async fetch(url, options) {
      calls.push([url, options]);
      return response(200, decision());
    },
  });

  const resolved = await adapter.resolve({
    subjectType: "account",
    subjectId: "account-a",
    key: MEMORY_CLOUD_ENTITLEMENT_KEY,
  });

  assert.equal(resolved.authority, "server");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], MEMORY_ENTITLEMENT_READ_ENDPOINT);
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][1].credentials, "same-origin");
  assert.equal(calls[0][1].cache, "no-store");
  assert.equal(calls[0][1].redirect, "error");
  assert.deepEqual(calls[0][1].headers, { Accept: "application/json" });
  assert.equal("body" in calls[0][1], false);
});

test("client cannot ask the Memory entitlement adapter to resolve another entitlement", async () => {
  let called = false;
  const adapter = createWebMemoryEntitlements({
    async fetch() {
      called = true;
      return response(200, decision());
    },
  });

  await assert.rejects(
    adapter.resolve({ subjectType: "account", subjectId: "account-a", key: "spaces.shared.create" }),
    /Unsupported Memory entitlement key/,
  );
  assert.equal(called, false);
});

test("server decision must match the active account subject exactly", async () => {
  const adapter = createWebMemoryEntitlements({
    async fetch() {
      return response(200, decision({ subjectId: "account-b" }));
    },
  });

  await assert.rejects(
    adapter.resolve({
      subjectType: "account",
      subjectId: "account-a",
      key: MEMORY_CLOUD_ENTITLEMENT_KEY,
    }),
    /escaped its server authority boundary/,
  );
});

test("local-default or client-like authority cannot unlock cloud Memory", async () => {
  const adapter = createWebMemoryEntitlements({
    async fetch() {
      return response(200, decision({ authority: "local-default" }));
    },
  });

  await assert.rejects(
    adapter.resolve({
      subjectType: "account",
      subjectId: "account-a",
      key: MEMORY_CLOUD_ENTITLEMENT_KEY,
    }),
    /escaped its server authority boundary/,
  );
});

test("HTTP failure is fail-closed and never synthesizes a local entitlement", async () => {
  const adapter = createWebMemoryEntitlements({
    async fetch() {
      return response(503, { error: "unavailable" });
    },
  });

  await assert.rejects(
    adapter.resolve({
      subjectType: "account",
      subjectId: "account-a",
      key: MEMORY_CLOUD_ENTITLEMENT_KEY,
    }),
    /Memory entitlement read failed: 503/,
  );
});
