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
import { createWebIdentitySession } from "../system/adapters/web/identity.mjs";
import { WEB_JSON_READ_TIMEOUT_MS } from "../system/adapters/web/json-read.mjs";
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
  assert.equal(calls.filter((call) => call.path === "/auth/session").every((call) =>
    call.options.redirect === "error" && call.options.signal instanceof AbortSignal), true,
    "Post-login session proof must reuse the bounded same-origin Web GET transport");
});

test("overlapping login and registration commands never submit credentials twice", async () => {
  const requests = [];
  let resolvePost;
  const authenticated = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: true, status: "authenticated", provider: "supabase",
    subject: "validated-subject", email: "pessoa@example.com",
  };
  const windowRef = {
    fetch(path, options) {
      requests.push({ path, options });
      if (path === "/auth/login") return new Promise(resolve => { resolvePost = resolve; });
      if (path === "/auth/register") return Promise.resolve({ ok: true, status: 202 });
      if (path === "/auth/session") return Promise.resolve({
        ok: true, status: 200, json: async () => authenticated,
      });
      throw Error("Unexpected credential endpoint");
    },
  };
  const port = createSameOriginIdentityCredentials(windowRef);
  const first = port.signIn({ email: "pessoa@example.com", password: "never-save-1" });
  assert.deepEqual(requests.map(x => x.path), ["/auth/login"]);
  for (const [action, value] of [
    ["signIn", { email: "another@example.com", password: "never-save-2" }],
    ["register", { email: "nova@example.com", password: "never-save-3", legalAccepted: true }],
  ]) {
    await assert.rejects(port[action](value), error => {
      assert.match(error.message, /submission is already in progress/);
      assert.doesNotMatch(error.message, /never-save|pessoa@example.com|another@example.com|nova@example.com/);
      return true;
    });
  }
  assert.deepEqual(requests.map(x => x.path), ["/auth/login"],
    "Overlapping credential commands cannot send a second POST or session GET");
  resolvePost({ ok: false, status: 303 });
  assert.deepEqual(await first, { authenticated: true, confirmationRequired: false });
  assert.deepEqual(requests.map(x => x.path), ["/auth/login", "/auth/session"]);
  assert.deepEqual(
    await port.register({ email: "nova@example.com", password: "never-save-4", legalAccepted: true }),
    { authenticated: false, confirmationRequired: true },
    "A completed verified session frees the adapter for an explicit subsequent action",
  );
  assert.deepEqual(requests.map(x => x.path), [
    "/auth/login", "/auth/session", "/auth/register",
  ]);
});

test("credential overlap guard includes pending session proof and resets after verification failure", async () => {
  let releaseSession;
  const requests = [];
  const port = createSameOriginIdentityCredentials({
    fetch(path, options) {
      requests.push({ path, options });
      if (path === "/auth/login") return Promise.resolve({ ok: false, status: 303 });
      if (path === "/auth/session") return new Promise(resolve => { releaseSession = resolve; });
      if (path === "/auth/register") return Promise.resolve({ ok: true, status: 202 });
      throw Error("Unexpected auth endpoint");
    },
  });
  const first = port.signIn({ email: "pessoa@example.com", password: "never-save-5" });
  for (let i = 0; i < 30 && !releaseSession; i++) await Promise.resolve();
  assert.equal(typeof releaseSession, "function");
  await assert.rejects(
    port.register({ email: "nova@example.com", password: "never-save-6", legalAccepted: true }),
    /submission is already in progress/,
    "A credential POST must not overlap an earlier POST's session verification",
  );
  assert.deepEqual(requests.map(x => x.path), ["/auth/login", "/auth/session"]);
  releaseSession({ ok: false, status: 503 });
  await assert.rejects(first, /session verification unavailable/);
  assert.deepEqual(
    await port.register({ email: "nova@example.com", password: "never-save-7", legalAccepted: true }),
    { authenticated: false, confirmationRequired: true },
    "A failed proof releases the single in-flight slot without an automatic retry",
  );
  assert.deepEqual(requests.map(x => x.path), [
    "/auth/login", "/auth/session", "/auth/register",
  ]);
});

