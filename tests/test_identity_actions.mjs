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
