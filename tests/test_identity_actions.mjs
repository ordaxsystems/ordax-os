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
test("sign-out rejects opaque redirect and unchanged authenticated state", async () => {
  let status = 200;
  let authenticated = true;
  const windowRef = {
    fetch: async path => path === "/auth/session" ? {
      ok: true, status: 200,
      json: async () => authenticated ? {
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: true, provider: "supabase", status: "authenticated",
        subject: "account-A", email: "person@example.invalid",
      } : {
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: false, provider: "supabase", status: "anonymous",
      },
    } : { ok: status >= 200 && status < 300, status },
  };
  const session = createWebIdentitySession(windowRef);
  await session.refresh();
  const actions = createWebIdentityActions(windowRef, session);
  status = 0;
  await assert.rejects(actions.execute("sign-out"), /sign-out failed/);
  status = 200;
  await assert.rejects(actions.execute("sign-out"), /not confirmed/);
  assert.equal(session.getSnapshot().state, "signed-in");
  authenticated = false;
  await actions.execute("sign-out");
  assert.equal(session.getSnapshot().state, "signed-out");
  actions.dispose();
  session.dispose();
});
test("offline Native logout detaches local bearer while honestly marking remote revocation unconfirmed", async () => {
  let signedIn = true, remoteRevocation = "unconfirmed";
  const calls = [];
  const windowRef = {
    fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === "/auth/logout") {
        signedIn = false;
        return { ok: true, status: 202, json: async () => ({
          $schema: "ordax.native-account-detach/1",
          localSessionDetached: true, remoteRevocation,
        }) };
      }
      if (path === "/auth/session") return {
        ok: true,
        json: async () => signedIn ? {
          $schema: "prototype-ordax.public-identity-session/1",
          authenticated: true, provider: "ordax-native",
          status: "authenticated", subject: "account-A", email: "a@example.invalid",
        } : {
          $schema: "prototype-ordax.public-identity-session/1",
          authenticated: false, provider: "ordax-native", status: "anonymous",
        },
      };
      throw Error("unexpected route");
    },
  };
  const session = createWebIdentitySession(windowRef);
  await session.refresh();
  const actions = createWebIdentityActions(windowRef, session);
  const receipt = await actions.disconnectLocal();
  assert.deepEqual(receipt, { localSessionDetached: true, remoteRevocation: "unconfirmed" });
  assert.equal(session.getSnapshot().state, "signed-out");
  assert.deepEqual(calls.filter(x => x.path === "/auth/logout").map(x => x.options.method), ["POST"]);
  actions.dispose(); session.dispose();
});

test("unavailable gateway permits guest only with exact Native detachment receipt", async () => {
  let proof = { $schema: "ordax.native-account-detach/1", localSessionDetached: true, remoteRevocation: "not-applicable" };
  const windowRef = {
    fetch: async path => path === "/auth/logout" ? {
      ok: true, status: 202, json: async () => proof,
    } : { ok: true, json: async () => ({
      $schema: "prototype-ordax.public-identity-session/1",
      authenticated: false, provider: "unconfigured", status: "anonymous",
    }) },
  };
  const session = createWebIdentitySession(windowRef);
  await session.refresh();
  assert.equal(session.getSnapshot().state, "unavailable");
  const actions = createWebIdentityActions(windowRef, session);
  assert.equal((await actions.disconnectLocal()).localSessionDetached, true);
  proof = { ...proof, localSessionDetached: false };
  await assert.rejects(actions.disconnectLocal(), /detachment proof is invalid/);
  proof = { ...proof, localSessionDetached: true, remoteRevocation: "confirmed" };
  await assert.rejects(actions.disconnectLocal(), /detachment proof is invalid/);
  actions.dispose(); session.dispose();
});
