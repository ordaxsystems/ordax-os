import test from "node:test";
import assert from "node:assert/strict";

import {
  IDENTITY_CREDENTIALS_SCHEMA,
  assertIdentityCredentialsPort,
  validateIdentityCredentialInput,
  validateIdentityRegistrationInput,
  validateRegistrationPolicy,
  sameRegistrationLegalPolicy,
} from "../system/contracts/identity-credentials.mjs";
import { createSameOriginIdentityCredentials, IdentityCredentialRequestError } from "../system/adapters/web/identity-credentials.mjs";
import { identityCredentialFailureMessageId } from "../system/services/account/identity-credential-feedback.mjs";

test("identity credentials validate transient email/password input", () => {
  assert.deepEqual(
    validateIdentityCredentialInput({
      email: " pessoa@example.com ",
      password: "segredo-local",
    }),
    { email: "pessoa@example.com", password: "segredo-local" },
  );
  assert.throws(
    () => validateIdentityCredentialInput({ email: "invalid", password: "x" }),
    TypeError,
  );
});

test("registration input requires explicit acceptance", () => {
  assert.deepEqual(
    validateIdentityRegistrationInput({
      email: "nova@example.com",
      password: "segredo-local",
      legalAccepted: true,
    }),
    { email: "nova@example.com", password: "segredo-local", legalAccepted: true },
  );
  assert.throws(
    () => validateIdentityRegistrationInput({
      email: "nova@example.com",
      password: "segredo-local",
      legalAccepted: false,
    }),
    TypeError,
  );
});

test("registration policy validates server-owned canonical metadata", () => {
  const policy = validateRegistrationPolicy({
    $schema: "prototype-ordax.registration-legal-policy/1",
    active: true,
    registrationEnabled: false,
    policyId: "11111111-1111-4111-8111-111111111111",
    privacy: {
      version: "2026-10-02",
      effectiveDate: "2026-10-02",
      sha256: "a".repeat(64),
      url: "https://ordax.example/privacidade/",
    },
    terms: {
      version: "2026-10-02",
      effectiveDate: "2026-10-02",
      sha256: "b".repeat(64),
      url: "https://ordax.example/termos/",
    },
  });
  assert.equal(policy.registrationEnabled, false);
  assert.equal(policy.publicRegistrationEnabled, false); // older Gateway fails closed
  assert.equal(policy.privacy.version, "2026-10-02");
  assert.throws(
    () => validateRegistrationPolicy({
      $schema: "prototype-ordax.registration-legal-policy/1",
      active: true,
      registrationEnabled: true,
      policyId: "11111111-1111-4111-8111-111111111111",
      privacy: {
        version: "v1",
        effectiveDate: "2026-10-02",
        sha256: "a".repeat(64),
        url: "http://insecure.example/privacy",
      },
      terms: {
        version: "v1",
        effectiveDate: "2026-10-02",
        sha256: "b".repeat(64),
        url: "https://ordax.example/terms",
      },
    }),
    TypeError,
  );
});

test("explicit hosted registration capability validates strict Boolean and remains separate from Native", () => {
  const data = { $schema: "prototype-ordax.registration-legal-policy/1", active: true,
    registrationEnabled: false, publicRegistrationEnabled: true,
    policyId: "11111111-1111-4111-8111-111111111111",
    privacy: { version: "2026-10-02", effectiveDate: "2026-10-02", sha256: "a".repeat(64), url: "https://ordax.example/privacidade/" },
    terms: { version: "2026-10-02", effectiveDate: "2026-10-02", sha256: "b".repeat(64), url: "https://ordax.example/termos/" },
  };
  const parsed = validateRegistrationPolicy(data);
  assert.equal(parsed.registrationEnabled, false);
  assert.equal(parsed.publicRegistrationEnabled, true);
  assert.throws(() => validateRegistrationPolicy({ ...data, publicRegistrationEnabled: "true" }), TypeError);
  assert.equal(validateRegistrationPolicy({ ...data, publicRegistrationEnabled: false }).publicRegistrationEnabled, false);
});

test("same-origin credential adapter posts only to OrdaX auth routes", async () => {
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
            status: "authenticated",
            provider: "supabase",
            subject: "validated-subject",
            email: "pessoa@example.com",
          }),
        };
      }
      return { ok: true, status: 303 };
    },
  };
  const port = createSameOriginIdentityCredentials(windowRef);
  assert.equal(port.schema, IDENTITY_CREDENTIALS_SCHEMA);
  assertIdentityCredentialsPort(port);

  await port.signIn({ email: "pessoa@example.com", password: "secret-1" });
  await port.register({
    email: "nova@example.com",
    password: "secret-2",
    legalAccepted: true,
  });

  assert.deepEqual(calls.map((call) => call.path), [
    "/auth/login", "/auth/session", "/auth/register", "/auth/session",
  ]);
  assert.equal(calls.every((call) => call.options.credentials === "same-origin"), true);
  assert.equal(calls.filter((call) => call.options.method === "POST").every((call) => call.options.redirect === "manual"), true);
  assert.equal(calls[0].options.body.includes("pessoa%40example.com"), true);
  assert.equal(calls[0].options.body.includes("secret-1"), true);
  assert.equal(calls[2].options.body.includes("legal_acceptance=accepted"), true);
  assert.equal(calls.filter((call) => call.path === "/auth/session").every((call) => call.options.cache === "no-store"), true);
});

