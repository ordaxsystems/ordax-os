import test from "node:test";
import assert from "node:assert/strict";
import {
  CLOSED_ACCOUNT_BOUNDARY_PROOF_SCHEMA,
  proveClosedAccountBoundary,
} from "../tools/public-site/prove_closed_account_boundary.mjs";

const base = "https://jhfphsjptrpmtnzkpwud.supabase.co/functions/v1/ordax-account-gateway";
const origin = "https://ordax.com.br";
const policy = () => ({
  active: true,
  registrationEnabled: false,
  publicRegistrationEnabled: false,
  policyId: "11111111-1111-4111-8111-111111111111",
  privacy: { sha256: "a".repeat(64) },
  terms: { sha256: "b".repeat(64) },
});
function fixtures(overrides = {}) {
  return new Map(Object.entries({
    [base + "/auth/registration-policy"]: policy(),
    [origin + "/auth/registration-policy"]: policy(),
    [origin + "/auth/session"]: { authenticated: false },
    [base + "/health"]: { service: "ordax-account-gateway", version: 17 },
    ...overrides,
  }));
}
function mockGet(values, called) {
  return async (url, options) => {
    called.push({ url, options });
    return {
      ok: values.has(url),
      status: values.has(url) ? 200 : 404,
      json: async () => values.get(url),
    };
  };
}
const run = (values, calls = []) => proveClosedAccountBoundary({
  fetchImpl: mockGet(values, calls),
  gatewayBaseUrl: base + "\n",
});

test("production proof checks canonical channels with only anonymous read-only GETs", async () => {
  const calls = [];
  const output = await run(fixtures(), calls);
  assert.equal(output.$schema, CLOSED_ACCOUNT_BOUNDARY_PROOF_SCHEMA);
  assert.equal(output.status, "pass");
  assert.equal(output.gatewayVersion, 17);
  assert.equal(output.accountIdentifiersRecorded, false);
  assert.equal(output.credentialsPersisted, false);
  assert.equal(output.releaseActivationProven, false);
  assert.deepEqual(calls.map(x => x.url), [
    base + "/auth/registration-policy",
    origin + "/auth/registration-policy",
    origin + "/auth/session",
    base + "/health",
  ]);
  for (const { options } of calls) {
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.body, undefined);
    assert.equal(options.headers.accept, "application/json");
  }
  assert.doesNotMatch(JSON.stringify(output), /11111111|bearer|token|password/i);
});

test("missing or newly enabled public signup fails closed", async () => {
  for (const bad of [undefined, null, "true", true]) {
    const p = policy();
    if (bad === undefined) delete p.publicRegistrationEnabled;
    else p.publicRegistrationEnabled = bad;
    if (bad === true) p.registrationEnabled = true;
    await assert.rejects(
      run(fixtures({ [origin + "/auth/registration-policy"]: p })),
      /Public Web: closed registration\/policy contract not proven/,
    );
  }
});

test("Native and Web must expose the same active legal policy", async () => {
  const other = policy(); other.privacy.sha256 = "c".repeat(64);
  await assert.rejects(
    run(fixtures({ [origin + "/auth/registration-policy"]: other })),
    /legal policy projections diverge/,
  );
});

test("anonymous session, health identity and canonical origin are enforced", async () => {
  await assert.rejects(
    run(fixtures({ [origin + "/auth/session"]: { authenticated: true } })),
    /Anonymous Web session must not be authenticated/,
  );
  await assert.rejects(
    run(fixtures({ [base + "/health"]: { service: "other-gateway", version: 17 } })),
    /Unexpected Gateway health identity/,
  );
  await assert.rejects(
    proveClosedAccountBoundary({
      fetchImpl: mockGet(fixtures(), []),
      gatewayBaseUrl: base,
      publicOrigin: "https://evil.example",
    }),
    /Noncanonical public site origin/,
  );
});

test("errors do not turn an HTTP failure or invalid JSON into release approval", async () => {
  await assert.rejects(run(new Map()), /did not return HTTP 200/);
  await assert.rejects(
    proveClosedAccountBoundary({
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => "not-json" }),
      gatewayBaseUrl: base,
    }),
    /invalid JSON/,
  );
});
