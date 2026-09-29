import assert from "node:assert/strict";
import test from "node:test";

import { ENTITLEMENTS_PORT_SCHEMA } from "../system/contracts/entitlements.mjs";
import { createWebAccountEntitlements } from "../system/adapters/web/entitlements.mjs";

function reply(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; },
  };
}

function decision(overrides = {}) {
  return {
    $schema: "prototype-ordax.account-entitlement/1",
    schema: ENTITLEMENTS_PORT_SCHEMA,
    subjectType: "account",
    subjectId: "user-1",
    key: "memory.cloud.enabled",
    decision: "allowed",
    value: true,
    authority: "server",
    expiresAt: null,
    ...overrides,
  };
}

test("account entitlement adapter uses only same-origin subject-bound preflight", async () => {
  const calls = [];
  const port = createWebAccountEntitlements({
    fetch: async (url, options) => {
      calls.push([url, options]);
      return reply(200, decision());
    },
  });
  assert.equal(port.schema, ENTITLEMENTS_PORT_SCHEMA);
  const result = await port.resolve({
    subjectType: "account",
    subjectId: "user-1",
    key: "memory.cloud.enabled",
  });
  assert.equal(result.decision, "allowed");
  assert.equal(result.authority, "server");
  assert.deepEqual(calls.map(([url]) => url), [
    "/account/entitlement?key=memory.cloud.enabled",
  ]);
  const options = calls[0][1];
  assert.equal(options.method, "GET");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert.equal("body" in options, false);
});

test("account entitlement adapter rejects subject or authority substitution", async () => {
  for (const malformed of [
    decision({ subjectId: "other-user" }),
    decision({ subjectType: "space" }),
    decision({ key: "other.entitlement" }),
    decision({ authority: "local-default" }),
  ]) {
    const port = createWebAccountEntitlements({
      fetch: async () => reply(200, malformed),
    });
    await assert.rejects(
      () => port.resolve({
        subjectType: "account",
        subjectId: "user-1",
        key: "memory.cloud.enabled",
      }),
      /authority|subject|Entitlement|entitlement/i,
    );
  }
});

test("account entitlement adapter rejects unsupported requests before fetch", async () => {
  let calls = 0;
  const port = createWebAccountEntitlements({
    fetch: async () => {
      calls += 1;
      return reply(500, {});
    },
  });
  for (const value of [
    { subjectType: "space", subjectId: "space-1", key: "memory.cloud.enabled" },
    { subjectType: "account", subjectId: "user-1", key: "ai.external.enabled" },
    { subjectType: "account", subjectId: "", key: "memory.cloud.enabled" },
  ]) {
    await assert.rejects(() => port.resolve(value), /Unsupported|bounds/);
  }
  assert.equal(calls, 0);
});

test("account entitlement adapter fails closed on gateway errors or malformed schema", async () => {
  const unavailable = createWebAccountEntitlements({
    fetch: async () => reply(401, { error: "authentication-required" }),
  });
  await assert.rejects(
    () => unavailable.resolve({
      subjectType: "account",
      subjectId: "user-1",
      key: "memory.cloud.enabled",
    }),
    /unavailable/,
  );

  const malformed = createWebAccountEntitlements({
    fetch: async () => reply(200, { ...decision(), $schema: "wrong" }),
  });
  await assert.rejects(
    () => malformed.resolve({
      subjectType: "account",
      subjectId: "user-1",
      key: "memory.cloud.enabled",
    }),
    /schema/,
  );
});
