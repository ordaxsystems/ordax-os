import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_LIFECYCLE_SCHEMA,
  assertAccountLifecyclePort,
  isAccountLifecycleActionSupported,
  validateAccountCloseRequest,
  validateAccountLifecycleSnapshot,
} from "../system/contracts/account-lifecycle.mjs";
import { createSameOriginAccountLifecycle } from "../system/adapters/web/account-lifecycle.mjs";

function sessionPort(initialState = "signed-in") {
  let snapshot = initialState === "signed-in"
    ? { state: "signed-in", subjectId: "user-1", displayName: "Person" }
    : { state: initialState, subjectId: null, displayName: null };
  const listeners = new Set();
  let refreshes = 0;
  return {
    schema: "ordax.identity-session/1",
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    async refresh() {
      refreshes += 1;
      return snapshot;
    },
    setState(state) {
      snapshot = state === "signed-in"
        ? { state, subjectId: "user-1", displayName: "Person" }
        : { state, subjectId: null, displayName: null };
      for (const listener of listeners) listener(snapshot);
    },
    refreshCount: () => refreshes,
  };
}

test("account lifecycle contract accepts only close-account once", () => {
  const snapshot = validateAccountLifecycleSnapshot({ supportedActions: ["close-account"] });
  assert.deepEqual(snapshot.supportedActions, ["close-account"]);
  assert.equal(isAccountLifecycleActionSupported(snapshot, "close-account"), true);
  assert.throws(
    () => validateAccountLifecycleSnapshot({ supportedActions: ["close-account", "close-account"] }),
    TypeError,
  );
  assert.throws(
    () => validateAccountLifecycleSnapshot({ supportedActions: ["delete-everything"] }),
    TypeError,
  );
});

test("account close request requires current password and exact explicit confirmation", () => {
  assert.deepEqual(
    validateAccountCloseRequest({ password: "current-secret", confirmation: "close-account" }),
    { password: "current-secret", confirmation: "close-account" },
  );
  assert.throws(
    () => validateAccountCloseRequest({ password: "current-secret", confirmation: "yes" }),
    TypeError,
  );
  assert.throws(
    () => validateAccountCloseRequest({ password: "", confirmation: "close-account" }),
    TypeError,
  );
});

test("account lifecycle port is schema and method checked", () => {
  const port = {
    schema: ACCOUNT_LIFECYCLE_SCHEMA,
    getSnapshot: () => ({ supportedActions: [] }),
    subscribe: () => () => {},
    refresh: async () => ({ supportedActions: [] }),
    closeAccount: async () => ({ closed: true }),
  };
  assert.equal(assertAccountLifecyclePort(port), port);
});

test("same-origin lifecycle capability remains hidden when server gate is false", async () => {
  const session = sessionPort();
  const calls = [];
  const port = createSameOriginAccountLifecycle({
    fetch: async (path, options) => {
      calls.push({ path, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          $schema: "prototype-ordax.public-identity-session/1",
          authenticated: true,
          provider: "supabase",
          status: "authenticated",
          subject: "user-1",
          email: "person@example.com",
          accountCloseEnabled: false,
        }),
      };
    },
  }, session);

  await port.refresh();
  assert.deepEqual(port.getSnapshot().supportedActions, []);
  await assert.rejects(
    () => port.closeAccount({ password: "secret", confirmation: "close-account" }),
    /unavailable/,
  );
  assert.deepEqual(calls.map((call) => call.path), ["/auth/session"]);
  port.dispose();
});

test("same-origin lifecycle posts transient close request only after capability proof", async () => {
  const session = sessionPort();
  const calls = [];
  const windowRef = {
    fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === "/auth/session") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            $schema: "prototype-ordax.public-identity-session/1",
            authenticated: true,
            provider: "supabase",
            status: "authenticated",
            subject: "user-1",
            email: "person@example.com",
            accountCloseEnabled: true,
          }),
        };
      }
      assert.equal(path, "/account/close");
      return {
        ok: true,
        status: 200,
        json: async () => ({ closed: true }),
      };
    },
  };

  const port = createSameOriginAccountLifecycle(windowRef, session);
  await port.refresh();
  assert.deepEqual(port.getSnapshot().supportedActions, ["close-account"]);

  const result = await port.closeAccount({
    password: "current secret",
    confirmation: "close-account",
  });
  assert.deepEqual(result, { closed: true });
  const closeCall = calls.find((call) => call.path === "/account/close");
  assert.equal(closeCall.options.method, "POST");
  assert.equal(closeCall.options.credentials, "same-origin");
  assert.equal(closeCall.options.cache, "no-store");
  assert.equal(closeCall.options.redirect, "manual");
  assert.equal(closeCall.options.body.includes("password=current+secret"), true);
  assert.equal(closeCall.options.body.includes("confirmation=close-account"), true);
  assert.equal(closeCall.path.includes("current"), false);
  assert.deepEqual(port.getSnapshot().supportedActions, []);
  assert.equal(session.refreshCount(), 1);
  port.dispose();
});

test("session loss immediately removes destructive account lifecycle authority", async () => {
  const session = sessionPort();
  const port = createSameOriginAccountLifecycle({
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        authenticated: true,
        accountCloseEnabled: true,
      }),
    }),
  }, session);
  await port.refresh();
  assert.deepEqual(port.getSnapshot().supportedActions, ["close-account"]);
  session.setState("signed-out");
  assert.deepEqual(port.getSnapshot().supportedActions, []);
  port.dispose();
});