test("registration confirmation is explicit and does not claim a session", async () => {
  const port = createSameOriginIdentityCredentials({
    fetch: async () => ({ ok: true, status: 202 }),
  });
  assert.deepEqual(
    await port.register({
      email: "nova@example.com",
      password: "secret",
      legalAccepted: true,
    }),
    { authenticated: false, confirmationRequired: true },
  );
});

test("credential POST success cannot activate a signed-out or unverified account", async () => {
  const credentials = { email: "pessoa@example.com", password: "secret-1" };
  const signedOut = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: false, status: "anonymous",
  };
  for (const [title, sessionReply] of [
    ["anonymous", { ok: true, status: 200, json: async () => signedOut }],
    ["upstream unavailable", { ok: false, status: 503 }],
    ["opaque", { ok: true, status: 200, json: async () => ({}) }],
    ["missing subject", {
      ok: true, status: 200,
      json: async () => ({
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: true, status: "authenticated", email: "pessoa@example.com",
      }),
    }],
  ]) {
    const calls = [];
    const port = createSameOriginIdentityCredentials({
      fetch: async (path, options) => {
        calls.push([path, options.method]);
        return path === "/auth/login" ? { ok: true, status: 200 } : sessionReply;
      },
    });
    await assert.rejects(port.signIn(credentials), /session/i, title);
    assert.deepEqual(calls, [["/auth/login", "POST"], ["/auth/session", "GET"]], title);
  }
});

test("opaque redirect and 202 cannot be accepted as login", async () => {
  let calls = 0;
  for (const status of [0, 202]) {
    const port = createSameOriginIdentityCredentials({
      fetch: async () => { calls += 1; return { status, ok: status === 202 }; },
    });
    await assert.rejects(port.signIn({ email: "pessoa@example.com", password: "secret-1" }));
  }
  assert.equal(calls, 2, "unsafe responses never trigger session activation");
});

test("registration with a verified anonymous session requires confirmation", async () => {
  const port = createSameOriginIdentityCredentials({
    fetch: async (path) => path === "/auth/register"
      ? { status: 200, ok: true }
      : { status: 200, ok: true, json: async () => ({
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: false, status: "anonymous",
      }) },
  });
  assert.deepEqual(
    await port.register({
      email: "nova@example.com", password: "secret-2", legalAccepted: true,
    }),
    { authenticated: false, confirmationRequired: true },
  );
});

test("registration policy is fetched read-only from the same-origin gateway", async () => {
  const calls = [];
  const port = createSameOriginIdentityCredentials({
    fetch: async (path, options) => {
      calls.push({ path, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          $schema: "prototype-ordax.registration-legal-policy/1",
          active: true,
          registrationEnabled: true,
          policyId: "11111111-1111-4111-8111-111111111111",
          privacy: {
            version: "2026-10-02",
            effectiveDate: "2026-10-02",
            sha256: "a".repeat(64),
            url: "https://ordax.example/privacidade/",
          },
          terms: {
            version: "2026-10-02",
            effectiveDate: "2026-10-02",
            sha256: "b".repeat(64),
            url: "https://ordax.example/termos/",
          },
        }),
      };
    },
  });
  const policy = await port.registrationPolicy();
  assert.equal(policy.registrationEnabled, true);
  assert.equal(calls[0].path, "/auth/registration-policy");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.cache, "no-store");
});

