import test from "node:test";
import assert from "node:assert/strict";

import {
  IDENTITY_ACTIONS_SCHEMA,
  assertIdentityActionsPort,
  isIdentityActionSupported,
  validateIdentityActionsSnapshot,
} from "../system/contracts/identity-actions.mjs";
import { createWebIdentityActions } from "../system/adapters/web/identity-actions.mjs";
import { createWebIdentitySession } from "../system/adapters/web/identity.mjs";
import { WEB_JSON_READ_TIMEOUT_MS } from "../system/adapters/web/json-read.mjs";

test("identity action contract normalizes supported command families", () => {
  const snapshot = validateIdentityActionsSnapshot({ supportedActions: ["sign-in", "register", "sign-out"] });
  assert.deepEqual(snapshot.supportedActions, ["sign-in", "register", "sign-out"]);
  assert.equal(isIdentityActionSupported(snapshot, "sign-in"), true);
  assert.equal(isIdentityActionSupported(snapshot, "register"), true);
  assert.equal(isIdentityActionSupported(snapshot, "sign-out"), true);
});

test("identity action contract rejects unknown and duplicate commands", () => {
  assert.throws(
    () => validateIdentityActionsSnapshot({ supportedActions: ["sign-in", "sign-in"] }),
    TypeError,
  );
  assert.throws(
    () => validateIdentityActionsSnapshot({ supportedActions: ["reset-account"] }),
    TypeError,
  );
});

test("identity action port is schema checked", () => {
  const port = {
    schema: IDENTITY_ACTIONS_SCHEMA,
    getSnapshot: () => ({ supportedActions: [] }),
    subscribe: () => () => {},
    execute: async () => {},
  };
  assert.equal(assertIdentityActionsPort(port), port);
});

test("Web identity actions follow the real gateway session state", async () => {
  const assigned = [];
  const windowRef = {
    location: { assign: (value) => assigned.push(value) },
    fetch: async (path) => ({
      ok: true,
      status: path === "/auth/logout" ? 303 : 200,
      json: async () => ({
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: false,
        provider: "supabase",
        status: "anonymous",
      }),
    }),
  };
  const session = createWebIdentitySession(windowRef);
  await session.refresh();
  const actions = createWebIdentityActions(windowRef, session);
  assert.deepEqual(actions.getSnapshot().supportedActions, ["sign-in"]);

  await actions.execute("sign-in");
  await assert.rejects(() => actions.execute("register"));
  assert.deepEqual(assigned, ["/login/"]);

  actions.dispose();
  session.dispose();
});

test("Web logout completes only after the canonical session confirms anonymous status", async () => {
  const authenticated = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: true, status: "authenticated", provider: "supabase",
    subject: "account-a", email: "person@example.invalid",
  };
  const anonymous = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: false, status: "anonymous", provider: "supabase",
  };
  for (const status of [303, 0, 200]) {
    let current = authenticated;
    const requests = [];
    const windowRef = {
      fetch: async (path, options) => {
        requests.push({ path, options });
        if (path === "/auth/session") return { ok: true, status: 200, json: async () => current };
        if (path === "/auth/logout") {
          current = anonymous;
          return { ok: status === 200, status };
        }
        throw new Error("Unexpected identity endpoint");
      },
    };
    const identity = createWebIdentitySession(windowRef);
    await identity.refresh();
    const actions = createWebIdentityActions(windowRef, identity);
    try {
      assert.deepEqual(actions.getSnapshot().supportedActions, ["sign-out"]);
      await actions.execute("sign-out");
      assert.equal(identity.getSnapshot().state, "signed-out");
      assert.deepEqual(actions.getSnapshot().supportedActions, ["sign-in"]);
      assert.deepEqual(requests.map(request => request.path), [
        "/auth/session", "/auth/logout", "/auth/session",
      ]);
      assert.equal(requests[1].options.method, "POST");
      assert.equal(requests[1].options.credentials, "same-origin");
      assert.equal(requests[1].options.redirect, "manual");
      assert.equal(requests[2].options.credentials, "same-origin");
      assert.equal(requests[2].options.cache, "no-store");
    } finally {
      actions.dispose();
      identity.dispose();
    }
  }
});