test("invalid credential input cannot strand the in-flight slot", async () => {
  const requests = [];
  const port = createSameOriginIdentityCredentials({
    fetch(path) {
      requests.push(path);
      return Promise.resolve({ ok: true, status: 202 });
    },
  });
  await assert.rejects(
    port.signIn({ email: "invalid", password: "never-save-8" }),
    TypeError,
  );
  assert.deepEqual(requests, []);
  assert.deepEqual(
    await port.register({ email: "nova@example.com", password: "never-save-9", legalAccepted: true }),
    { authenticated: false, confirmationRequired: true },
  );
  assert.deepEqual(requests, ["/auth/register"]);
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

test("credential activation follows the exact canonical identity parser for unsafe gateway identities", async () => {
  const base = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: true, status: "authenticated", provider: "supabase",
    subject: "user-verified", email: "pessoa@example.com",
  };
  for (const [reason, payload] of [
    ["unsafe email fallback", { ...base, email: "unsafe\\nname@example.com".replace("\\n", "\n") }],
    ["oversized email fallback", { ...base, email: `${"x".repeat(121)}@example.com` }],
    ["control-only email fallback", { ...base, email: "\n@example.com" }],
    ["invalid subject", { ...base, subject: "" }],
    ["conflicting status", { ...base, status: "anonymous" }],
    ["unconfigured provider", { ...base, provider: "gated" }],
  ]) {
    const calls = [];
    const windowRef = {
      fetch: async (path, options) => {
        calls.push({ path, options });
        return path === "/auth/session"
          ? { ok: true, status: 200, json: async () => payload }
          : { ok: false, status: 303 };
      },
    };
    const session = createWebIdentitySession(windowRef);
    try {
      await session.refresh();
      assert.equal(session.getSnapshot().state, "unavailable", reason);
      await assert.rejects(
        createSameOriginIdentityCredentials(windowRef).signIn({
          email: "pessoa@example.com", password: "never-disclose-this-password",
        }),
        error => {
          assert.match(error.message, /session was not activated/i, reason);
          assert.doesNotMatch(error.message, /never-disclose|unsafe|pessoa@example.com/);
          return true;
        },
      );
      assert.deepEqual(calls.map(call => call.path),
        ["/auth/session", "/auth/login", "/auth/session"], reason);
    } finally {
      session.dispose();
    }
  }
});

test("credential success and remembered email use only the canonical verified identity", async () => {
  const gateway = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: true, status: "authenticated", provider: "supabase",
    subject: "account-verified",
    displayName: "  Pessoa com nome seguro  ",
    email: "pessoa@example.com",
  };
  const localStorage = new Map();
  const windowRef = {
    localStorage: {
      getItem: key => localStorage.get(key) ?? null,
      setItem: (key, value) => localStorage.set(key, value),
    },
    fetch: async (path) => path === "/auth/session"
      ? { ok: true, status: 200, json: async () => gateway }
      : { ok: false, status: 303 },
  };
  const identity = createWebIdentitySession(windowRef);
  try {
    await identity.refresh();
    assert.equal(identity.getSnapshot().state, "signed-in");
    assert.equal(identity.getSnapshot().displayName, "Pessoa com nome seguro");
    assert.deepEqual(
      await createSameOriginIdentityCredentials(windowRef).signIn({
        email: "pessoa@example.com", password: "never-store-this-password",
      }),
      { authenticated: true, confirmationRequired: false },
    );
    assert.equal(localStorage.get("ordax.account.remembered-email.v1"), "pessoa@example.com");
    assert.equal(JSON.stringify([...localStorage]).includes("never-store-this-password"), false);
  } finally {
    identity.dispose();
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
        authenticated: false, status: "anonymous", provider: "supabase",
      }) },
  });
  assert.deepEqual(
    await port.register({
      email: "nova@example.com", password: "secret-2", legalAccepted: true,
    }),
    { authenticated: false, confirmationRequired: true },
  );
});

test("registration confirmation rejects unavailable and contradictory gateway providers", async () => {
  const register = { email: "nova@example.com", password: "secret-2", legalAccepted: true };
  const anonymous = {
    $schema: "prototype-ordax.public-identity-session/1",
    authenticated: false, status: "anonymous", provider: "supabase",
  };
  for (const payload of [
    { ...anonymous, provider: "gated" },
    { ...anonymous, provider: "unconfigured" },
    { ...anonymous, provider: "" },
    { ...anonymous, provider: " supabase" },
    { ...anonymous, status: "authenticated" },
    { ...anonymous, authenticated: "false" },
  ]) {
    const port = createSameOriginIdentityCredentials({
      fetch: async (path) => path === "/auth/register"
        ? { status: 200, ok: true }
        : { status: 200, ok: true, json: async () => payload },
    });
    await assert.rejects(port.register(register), /session was not activated/,
      "A gated or contradictory session must not promise email confirmation");
  }
});

test("credential POSTs terminate when the transport ignores abort, without replay or false activation", async () => {
  const credentials = { email: "pessoa@example.com", password: "never-log-this-password" };
  for (const action of ["signIn", "register"]) {
    const timers = new Map();
    const calls = [];
    let resolveLate;
    let nextTimerId = 0;
    const windowRef = {
      setTimeout(callback, duration) {
        assert.equal(duration, WEB_JSON_READ_TIMEOUT_MS);
        const id = ++nextTimerId;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id) { timers.delete(id); },
      fetch(path, options) {
        calls.push({ path, options });
        return new Promise(resolve => { resolveLate = resolve; });
      },
    };
    const port = createSameOriginIdentityCredentials(windowRef);
    const pending = port[action](action === "register"
      ? { ...credentials, legalAccepted: true }
      : credentials);
    assert.deepEqual(calls.map(call => call.path),
      [action === "register" ? "/auth/register" : "/auth/login"]);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.redirect, "manual");
    assert.equal(calls[0].options.credentials, "same-origin");
    assert.equal(calls[0].options.cache, "no-store");
    assert.equal(calls[0].options.signal instanceof AbortSignal, true);
    assert.equal(timers.size, 1);
    [...timers.values()][0]();
    await assert.rejects(pending, error => {
      assert.equal(error.name, "TimeoutError");
      assert.match(error.message, /Web credential request deadline exceeded/);
      assert.doesNotMatch(error.message, /never-log-this-password|pessoa@example.com/);
      return true;
    });
    assert.equal(calls[0].options.signal.aborted, true);
    assert.equal(timers.size, 0, "Aborted POST must release the shared deadline");
    resolveLate({ status: action === "register" ? 202 : 303, ok: true });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls.length, 1,
      "Late POST success cannot trigger verification or automatically replay credentials");
  }
});

