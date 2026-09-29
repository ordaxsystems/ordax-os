import assert from "node:assert/strict";
import test from "node:test";

import { ENTITLEMENTS_PORT_SCHEMA } from "../system/contracts/entitlements.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import {
  ACCOUNT_MEMORY_AUTHORIZATION_SCHEMA,
  ACCOUNT_MEMORY_CLOUD_ENTITLEMENT,
  createAccountMemorySyncAuthorization,
} from "../system/services/sync/account-memory-authorization.mjs";

function identitySession(initial = { state: "signed-out", subjectId: null, displayName: null }) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    set(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
    },
    listenerCount: () => listeners.size,
  };
}

function entitlementPort(resolve) {
  return {
    schema: ENTITLEMENTS_PORT_SCHEMA,
    resolve,
  };
}

function decision(subjectId, overrides = {}) {
  return {
    subjectType: "account",
    subjectId,
    key: ACCOUNT_MEMORY_CLOUD_ENTITLEMENT,
    decision: "allowed",
    value: null,
    authority: "server",
    expiresAt: "2026-09-30T00:00:00Z",
    ...overrides,
  };
}

function descriptor(subjectId) {
  return {
    subjectId,
    dataClass: "memory",
    operation: "upsert",
  };
}

test("Memory cloud authorization stays denied until a server decision is resolved", async () => {
  const identity = identitySession({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  let calls = 0;
  const authorization = createAccountMemorySyncAuthorization({
    identitySession: identity,
    entitlementsPort: entitlementPort(async (request) => {
      calls += 1;
      assert.deepEqual(request, {
        subjectType: "account",
        subjectId: "account-a",
        key: ACCOUNT_MEMORY_CLOUD_ENTITLEMENT,
      });
      return decision("account-a");
    }),
    now: () => new Date("2026-09-29T23:00:00Z"),
  });

  assert.equal(authorization.schema, ACCOUNT_MEMORY_AUTHORIZATION_SCHEMA);
  assert.equal(authorization.authorize(descriptor("account-a")), false);
  const snapshot = await authorization.refresh();
  assert.equal(calls, 1);
  assert.equal(snapshot.state, "resolved");
  assert.equal(snapshot.decision, "allowed");
  assert.equal(snapshot.authority, "server");
  assert.equal(snapshot.productionPromoted, false);
  assert.equal(authorization.authorize(descriptor("account-a")), true);
  assert.equal(authorization.authorize(descriptor("account-b")), false);
});

test("client/local-default entitlement claims never authorize cloud Memory", async () => {
  const identity = identitySession({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  const authorization = createAccountMemorySyncAuthorization({
    identitySession: identity,
    entitlementsPort: entitlementPort(async () => decision("account-a", { authority: "local-default" })),
    now: () => new Date("2026-09-29T23:00:00Z"),
  });

  const snapshot = await authorization.refresh();
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.decision, "denied");
  assert.equal(snapshot.authority, null);
  assert.equal(authorization.authorize(descriptor("account-a")), false);
});

test("expired or denied server decisions fail closed", async () => {
  const identity = identitySession({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  let mode = "expired";
  const authorization = createAccountMemorySyncAuthorization({
    identitySession: identity,
    entitlementsPort: entitlementPort(async () => mode === "expired"
      ? decision("account-a", { expiresAt: "2026-09-29T22:59:59Z" })
      : decision("account-a", { decision: "denied", expiresAt: null })),
    now: () => new Date("2026-09-29T23:00:00Z"),
  });

  const expired = await authorization.refresh();
  assert.equal(expired.state, "denied");
  assert.equal(expired.decision, "denied");
  assert.equal(authorization.authorize(descriptor("account-a")), false);

  mode = "denied";
  const denied = await authorization.refresh();
  assert.equal(denied.state, "resolved");
  assert.equal(denied.decision, "denied");
  assert.equal(authorization.authorize(descriptor("account-a")), false);
});

test("identity changes invalidate an allowed decision immediately", async () => {
  const identity = identitySession({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  const authorization = createAccountMemorySyncAuthorization({
    identitySession: identity,
    entitlementsPort: entitlementPort(async ({ subjectId }) => decision(subjectId)),
    now: () => new Date("2026-09-29T23:00:00Z"),
  });

  await authorization.refresh();
  assert.equal(authorization.authorize(descriptor("account-a")), true);

  identity.set({ state: "signed-in", subjectId: "account-b", displayName: "B" });
  assert.equal(authorization.authorize(descriptor("account-a")), false);
  assert.equal(authorization.authorize(descriptor("account-b")), false);
  assert.equal(authorization.getSnapshot().state, "unprepared");
  assert.equal(authorization.getSnapshot().subjectId, "account-b");

  await authorization.refresh();
  assert.equal(authorization.authorize(descriptor("account-b")), true);

  identity.set({ state: "signed-out", subjectId: null, displayName: null });
  assert.equal(authorization.authorize(descriptor("account-b")), false);
  assert.equal(authorization.getSnapshot().state, "signed-out");
});

test("an in-flight decision for a previous account cannot re-authorize after account switch", async () => {
  const identity = identitySession({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const authorization = createAccountMemorySyncAuthorization({
    identitySession: identity,
    entitlementsPort: entitlementPort(async () => pending),
    now: () => new Date("2026-09-29T23:00:00Z"),
  });

  const refresh = authorization.refresh();
  identity.set({ state: "signed-in", subjectId: "account-b", displayName: "B" });
  release(decision("account-a"));
  await refresh;

  assert.equal(authorization.authorize(descriptor("account-a")), false);
  assert.equal(authorization.authorize(descriptor("account-b")), false);
  assert.equal(authorization.getSnapshot().subjectId, "account-b");
});

test("destroy removes identity subscription and leaves authorization closed", async () => {
  const identity = identitySession({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  const authorization = createAccountMemorySyncAuthorization({
    identitySession: identity,
    entitlementsPort: entitlementPort(async () => decision("account-a")),
    now: () => new Date("2026-09-29T23:00:00Z"),
  });
  await authorization.refresh();
  assert.equal(identity.listenerCount(), 1);

  authorization.destroy();
  assert.equal(identity.listenerCount(), 0);
  assert.equal(authorization.authorize(descriptor("account-a")), false);
  assert.throws(() => authorization.getSnapshot(), /disposed/);
});