test("concurrent Web logout clicks share one POST and one verified session refresh", async () => {
  const authenticated = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: true, status: "authenticated", provider: "supabase",
    subject: "account-a", email: "person@example.invalid",
  };
  const anonymous = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: false, status: "anonymous", provider: "supabase",
  };
  let current = authenticated;
  let releaseLogout, releaseVerification;
  const requests = [];
  let verificationStarted = false;
  const windowRef = {
    fetch(path, options) {
      requests.push({ path, options });
      if (path === "/auth/logout") {
        return new Promise(resolve => { releaseLogout = resolve; });
      }
      if (path === "/auth/session") {
        if (!verificationStarted) {
          verificationStarted = true;
          return Promise.resolve({ ok: true, status: 200, json: async () => current });
        }
        return new Promise(resolve => { releaseVerification = resolve; });
      }
      throw Error("Unexpected Web identity endpoint");
    },
  };
  const identity = createWebIdentitySession(windowRef);
  await identity.refresh();
  const actions = createWebIdentityActions(windowRef, identity);
  try {
    const first = actions.execute("sign-out");
    const duplicate = actions.execute("sign-out");
    assert.equal(requests.filter(x => x.path === "/auth/logout").length, 1,
      "Rapid clicks must not submit duplicate logout commands");
    current = anonymous;
    releaseLogout({ ok: false, status: 303 });
    for (let i = 0; i < 20 && !releaseVerification; i++) await Promise.resolve();
    assert.equal(typeof releaseVerification, "function");
    const whileVerifying = actions.execute("sign-out");
    assert.equal(requests.filter(x => x.path === "/auth/logout").length, 1,
      "An outstanding session proof still belongs to the original logout");
    releaseVerification({ ok: true, status: 200, json: async () => anonymous });
    await Promise.all([first, duplicate, whileVerifying]);
    assert.equal(identity.getSnapshot().state, "signed-out");
    assert.deepEqual(requests.map(x => x.path), [
      "/auth/session", "/auth/logout", "/auth/session",
    ]);
  } finally {
    actions.dispose(); identity.dispose();
  }
});

test("failed concurrent logout reports one failure without automatically retrying", async () => {
  const authenticated = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: true, status: "authenticated", provider: "supabase",
    subject: "account-a", email: "person@example.invalid",
  };
  let releaseLogout, postCount = 0;
  const windowRef = {
    fetch(path) {
      if (path === "/auth/session") return Promise.resolve({
        ok: true, status: 200, json: async () => authenticated,
      });
      if (path === "/auth/logout") {
        postCount++;
        return new Promise(resolve => { releaseLogout = resolve; });
      }
      throw Error("Unexpected endpoint");
    },
  };
  const identity = createWebIdentitySession(windowRef);
  await identity.refresh();
  const actions = createWebIdentityActions(windowRef, identity);
  try {
    const first = actions.execute("sign-out");
    const duplicate = actions.execute("sign-out");
    assert.equal(postCount, 1);
    releaseLogout({ ok: false, status: 503 });
    const results = await Promise.allSettled([first, duplicate]);
    assert.deepEqual(results.map(x => x.status), ["rejected", "rejected"]);
    assert.match(results[0].reason.message, /sign-out failed: 503/);
    assert.equal(postCount, 1);
    assert.equal(identity.getSnapshot().state, "signed-in");
    // Explicit later user action can retry; nothing retried automatically.
    const later = actions.execute("sign-out");
    assert.equal(postCount, 2);
    releaseLogout({ ok: false, status: 403 });
    await assert.rejects(later, /sign-out failed: 403/);
  } finally {
    actions.dispose(); identity.dispose();
  }
});

test("Web logout rejects unverified, stale or inconsistent sessions even after redirect", async () => {
  const authenticated = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: true, status: "authenticated", provider: "supabase",
    subject: "account-a", email: "person@example.invalid",
  };
  const anonymous = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: false, status: "anonymous", provider: "supabase",
  };
  for (const [name, logoutStatus, nextSession] of [
    ["cookie-still-active", 303, authenticated],
    ["opaque-redirect-still-active", 0, authenticated],
    ["session-unavailable", 303, null],
    ["contradictory-session", 303, { ...anonymous, status: "authenticated" }],
    ["logout-rejected", 403, anonymous],
  ]) {
    let reads = 0;
    const requests = [];
    const windowRef = {
      fetch: async (path) => {
        requests.push(path);
        if (path === "/auth/session") {
          reads += 1;
          if (reads === 1) return { ok: true, status: 200, json: async () => authenticated };
          if (nextSession === null) return { ok: false, status: 503 };
          return { ok: true, status: 200, json: async () => nextSession };
        }
        if (path === "/auth/logout") return { ok: false, status: logoutStatus };
        throw new Error("Unexpected endpoint");
      },
    };
    const identity = createWebIdentitySession(windowRef);
    await identity.refresh();
    const actions = createWebIdentityActions(windowRef, identity);
    try {
      await assert.rejects(actions.execute("sign-out"), /sign-out (not confirmed|failed)/, name);
      assert.equal(identity.getSnapshot().state,
        logoutStatus === 403 || nextSession === authenticated ? "signed-in" : "unavailable",
        name);
      assert.deepEqual(requests, logoutStatus === 403
        ? ["/auth/session", "/auth/logout"]
        : ["/auth/session", "/auth/logout", "/auth/session"], name);
    } finally {
      actions.dispose();
      identity.dispose();
    }
  }
});