test("OOBE must request fresh legal acceptance when any authoritative document changes", () => {
  const data = {
    $schema: "prototype-ordax.registration-legal-policy/1",
    active: true,
    registrationEnabled: true,
    policyId: "11111111-1111-4111-8111-111111111111",
    privacy: {
      version: "2026-10-02",
      effectiveDate: "2026-10-02",
      sha256: "a".repeat(64),
      url: "https://ordax.example/privacidade/",
    },
    terms: {
      version: "2026-10-02",
      effectiveDate: "2026-10-02",
      sha256: "b".repeat(64),
      url: "https://ordax.example/termos/",
    },
  };
  const original = validateRegistrationPolicy(data);
  const sameContent = validateRegistrationPolicy(structuredClone(data));
  assert.equal(sameRegistrationLegalPolicy(original, sameContent), true);
  assert.equal(sameRegistrationLegalPolicy(original, null), false);
  assert.equal(sameRegistrationLegalPolicy(null, original), false);
  assert.equal(sameRegistrationLegalPolicy(original, { schema: original.schema, policyId: original.policyId, registrationEnabled: true }), false);

  for (const change of [
    (draft) => { draft.policyId = "22222222-2222-4222-8222-222222222222"; },
    (draft) => { draft.registrationEnabled = false; },
    (draft) => { draft.privacy.sha256 = "c".repeat(64); },
    (draft) => { draft.privacy.version = "2026-10-11"; },
    (draft) => { draft.privacy.effectiveDate = "2026-10-11"; },
    (draft) => { draft.privacy.url = "https://ordax.example/privacidade/nova/"; },
    (draft) => { draft.terms.sha256 = "d".repeat(64); },
    (draft) => { draft.terms.version = "2026-10-11"; },
    (draft) => { draft.terms.effectiveDate = "2026-10-11"; },
    (draft) => { draft.terms.url = "https://ordax.example/termos/novos/"; },
  ]) {
    const altered = structuredClone(data);
    change(altered);
    assert.equal(sameRegistrationLegalPolicy(original, validateRegistrationPolicy(altered)), false);
  }
});

test("verified login remembers only the email in same-origin profile storage", async () => {
  const storage = new Map();
  const localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  };
  const windowRef = {
    localStorage,
    fetch: async (path) => path === "/auth/login"
      ? { status: 200, ok: true }
      : { status: 200, ok: true, json: async () => ({
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: true, status: "authenticated", provider: "supabase",
        subject: "session-owner", email: "pessoa@example.com",
      }) },
  };
  await createSameOriginIdentityCredentials(windowRef).signIn({
    email: "pessoa@example.com", password: "never-save-this-password",
  });
  const { readRememberedLoginEmail, forgetRememberedLoginEmail } = await import(
    "../system/services/account/remembered-login-email.mjs"
  );
  assert.equal(readRememberedLoginEmail(windowRef), "pessoa@example.com");
  assert.equal(storage.size, 1);
  assert.equal(JSON.stringify([...storage]), JSON.stringify([["ordax.account.remembered-email.v1", "pessoa@example.com"]]));
  assert.equal(forgetRememberedLoginEmail(windowRef), true);
  assert.equal(readRememberedLoginEmail(windowRef), "");
});

test("unverified login and unavailable storage do not create a remembered email", async () => {
  const stored = new Map();
  const windowRef = {
    localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    fetch: async (path) => path === "/auth/login"
      ? { status: 200, ok: true }
      : { status: 200, ok: true, json: async () => ({
        $schema: "prototype-ordax.public-identity-session/1",
        authenticated: false, status: "anonymous",
      }) },
  };
  await assert.rejects(
    createSameOriginIdentityCredentials(windowRef).signIn({email:"pessoa@example.com", password:"secret"}),
    /session/i,
  );
  assert.equal(stored.size, 0);
  const { readRememberedLoginEmail, rememberVerifiedLoginEmail } = await import(
    "../system/services/account/remembered-login-email.mjs"
  );
  const forbidden = { get localStorage() { throw new Error("storage blocked"); } };
  assert.equal(readRememberedLoginEmail(forbidden), "");
  assert.equal(rememberVerifiedLoginEmail(forbidden, "pessoa@example.com"), false);
});


test("credential errors keep bounded transport status without leaking provider content", async () => {
  const credentials = { email: "pessoa@example.com", password: "secret-1" };
  for (const [status, expectedStatus, messageId] of [
    [401,401,"account.credentials.invalid"],
    [429,429,"account.credentials.rateLimited"],
    [503,503,"account.credentials.unavailable"],
    [500,500,"account.action.failed"],
    [0,null,"account.action.failed"],
    [202,null,"account.action.failed"],
  ]) {
    let calls=0;
    const port=createSameOriginIdentityCredentials({
      fetch: async () => {calls += 1; return {status, ok:false,
        text:async()=>"<html>secret-provider-trace</html>"};},
    });
    await assert.rejects(port.signIn(credentials), error => {
      assert.ok(error instanceof IdentityCredentialRequestError);
      assert.equal(error.status, expectedStatus);
      if (expectedStatus !== null) assert.match(error.message, new RegExp(String(expectedStatus)));
      assert.equal(identityCredentialFailureMessageId(error),messageId);
      assert.doesNotMatch(error.message,/secret|trace|pessoa@example.com|secret-1/i);
      return true;
    });
    assert.equal(calls,1,"failed credential submission must not claim verified session");
  }
  assert.equal(identityCredentialFailureMessageId(new Error("network")), "account.action.failed");
});