test("credential error HTTP responses retain bounded status with the shared POST deadline", async () => {
  const timers = new Map();
  let nextId = 0;
  const windowRef = {
    setTimeout(callback, duration) {
      assert.equal(duration, WEB_JSON_READ_TIMEOUT_MS);
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    fetch: async () => ({
      status: 429, ok: false,
      text: async () => "<html>never-read-provider-trace</html>",
    }),
  };
  await assert.rejects(
    createSameOriginIdentityCredentials(windowRef).signIn({
      email: "pessoa@example.com", password: "never-log-this-password",
    }),
    error => {
      assert.ok(error instanceof IdentityCredentialRequestError);
      assert.equal(error.status, 429);
      assert.doesNotMatch(error.message, /never-read|never-log|pessoa@example.com/);
      return true;
    },
  );
  assert.equal(timers.size, 0);
});

test("post-credential session verification bounds stalled fetch and JSON body with the shared deadline", async () => {
  for (const mode of ["fetch", "body"]) {
    const timers = new Map();
    const requests = [];
    let lastTimer = 0;
    const windowRef = {
      setTimeout(callback, duration) {
        assert.equal(duration, WEB_JSON_READ_TIMEOUT_MS);
        const id = ++lastTimer;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id) { timers.delete(id); },
      fetch(path, options) {
        requests.push({ path, options });
        if (path === "/auth/login") return Promise.resolve({ status: 303, ok: false });
        assert.equal(path, "/auth/session");
        if (mode === "fetch") return new Promise(() => {});
        return Promise.resolve({
          ok: true, status: 200, json: () => new Promise(() => {}),
        });
      },
    };
    const port = createSameOriginIdentityCredentials(windowRef);
    const pending = port.signIn({ email: "pessoa@example.com", password: "secret-1" });
    // The POST now has its own deadline; wait for the verification GET itself
    // rather than stopping at the first timer (which belongs to the POST).
    for (let i = 0; i < 40 && requests.length < 2; i++) await Promise.resolve();
    assert.equal(requests.length, 2, "Exactly one credential POST and one verification GET");
    assert.equal(timers.size, 1, "The canonical GET reader must install one deadline");
    assert.equal(requests[1].options.redirect, "error");
    assert.equal(requests[1].options.credentials, "same-origin");
    assert.equal(requests[1].options.cache, "no-store");
    [...timers.values()][0]();
    await assert.rejects(pending, /Web read deadline exceeded/);
    assert.equal(requests[1].options.signal.aborted, true);
    assert.equal(timers.size, 0, "The failed proof must clear its deadline");
    assert.equal(requests.length, 2, "A stalled verification must never replay credentials");
  }
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

test("partial or noncanonical 2xx responses cannot enable registration", async () => {
  const authoritative = {
    $schema: "prototype-ordax.registration-legal-policy/1",
    active: true, registrationEnabled: true, publicRegistrationEnabled: true,
    policyId: "11111111-1111-4111-8111-111111111111",
    privacy: {
      version: "2026-10-02", effectiveDate: "2026-10-02",
      sha256: "a".repeat(64), url: "https://ordax.example/privacidade/",
    },
    terms: {
      version: "2026-10-02", effectiveDate: "2026-10-02",
      sha256: "b".repeat(64), url: "https://ordax.example/termos/",
    },
  };
  for (const status of [201, 202, 206, 207]) {
    const requests = [];
    const port = createSameOriginIdentityCredentials({
      fetch: async (path, options) => {
        requests.push({ path, options });
        return { ok: true, status, json: async () => authoritative };
      },
    });
    await assert.rejects(port.registrationPolicy(),
      /Registration policy request failed/, `HTTP ${status} is not an authoritative policy`);
    assert.deepEqual(requests.map(x => x.path), ["/auth/registration-policy"]);
    assert.equal(requests[0].options.credentials, "same-origin");
  }
  const trusted = createSameOriginIdentityCredentials({
    fetch: async () => ({ ok: true, status: 200, json: async () => authoritative }),
  });
  const policy = await trusted.registrationPolicy();
  assert.equal(policy.registrationEnabled, true);
  assert.equal(policy.publicRegistrationEnabled, true);
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