test("Web logout POST has the shared deadline and cannot falsely sign out after timeout", async () => {
  const signedIn = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: true, status: "authenticated", provider: "supabase",
    subject: "account-a", email: "pessoa@example.invalid",
  };
  const requests = [], timers = new Map();
  let timerId = 0, resolveLate;
  const windowRef = {
    setTimeout(callback, delay) {
      assert.equal(delay, WEB_JSON_READ_TIMEOUT_MS);
      const id = ++timerId; timers.set(id, callback); return id;
    },
    clearTimeout(id) { timers.delete(id); },
    fetch(path, options) {
      requests.push({path, options});
      if (path === "/auth/session") return Promise.resolve({
        ok: true, status: 200, json: async () => signedIn,
      });
      if (path === "/auth/logout") return new Promise(resolve => { resolveLate = resolve; });
      throw new Error("Unexpected request");
    },
  };
  const session = createWebIdentitySession(windowRef);
  await session.refresh();
  const actions = createWebIdentityActions(windowRef, session);
  try {
    const pending = actions.execute("sign-out");
    assert.deepEqual(requests.map(x => x.path), ["/auth/session", "/auth/logout"]);
    assert.equal(requests[1].options.method, "POST");
    assert.equal(requests[1].options.signal instanceof AbortSignal, true);
    assert.equal(timers.size, 1);
    [...timers.values()][0]();
    await assert.rejects(pending, {name: "TimeoutError", message: "Web logout request deadline exceeded"});
    assert.equal(requests[1].options.signal.aborted, true);
    assert.equal(timers.size, 0);
    assert.equal(session.getSnapshot().state, "signed-in",
      "Timeout cannot claim that the server revoked its session");
    resolveLate({ok: true, status: 303});
    await Promise.resolve();
    assert.deepEqual(requests.map(x => x.path), ["/auth/session", "/auth/logout"],
      "Late acknowledgement must not trigger verification or retry");
  } finally {
    actions.dispose(); session.dispose();
  }
});

test("disposed Web identity actions do not verify an orphaned logout request", async () => {
  const sessionPayload = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: true, status: "authenticated", provider: "supabase",
    subject: "account-a", email: "person@example.invalid",
  };
  const requests = [];
  let resolveLogout;
  const windowRef = {
    fetch(path) {
      requests.push(path);
      if (path === "/auth/session") return Promise.resolve({ ok: true, status: 200, json: async () => sessionPayload });
      if (path === "/auth/logout") return new Promise(resolve => { resolveLogout = resolve; });
      throw new Error("Unexpected endpoint");
    },
  };
  const identity = createWebIdentitySession(windowRef);
  await identity.refresh();
  const actions = createWebIdentityActions(windowRef, identity);
  const pending = actions.execute("sign-out");
  actions.dispose();
  resolveLogout({ ok: false, status: 303 });
  await assert.rejects(pending, /disposed/);
  assert.deepEqual(requests, ["/auth/session", "/auth/logout"]);
  identity.dispose();
});

test("registration action requires an explicit legal-ready capability", async () => {
  const assigned = [];
  const windowRef = {
    location: { assign: (value) => assigned.push(value) },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: false,
        provider: "supabase",
        status: "anonymous",
      }),
    }),
  };
  const session = createWebIdentitySession(windowRef);
  await session.refresh();
  const actions = createWebIdentityActions(windowRef, session, { registrationEnabled: true });
  assert.deepEqual(actions.getSnapshot().supportedActions, ["sign-in", "register"]);

  await actions.execute("register");
  assert.deepEqual(assigned, ["/cadastro/"]);

  actions.dispose();
  session.dispose();
});


