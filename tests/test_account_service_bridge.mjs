import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_BRIDGE_KEY_NAME,
  accountBridgeSecret,
  authenticatedAccountBridge,
} from "../infra/supabase/functions/_shared/account_service_bridge.mjs";

const secret = "sb_secret_" + "a".repeat(48);
const other = "sb_secret_" + "b".repeat(48);
const json = JSON.stringify({
  default: "sb_secret_" + "z".repeat(48),
  [ACCOUNT_BRIDGE_KEY_NAME]: secret,
});
const headers = (marker, apikey) => new Headers({
  ...(marker === undefined ? {} : { "x-ordax-public-site": marker }),
  ...(apikey === undefined ? {} : { apikey }),
});

test("only the dedicated named Supabase secret authenticates a marked service request", () => {
  assert.equal(ACCOUNT_BRIDGE_KEY_NAME, "ordax-account-public-bridge");
  assert.equal(accountBridgeSecret(json), secret);
  assert.equal(authenticatedAccountBridge(headers("1", secret), json), true);
  assert.equal(authenticatedAccountBridge(headers("1", other), json), false);
  assert.equal(authenticatedAccountBridge(headers("1", JSON.parse(json).default), json), false);
  assert.equal(authenticatedAccountBridge(headers("0", secret), json), false);
  assert.equal(authenticatedAccountBridge(headers(undefined, secret), json), false);
  assert.equal(authenticatedAccountBridge(headers("1", undefined), json), false);
});

test("missing named key, invalid shapes, or legacy JWTs do not authorize the bridge", () => {
  const invalid = [
    undefined, null, "", "not-json", "[]", "null", "true", "{}",
    JSON.stringify({ default: secret }),
    JSON.stringify({ [ACCOUNT_BRIDGE_KEY_NAME]: "" }),
    JSON.stringify({ [ACCOUNT_BRIDGE_KEY_NAME]: "legacy-service-role-jwt" }),
    JSON.stringify({ [ACCOUNT_BRIDGE_KEY_NAME]: "sb_publishable_" + "a".repeat(48) }),
    JSON.stringify({ [ACCOUNT_BRIDGE_KEY_NAME]: "sb_secret_short" }),
    JSON.stringify({ [ACCOUNT_BRIDGE_KEY_NAME]: "sb_secret_" + "x".repeat(300) }),
    JSON.stringify({ [ACCOUNT_BRIDGE_KEY_NAME]: secret + "\n" }),
  ];
  for (const raw of invalid) {
    assert.equal(accountBridgeSecret(raw), null);
    assert.equal(authenticatedAccountBridge(headers("1", secret), raw), false);
  }
});

test("user JWT in Authorization does not substitute for bridge service credential", () => {
  const bearer = headers("1", undefined);
  bearer.set("authorization", "Bearer a.b.c");
  assert.equal(authenticatedAccountBridge(bearer, json), false);
  const valid = headers("1", secret);
  valid.set("authorization", "Bearer a.b.c");
  assert.equal(authenticatedAccountBridge(valid, json), true);
});

test("prototype properties and untrusted headers cannot select a different secret", () => {
  assert.equal(accountBridgeSecret('{"__proto__":"sb_secret_' + "x".repeat(48) + '"}'), null);
  assert.equal(authenticatedAccountBridge(null, json), false);
  assert.equal(authenticatedAccountBridge({ get() { throw new Error("untrusted"); } }, json), false);
});
