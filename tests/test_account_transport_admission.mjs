import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeAccountTransport,
  accountGatewayRoutePath,
  stripEdgeFunctionPrefix,
  isNativeBootstrapRoute,
  isPublicBridgeRoute,
} from "../infra/supabase/functions/_shared/account_transport_admission.mjs";

const bridgeName = "ordax-account-public-bridge";
const bridgeKey = "sb_secret_" + "a".repeat(48);
const adminKey = "sb_secret_" + "z".repeat(48);
const bridgeEnv = JSON.stringify({ default: adminKey, [bridgeName]: bridgeKey });
const make = (path, method = "GET", headers = {}) =>
  new Request("https://example.supabase.co/functions/v1/ordax-account-gateway" + path, {
    method,
    headers,
  });

test("valid named service key is the only way to enter the public-site transport", async () => {
  const requests = [
    { key: bridgeKey, marker: "1", allowed: true },
    { key: adminKey, marker: "1", allowed: false },
    { key: "sb_secret_" + "b".repeat(48), marker: "1", allowed: false },
    { key: bridgeKey, marker: "0", allowed: false },
    { key: bridgeKey, marker: "", allowed: false },
    { key: bridgeKey, marker: undefined, allowed: false },
  ];
  for (const variant of requests) {
    const headers = { apikey: variant.key };
    if (variant.marker !== undefined) headers["x-ordax-public-site"] = variant.marker;
    let called = 0;
    const result = await authorizeAccountTransport(
      make("/account/export", "GET", headers),
      "/account/export",
      { rawBridgeSecretKeys: bridgeEnv, verifyNativeSession: async () => { called += 1; return false; } },
    );
    assert.equal(result.ok, variant.allowed);
    if (variant.allowed) assert.equal(result.mode, "service");
    else assert.equal(result.code === "public-account-boundary-authentication-required" ||
      result.code === "native-account-session-required", true);
    assert.equal(called, variant.marker === undefined ? 1 : 0);
  }
});

test("public bridge is constrained to same exact route policy at all three hops", async () => {
  const allowed = [
    ["GET", "/auth/session"], ["POST", "/auth/login"],
    ["GET", "/sync/snapshot"], ["POST", "/sync/mutate"],
    ["GET", "/account/export"], ["GET", "/account/spaces"],
    ["GET", "/account/entitlements/memory-cloud"], ["POST", "/account/close"],
  ];
  for (const [method, path] of allowed) {
    assert.equal(isPublicBridgeRoute(method, path), true, method + " " + path);
    const result = await authorizeAccountTransport(
      make(path, method, { "x-ordax-public-site": "1", apikey: bridgeKey }),
      path, { rawBridgeSecretKeys: bridgeEnv },
    );
    assert.deepEqual(result, { ok: true, mode: "service" });
  }
  const denied = [
    ["GET", "/account/close"], ["POST", "/account/export"],
    ["GET", "/account/admin"], ["POST", "/network/v2/messages/send"],
    ["POST", "/health"], ["DELETE", "/auth/session"],
    ["GET", "/account/export/other"], ["POST", "/account/spaces"],
    ["GET", "/other/auth/login"], ["GET", "/sync?x=1"],
  ];
  for (const [method, path] of denied) {
    assert.equal(isPublicBridgeRoute(method, path), false, method + " " + path);
    const result = await authorizeAccountTransport(
      make("/auth/session", method === "DELETE" ? "GET" : method,
        { "x-ordax-public-site": "1", apikey: bridgeKey }),
      path, { rawBridgeSecretKeys: bridgeEnv },
    );
    assert.deepEqual(result, { ok: false, code: "public-account-route-not-allowed" });
  }
});

test("Native privileged account, sync and network operations require verified Supabase session", async () => {
  for (const path of ["/account/export", "/account/spaces", "/sync/mutate", "/network/v2/messages/send"]) {
    let count = 0;
    const req = make(path, path.includes("mutate") || path.includes("send") ? "POST" : "GET");
    assert.deepEqual(await authorizeAccountTransport(req, path, {
      rawBridgeSecretKeys: bridgeEnv,
      verifyNativeSession: async () => { count++; return false; },
    }), { ok: false, code: "native-account-session-required" });
    const result = await authorizeAccountTransport(req, path, {
      rawBridgeSecretKeys: bridgeEnv,
      verifyNativeSession: async () => { count++; return true; },
    });
    assert.deepEqual(result, { ok: true, mode: "native-user" });
    assert.equal(count, 2);
    const fail = await authorizeAccountTransport(req, path, {
      verifyNativeSession: async () => { throw new Error("auth unavailable"); },
    });
    assert.deepEqual(fail, { ok: false, code: "native-identity-unavailable" });
  }
});

