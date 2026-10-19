import test from "node:test";
import assert from "node:assert/strict";
import {createNativeProductConnector} from "../system/adapters/native/product-connector.mjs";
import {validateProductConnectorSnapshot} from "../system/contracts/product-connector.mjs";

const snapshot = (enabled = false) => ({
  available: true, enabled, presenceState: enabled ? "connecting" : "disabled", accountAuthenticated: true,
  requiresClientOAuthAndGrants: true,
  remoteActionsEnabled: false, mode: "discovery-only",
});

test("Native Connector uses one typed discovery port and same-origin request", async () => {
  const calls = [];
  const windowRef = { fetch: async (url, options) => {
    calls.push({url, options});
    const enabled = options.method === "POST" ? JSON.parse(options.body).enabled : false;
    return { ok: true, json: async () => snapshot(enabled) };
  }};
  const port = await createNativeProductConnector(windowRef);
  assert.equal((await port.status()).enabled, false);
  assert.equal((await port.configure(true)).enabled, true);
  assert.equal((await port.configure(false)).enabled, false);
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.url, "/__ordax/native/product-connector");
    assert.equal(call.options.credentials, "same-origin");
    assert.equal(call.options.cache, "no-store");
  }
});

test("Reject forged action availability, mismatched policy, and invalid input", async () => {
  assert.throws(() => validateProductConnectorSnapshot({...snapshot(), remoteActionsEnabled: true}));
  assert.throws(() => validateProductConnectorSnapshot({...snapshot(), requiresClientOAuthAndGrants: false}));
  assert.throws(() => validateProductConnectorSnapshot({...snapshot(true), available: false}));
  assert.throws(() => validateProductConnectorSnapshot({...snapshot(true), presenceState: "disabled"}));
  assert.throws(() => validateProductConnectorSnapshot({...snapshot(false), presenceState: "confirmed"}));
  assert.throws(() => validateProductConnectorSnapshot({...snapshot(true), presenceState: "connected"}));
  assert.equal(validateProductConnectorSnapshot({...snapshot(true), presenceState: "confirmed"}).presenceState, "confirmed");
  const port = await createNativeProductConnector({ fetch: async () => ({
    ok: true, json: async () => snapshot(false),
  })});
  await assert.rejects(port.configure(true), /differs/);
  await assert.rejects(port.configure("yes"), TypeError);
});