test("registration action follows fail-closed policy refresh", async () => {
  const windowRef = {
    location: { assign: () => {} },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: false,
        provider: "supabase",
        status: "anonymous",
      }),
    }),
  };
  const session = createWebIdentitySession(windowRef);
  await session.refresh();

  let enabled = false;
  const actions = createWebIdentityActions(windowRef, session, {
    registrationPolicy: async () => ({ registrationEnabled: enabled }),
  });
  assert.deepEqual(actions.getSnapshot().supportedActions, ["sign-in"]);

  await actions.refresh();
  assert.deepEqual(actions.getSnapshot().supportedActions, ["sign-in"]);

  enabled = true;
  await actions.refresh();
  assert.deepEqual(actions.getSnapshot().supportedActions, ["sign-in", "register"]);

  enabled = false;
  await actions.refresh();
  assert.deepEqual(actions.getSnapshot().supportedActions, ["sign-in"]);

  actions.dispose();
  session.dispose();
});

test("registration policy errors fail closed", async () => {
  const windowRef = {
    location: { assign: () => {} },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: false,
        provider: "supabase",
        status: "anonymous",
      }),
    }),
  };
  const session = createWebIdentitySession(windowRef);
  await session.refresh();
  const actions = createWebIdentityActions(windowRef, session, {
    registrationEnabled: true,
    registrationPolicy: async () => {
      throw new Error("unavailable");
    },
  });
  await actions.refresh();
  assert.deepEqual(actions.getSnapshot().supportedActions, ["sign-in"]);
  actions.dispose();
  session.dispose();
});

test("older registration policy reply cannot re-enable or disable a newer decision", async () => {
  const windowRef = {
    fetch: async () => ({
      ok: true,
      json: async () => ({
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: false, provider: "supabase", status: "anonymous",
      }),
    }),
  };
  const session = createWebIdentitySession(windowRef);
  await session.refresh();
  const pending = [];
  const actions = createWebIdentityActions(windowRef, session, {
    registrationPolicy: () => new Promise((resolve) => pending.push(resolve)),
  });
  const snapshots = [];
  actions.subscribe((snapshot) => snapshots.push(snapshot.supportedActions.join(",")));

  const oldEnable = actions.refresh();
  const latestDisable = actions.refresh();
  pending[1]({ registrationEnabled: false });
  await latestDisable;
  pending[0]({ registrationEnabled: true });
  await oldEnable;
  assert.deepEqual(actions.getSnapshot().supportedActions, ["sign-in"]);

  const oldDisable = actions.refresh();
  const latestEnable = actions.refresh();
  pending[3]({ registrationEnabled: true });
  await latestEnable;
  pending[2]({ registrationEnabled: false });
  await oldDisable;
  assert.deepEqual(actions.getSnapshot().supportedActions, ["sign-in", "register"]);
  assert.deepEqual(snapshots, ["sign-in", "sign-in,register"]);

  // A disposed instance must never publish a delayed registration capability.
  const orphaned = actions.refresh();
  actions.dispose();
  pending[4]({ registrationEnabled: false });
  await orphaned;
  assert.deepEqual(snapshots, ["sign-in", "sign-in,register"]);
  session.dispose();
});

test("disposed identity actions reject commands and do not query registration policy", async () => {
  const requests = [], assigned = [];
  const windowRef = {
    location: { assign: path => assigned.push(path) },
    fetch: async path => {
      requests.push(path);
      return { ok: true, json: async () => ({
        $schema: "prototype-ordax.public-identity-session/1",
        provider: "supabase", authenticated: true, status: "authenticated",
        subject: "account-a", email: "person@example.invalid",
      }) };
    },
  };
  const session = createWebIdentitySession(windowRef);
  await session.refresh();
  let policies = 0;
  const actions = createWebIdentityActions(windowRef, session, {
    registrationPolicy: async () => { policies++; return { registrationEnabled: true }; },
  });
  actions.dispose();
  actions.dispose();
  actions.subscribe(() => { throw Error("Disposed actions subscriber called"); });
  await actions.refresh();
  await assert.rejects(actions.execute("sign-out"), /disposed/);
  await assert.rejects(actions.execute("sign-in"), /disposed/);
  assert.equal(policies, 0);
  assert.deepEqual(assigned, []);
  assert.deepEqual(requests, ["/auth/session"]);
  session.dispose();
});