test("anonymous native bootstrap is exact method/path allowlisted, never a prefix", async () => {
  const allowed = [
    ["GET", "/health"], ["GET", "/auth/login"], ["GET", "/auth/register"],
    ["GET", "/auth/session"], ["GET", "/auth/registration-policy"],
    ["GET", "/auth/recover/verify"], ["POST", "/auth/login"],
    ["POST", "/auth/register"], ["POST", "/auth/recover"],
    ["POST", "/auth/recover/complete"], ["POST", "/auth/logout"],
  ];
  for (const [method, path] of allowed) {
    assert.equal(isNativeBootstrapRoute(method, path), true);
    assert.deepEqual(await authorizeAccountTransport(make(path, method), path), {
      ok: true, mode: "native-bootstrap",
    });
  }
  for (const [method, path] of [
    ["POST", "/auth/session"], ["GET", "/auth/login/admin"],
    ["GET", "/auth/recover"], ["GET", "/account/export"],
    ["POST", "/sync/mutate"], ["GET", "/network/"],
    ["PUT", "/auth/login"], ["GET", "/auth/logout"],
  ]) {
    assert.equal(isNativeBootstrapRoute(method, path), false);
    assert.equal((await authorizeAccountTransport(make(path, method), path)).ok, false);
  }
});

test("marker and bridge secret never fall back to native bootstrap or a bearer JWT", async () => {
  for (const marker of ["0", "true", "", "1, 1"]) {
    const req = make("/auth/login", "POST", {
      "x-ordax-public-site": marker, apikey: bridgeKey,
      authorization: "Bearer user-token",
    });
    assert.deepEqual(await authorizeAccountTransport(req, "/auth/login", {
      rawBridgeSecretKeys: bridgeEnv,
      verifyNativeSession: async () => true,
    }), { ok: false, code: "public-account-boundary-authentication-required" });
  }
  assert.equal((await authorizeAccountTransport(make("/account/export", "GET", {
    authorization: "Bearer user-token",
  }), "/account/export")).ok, false);
});

test("missing bridge configuration cannot be overridden by marker or default admin key", async () => {
  for (const rawBridgeSecretKeys of ["", "{}", JSON.stringify({ default: bridgeKey })]) {
    const response = await authorizeAccountTransport(
      make("/auth/session", "GET", {
        "x-ordax-public-site": "1", apikey: bridgeKey,
      }),
      "/auth/session",
      { rawBridgeSecretKeys, verifyNativeSession: async () => true },
    );
    assert.deepEqual(response, {
      ok: false, code: "public-account-boundary-authentication-required",
    });
  }
});

test("only the canonical Edge Function path segment maps to a privileged route", async () => {
  const legitimate = [
    ["/functions/v1/ordax-account-gateway/auth/login", "/auth/login"],
    ["/ordax-account-gateway/auth/login", "/auth/login"],
    ["/functions/v1/ordax-account-gateway", "/"],
    ["/ordax-account-gateway", "/"],
    ["/auth/login", "/auth/login"],
  ];
  for (const [pathname, expected] of legitimate) {
    assert.equal(accountGatewayRoutePath(pathname), expected);
  }
  const forgeries = [
    "/foo/ordax-account-gateway/auth/login",
    "/functions/v1/other/ordax-account-gateway/auth/login",
    "/functions/v1/ordax-account-gateway-evil/auth/login",
    "/ordax-account-gateway-evil/auth/login",
    "/functions/v1//ordax-account-gateway/auth/login",
    "/whatever/ordax-account-gateway/auth/session",
  ];
  for (const pathname of forgeries) {
    const derived = accountGatewayRoutePath(pathname);
    assert.equal(derived, pathname, `unexpected route normalization: ${pathname}`);
    const req = make("/auth/login", "POST");
    assert.equal((await authorizeAccountTransport(req, derived)).ok, false);
  }
  assert.equal(accountGatewayRoutePath(null), null);
  assert.equal(accountGatewayRoutePath("auth/login"), null);
});

test("public and internal Account boundaries share exact Edge path normalization", () => {
  for (const name of ["ordax-public-account-gateway", "ordax-account-gateway"]) {
    for (const prefix of [`/functions/v1/${name}`, `/${name}`]) {
      assert.equal(stripEdgeFunctionPrefix(prefix, name), "/");
      assert.equal(stripEdgeFunctionPrefix(prefix + "/auth/session", name), "/auth/session");
      assert.equal(stripEdgeFunctionPrefix(prefix + "/account/export", name), "/account/export");
      assert.equal(stripEdgeFunctionPrefix(prefix + "-evil/auth/login", name), null);
      assert.equal(stripEdgeFunctionPrefix("/arbitrary" + prefix + "/auth/login", name), null);
      assert.equal(stripEdgeFunctionPrefix("/functions/v1/other" + prefix + "/auth/login", name), null);
    }
  }
  for (const invalid of [null, undefined, "", "auth/login", "/somewhere"]) {
    assert.equal(stripEdgeFunctionPrefix(invalid, "ordax-public-account-gateway"), null);
  }
  assert.equal(stripEdgeFunctionPrefix("/auth/login", "bad/name"), null);
  assert.equal(stripEdgeFunctionPrefix("/auth/login", "__proto__"), null);
  assert.equal(stripEdgeFunctionPrefix("/ordax-account-gateway/auth/session", "ordax-public-account-gateway"), null);
});
