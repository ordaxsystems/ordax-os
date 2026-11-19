// Uncredentialed, non-mutating production release proof for the two canonical
// Supabase Account gateways. The caller MUST already have Owner deploy approval.
// No cookies, JWTs, account IDs, side effects, or additional auth service.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export const RELEASE_NEGATIVE_CASES = Object.freeze({
  internal: Object.freeze([
    ["GET", "/account/export"],
    ["GET", "/account/subscription"],
    ["POST", "/account/profile/display-name"],
    ["POST", "/account/preferences/locale"],
    ["POST", "/account/preferences/communications"],
  ]),
  public: Object.freeze([
    ["GET", "/auth/session"],
    ["GET", "/account/export"],
    ["POST", "/account/preferences/locale"],
    ["POST", "/account/preferences/communications"],
  ]),
});

export async function proveAccountGatewayNegativeBoundary({
  mode, projectRef, request = fetch,
} = {}) {
  assert.ok(mode === "internal" || mode === "public", "gateway-mode-invalid");
  assert.match(projectRef ?? "", /^[a-z0-9]{20}$/, "gateway-project-ref-invalid");
  assert.equal(typeof request, "function", "gateway-transport-invalid");
  const functionName = mode === "internal"
    ? "ordax-account-gateway"
    : "ordax-public-account-gateway";
  const base = "https://" + projectRef + ".supabase.co/functions/v1/" + functionName;
  const status = mode === "internal" ? 401 : 403;
  const code = mode === "internal"
    ? "native-account-session-required"
    : "public-proxy-authentication-required";
  const cases = RELEASE_NEGATIVE_CASES[mode];
  for (const [method, path] of cases) {
    // The POST body is deliberately invalid: if the Auth boundary regresses,
    // a 400/415 still fails proof while no real preference can be changed.
    const response = await request(base + path, {
      method,
      headers: { accept: "application/json",
        ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(method === "POST" ? { body: "{}" } : {}),
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(12000),
    });
    const label = mode + " " + method + " " + path;
    assert.equal(response.status, status, label + ": status");
    assert.match(response.headers.get("content-type") ?? "",
      /^application\/json\b/i, label + ": content-type");
    const bytes = await response.arrayBuffer();
    assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 4096,
      label + ": bounded response");
    const value = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(value?.error, code, label + ": error");
    assert.equal(Object.hasOwn(value, "subject"), false, label + ": no subject");
    assert.equal(Object.hasOwn(value, "access_token"), false, label + ": no bearer");
    assert.equal(Object.hasOwn(value, "refresh_token"), false, label + ": no refresh token");
  }
  return Object.freeze({
    schema: "ordax.account-gateway-negative-release-proof/1",
    mode, cases: cases.length, status: "pass", authenticated_requests: 0,
    user_identifiers_collected: false, mutation_payloads_valid: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  proveAccountGatewayNegativeBoundary({
    mode: process.argv[2], projectRef: process.env.SUPABASE_PROJECT_REF,
  }).then(receipt => {
    console.log(JSON.stringify(receipt));
  }).catch(error => {
    console.error("ACCOUNT_GATEWAY_NEGATIVE_RELEASE_PROOF=FAILED:",
      String(error?.message ?? "unknown"));
    process.exitCode = 1;
  });
}
