import test from "node:test";
import assert from "node:assert/strict";

import {
  IDENTITY_SESSION_SCHEMA,
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../system/contracts/identity-session.mjs";
import { createWebIdentitySession } from "../system/adapters/web/identity.mjs";

test("identity session validates unavailable, signed-out and signed-in states", () => {
  assert.deepEqual(validateIdentitySessionSnapshot({ state: "unavailable" }), {
    state: "unavailable",
    subjectId: null,
    displayName: null,
  });
  assert.deepEqual(validateIdentitySessionSnapshot({ state: "signed-out" }), {
    state: "signed-out",
    subjectId: null,
    displayName: null,
  });
  assert.deepEqual(
    validateIdentitySessionSnapshot({
      state: "signed-in",
      subjectId: "user-1",
      displayName: "Pessoa",
    }),
    { state: "signed-in", subjectId: "user-1", displayName: "Pessoa" },
  );
});

test("signed-in state fails closed without public identity fields", () => {
  assert.throws(
    () => validateIdentitySessionSnapshot({ state: "signed-in", displayName: "Pessoa" }),
    TypeError,
  );
  assert.throws(
    () => validateIdentitySessionSnapshot({ state: "signed-in", subjectId: "user-1" }),
    TypeError,
  );
});

test("web identity adapter reports signed-out when the real gateway is configured", async () => {
  const windowRef = {
    fetch: async () => ({
      ok: true,
      json: async () => ({
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: false,
        provider: "supabase",
        status: "anonymous",
      }),
    }),
  };
  const port = createWebIdentitySession(windowRef);
  assert.equal(port.schema, IDENTITY_SESSION_SCHEMA);
  assertIdentitySessionPort(port);
  await port.refresh();
  assert.deepEqual(port.getSnapshot(), {
    state: "signed-out",
    subjectId: null,
    displayName: null,
  });
  port.dispose();
});

test("unavailable session identifies host-not-configured separately from transient transport", async () => {
  const configured = createWebIdentitySession({ fetch: async () => ({
    ok: true, status: 200, json: async () => ({
      $schema: "prototype-ordax.public-identity-session/1",
      authenticated: false, status: "anonymous", provider: "unconfigured",
    }),
  }) });
  assert.equal(configured.getUnavailableReason(), "pending");
  await configured.refresh();
  assert.equal(configured.getSnapshot().state, "unavailable");
  assert.equal(configured.getUnavailableReason(), "unconfigured");
  configured.dispose();

  const timeout = createWebIdentitySession({ fetch: async () => { throw new Error("timed out"); } });
  await timeout.refresh();
  assert.equal(timeout.getSnapshot().state, "unavailable");
  assert.equal(timeout.getUnavailableReason(), "gateway-unreachable");
  timeout.dispose();

  const locked = createWebIdentitySession({ fetch: async () => ({ ok: false, status: 423 }) });
  await locked.refresh();
  assert.equal(locked.getUnavailableReason(), "locked");
  locked.dispose();

  const invalid = createWebIdentitySession({ fetch: async () => ({
    ok: true, status: 200, json: async () => ({ $schema: "wrong" }),
  }) });
  await invalid.refresh();
  assert.equal(invalid.getUnavailableReason(), "invalid-response");
  invalid.dispose();

  const available = createWebIdentitySession({ fetch: async () => ({
    ok: true, status: 200, json: async () => ({
      $schema: "prototype-ordax.public-identity-session/1",
      authenticated: false, status: "anonymous", provider: "supabase",
    }),
  }) });
  await available.refresh();
  assert.equal(available.getUnavailableReason(), null);
  assert.equal(available.getSnapshot().state, "signed-out");
  available.dispose();
});

test("web identity adapter reports a validated signed-in account", async () => {
  const windowRef = {
    fetch: async () => ({
      ok: true,
      json: async () => ({
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: true,
        provider: "supabase",
        status: "authenticated",
        subject: "user-123",
        email: "pessoa@example.com",
        displayName: "  Washington Silva  ",
      }),
    }),
  };
  const port = createWebIdentitySession(windowRef);
  await port.refresh();
  assert.deepEqual(port.getSnapshot(), {
    state: "signed-in",
    subjectId: "user-123",
    displayName: "Washington Silva",
    email: "pessoa@example.com",
  });
  port.dispose();
});

test("identity adapter ignores unsafe account display names and keeps its email fallback", async () => {
  const port = createWebIdentitySession({
    fetch: async () => ({
      ok: true,
      json: async () => ({
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: true,
        provider: "supabase",
        status: "authenticated",
        subject: "user-123",
        email: "pessoa@example.com",
        displayName: "bad\nname",
      }),
    }),
  });
  await port.refresh();
  assert.equal(port.getSnapshot().displayName, "pessoa");
  port.dispose();
});

test("identity gateway failure remains explicitly unavailable", async () => {
  const port = createWebIdentitySession({
    fetch: async () => {
      throw new Error("offline");
    },
  });
  await port.refresh();
  assert.equal(port.getSnapshot().state, "unavailable");
  port.dispose();
});

function controlledIdentityGateway() {
  const requests = [];
  const windowRef = {
    fetch: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
  };
  const reply = ({ subject = null } = {}) => ({
    ok: true,
    json: async () => ({
      $schema: "prototype-ordax.public-identity-session/1",
      provider: "supabase",
      authenticated: subject !== null,
      status: subject === null ? "anonymous" : "authenticated",
      ...(subject === null ? {} : { subject, email: "pessoa@example.com" }),
    }),
  });
  return { requests, windowRef, reply };
}

test("stale session responses never overwrite the latest completed refresh", async () => {
  const gateway = controlledIdentityGateway();
  const port = createWebIdentitySession(gateway.windowRef);
  const states = [];
  port.subscribe((snapshot) => states.push(snapshot.state));
  const older = port.refresh();
  const latest = port.refresh();
  assert.equal(gateway.requests.length, 2);

  gateway.requests[1].resolve(gateway.reply({ subject: "user-current" }));
  await latest;
  assert.equal(port.getSnapshot().subjectId, "user-current");
  gateway.requests[0].resolve(gateway.reply({ subject: "user-stale" }));
  await older;
  assert.equal(port.getSnapshot().subjectId, "user-current");
  assert.deepEqual(states, ["unavailable", "signed-in"]);

  // A late network failure must not overwrite the signed-out state either.
  const staleFailure = port.refresh();
  const loggedOut = port.refresh();
  gateway.requests[3].resolve(gateway.reply());
  await loggedOut;
  gateway.requests[2].reject(new Error("old transport failure"));
  await staleFailure;
  assert.deepEqual(port.getSnapshot(), {
    state: "signed-out", subjectId: null, displayName: null,
  });
  assert.deepEqual(states, ["unavailable", "signed-in", "signed-out"]);
  port.dispose();
});

test("pending identity refresh cannot resurrect a disposed session", async () => {
  const gateway = controlledIdentityGateway();
  const port = createWebIdentitySession(gateway.windowRef);
  const observations = [];
  port.subscribe((snapshot) => observations.push(snapshot.state));
  const pending = port.refresh();
  port.dispose();
  gateway.requests[0].resolve(gateway.reply({ subject: "user-after-disposal" }));
  await pending;
  assert.equal(port.getSnapshot().state, "unavailable");
  assert.deepEqual(observations, ["unavailable"]);
});

test("unchanged verified identity retains the same snapshot for external-store subscriptions", async () => {
  const gateway = controlledIdentityGateway();
  const port = createWebIdentitySession(gateway.windowRef);
  try {
    const initial = port.refresh();
    gateway.requests[0].resolve(gateway.reply({ subject: "same-account" }));
    await initial;
    const snapshot = port.getSnapshot();
    const observed = [];
    const release = port.subscribe(value => observed.push(value));
    const refreshed = port.refresh();
    gateway.requests[1].resolve(gateway.reply({ subject: "same-account" }));
    await refreshed;
    assert.equal(port.getSnapshot(), snapshot);
    assert.deepEqual(observed, [snapshot]);
    release();
  } finally { port.dispose(); }
});

test("cancellation releases a pending identity read and preserves last-known identity", async () => {
  const gateway = controlledIdentityGateway();
  const port = createWebIdentitySession(gateway.windowRef);
  try {
    const initial = port.refresh();
    gateway.requests[0].resolve(gateway.reply({ subject: "known-account" }));
    await initial;
    const known = port.getSnapshot();
    const pending = port.refresh();
    port.cancelRefresh();
    await pending;
    assert.equal(port.getSnapshot(), known);
    gateway.requests[1].resolve(gateway.reply({ subject: "stale-account" }));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(port.getSnapshot(), known);
  } finally { port.dispose(); }
});

test("disposed identity does not retain new subscribers or start network work", async () => {
  const gateway = controlledIdentityGateway();
  const port = createWebIdentitySession(gateway.windowRef);
  port.dispose();
  port.subscribe(() => { throw Error("Disposed identity subscriber called"); });
  await port.refresh();
  assert.equal(gateway.requests.length, 0);
});
