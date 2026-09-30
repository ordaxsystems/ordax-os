import assert from "node:assert/strict";
import test from "node:test";

import { ENTITLEMENTS_PORT_SCHEMA } from "../system/contracts/entitlements.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { createAccountMemoryEntitlementSession } from "../system/services/sync/account-memory-entitlement-session.mjs";

function identitySession(initial) {
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

function entitlements(resolve) {
  return Object.freeze({ schema: ENTITLEMENTS_PORT_SCHEMA, resolve });
}

function decision(subjectId, value = "allowed") {
  return Object.freeze({
    subjectType: "account",
    subjectId,
    key: "memory.cloud.enabled",
    decision: value,
    value: null,
    authority: "server",
    expiresAt: null,
  });
}

function descriptor(subjectId) {
  return Object.freeze({ subjectId, dataClass: "memory", operation: "upsert" });
}

test("signed-in identity automatically resolves server Memory entitlement", async () => {
  const identity = identitySession({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  const calls = [];
  const session = createAccountMemoryEntitlementSession({
    identitySession: identity,
    entitlementsPort: entitlements(async (request) => {
      calls.push(request);
      return decision(request.subjectId);
    }),
  });

  const snapshot = await session.settled();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].subjectId, "account-a");
  assert.equal(snapshot.state, "resolved");
  assert.equal(snapshot.authority, "server");
  assert.equal(session.authorize(descriptor("account-a")), true);
});

test("signed-out identity remains fail-closed without querying entitlement provider", async () => {
  const identity = identitySession({ state: "signed-out", subjectId: null, displayName: null });
  let calls = 0;
  const session = createAccountMemoryEntitlementSession({
    identitySession: identity,
    entitlementsPort: entitlements(async () => {
      calls += 1;
      return decision("unexpected");
    }),
  });

  assert.equal((await session.settled()).state, "signed-out");
  assert.equal(calls, 0);
  assert.equal(session.authorize(descriptor("account-a")), false);
});

test("account switch invalidates old authority and resolves only the new subject", async () => {
  const identity = identitySession({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  const calls = [];
  const session = createAccountMemoryEntitlementSession({
    identitySession: identity,
    entitlementsPort: entitlements(async (request) => {
      calls.push(request.subjectId);
      return decision(request.subjectId);
    }),
  });

  await session.settled();
  assert.equal(session.authorize(descriptor("account-a")), true);

  identity.set({ state: "signed-in", subjectId: "account-b", displayName: "B" });
  assert.equal(session.authorize(descriptor("account-a")), false);
  await session.settled();
  assert.equal(session.authorize(descriptor("account-b")), true);
  assert.deepEqual(calls, ["account-a", "account-b"]);
});

test("stale entitlement response cannot authorize after an account switch", async () => {
  const identity = identitySession({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  let releaseA;
  const blockedA = new Promise((resolve) => { releaseA = resolve; });
  const session = createAccountMemoryEntitlementSession({
    identitySession: identity,
    entitlementsPort: entitlements(async (request) => {
      if (request.subjectId === "account-a") {
        await blockedA;
        return decision("account-a");
      }
      return decision("account-b");
    }),
  });

  identity.set({ state: "signed-in", subjectId: "account-b", displayName: "B" });
  releaseA();
  await session.settled();

  assert.equal(session.authorize(descriptor("account-a")), false);
  assert.equal(session.authorize(descriptor("account-b")), true);
  assert.equal(session.getSnapshot().subjectId, "account-b");
});

test("provider failure is represented as unavailable and never grants Memory sync", async () => {
  const identity = identitySession({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  const session = createAccountMemoryEntitlementSession({
    identitySession: identity,
    entitlementsPort: entitlements(async () => {
      throw new Error("provider unavailable");
    }),
  });

  const snapshot = await session.settled();
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.decision, "denied");
  assert.equal(session.authorize(descriptor("account-a")), false);
});

test("destroy unsubscribes identity and keeps authorization fail-closed", async () => {
  const identity = identitySession({ state: "signed-in", subjectId: "account-a", displayName: "A" });
  const session = createAccountMemoryEntitlementSession({
    identitySession: identity,
    entitlementsPort: entitlements(async (request) => decision(request.subjectId)),
  });
  await session.settled();
  assert.equal(identity.listenerCount(), 2);

  session.destroy();
  assert.equal(identity.listenerCount(), 0);
  assert.equal(session.authorize(descriptor("account-a")), false);
  await assert.rejects(session.settled(), /disposed/);
});
