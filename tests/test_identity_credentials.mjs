import test from "node:test";
import assert from "node:assert/strict";

import {
  IDENTITY_CREDENTIALS_SCHEMA,
  assertIdentityCredentialsPort,
  validateIdentityCredentialInput,
  validateIdentityRegistrationInput,
  validateRegistrationPolicy,
} from "../system/contracts/identity-credentials.mjs";
import { createSameOriginIdentityCredentials } from "../system/adapters/web/identity-credentials.mjs";

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

test("same-origin credential adapter posts only to OrdaX auth routes", async () => {
  const calls = [];
  const windowRef = {
    fetch: async (path, options) => {
      calls.push({ path, options });
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

  assert.deepEqual(calls.map((call) => call.path), ["/auth/login", "/auth/register"]);
  assert.equal(calls.every((call) => call.options.credentials === "same-origin"), true);
  assert.equal(calls.every((call) => call.options.redirect === "manual"), true);
  assert.equal(calls[0].options.body.includes("pessoa%40example.com"), true);
  assert.equal(calls[0].options.body.includes("secret-1"), true);
  assert.equal(calls[1].options.body.includes("legal_acceptance=accepted"), true);
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
