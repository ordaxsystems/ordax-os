// Single admission policy for the internal Account Edge Function.
// No JWT parsing and no second identity provider: Native sessions are checked
// by the existing Supabase Auth getUser/refreshSession code at the call site.
import { authenticatedAccountBridge } from "./account_service_bridge.mjs";

// Only an exact Edge Function path segment can be removed. Searching for a
// substring in an arbitrary path lets unexpected prefixes impersonate routes.
// One exact Edge Function prefix parser serves both internal and public
// Account gateways. No substring search: malformed prefixes are not routes.
export function stripEdgeFunctionPrefix(pathname, functionName) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")
    || typeof functionName !== "string"
    || !/^[a-z][a-z0-9-]{1,79}$/.test(functionName)) return null;
  for (const prefix of [
    `/functions/v1/${functionName}`,
    `/${functionName}`,
  ]) {
    if (pathname === prefix) return "/";
    if (pathname.startsWith(prefix + "/")) return pathname.slice(prefix.length);
  }
  return null;
}

export function accountGatewayRoutePath(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return null;
  return stripEdgeFunctionPrefix(pathname, "ordax-account-gateway") ?? pathname;
}

// Shared allowlist for the signed public chain Vercel -> public Edge -> inner
// Account gateway. A named bridge key is authentication, not blanket authority
// for every Native route; all three hops enforce this same routing decision.
const PUBLIC_ACCOUNT_ROUTES = new Map([
  ["/account/export", "GET"],
  ["/account/spaces", "GET"],
  ["/account/entitlements/memory-cloud", "GET"],
  ["/account/close", "POST"],
]);
const PUBLIC_ALLOWED_METHODS = new Set(["GET", "POST"]);
const PUBLIC_ALLOWED_PREFIXES = ["/auth/", "/sync/"];

export function isPublicBridgeRoute(method, pathname) {
  if (!PUBLIC_ALLOWED_METHODS.has(method) || typeof pathname !== "string"
      || pathname.length > 2048 || !pathname.startsWith("/")
      || pathname.includes("\\") || pathname.includes("\0")
      || pathname.includes("?") || pathname.includes("#")) return false;
  const exactAccountMethod = PUBLIC_ACCOUNT_ROUTES.get(pathname);
  if (exactAccountMethod) return exactAccountMethod === method;
  return PUBLIC_ALLOWED_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

// These paths are necessarily callable before a user has a session. State-
// changing routes still require the gateway's direct Native IP/rate limit and
// all existing feature/consent gates. No /account, /sync, or /network here.
const NATIVE_BOOTSTRAP = Object.freeze({
  GET: new Set([
    "/health",
    "/auth/login",
    "/auth/register",
    "/auth/confirm",
    "/auth/registration-policy",
    "/auth/session",
    "/auth/recover/verify",
  ]),
  POST: new Set([
    "/auth/login",
    "/auth/register",
    "/auth/recover",
    "/auth/recover/complete",
    "/auth/logout",
  ]),
});

export function isNativeBootstrapRoute(method, path) {
  return NATIVE_BOOTSTRAP[method]?.has(path) === true;
}

export async function authorizeAccountTransport(req, path, {
  rawBridgeSecretKeys = "",
  verifyNativeSession,
} = {}) {
  if (!req || !req.headers || typeof path !== "string") {
    return { ok: false, code: "account-transport-untrusted" };
  }
  // The marker is a privileged provenance signal. Any presence, including
  // '0' or duplicated/malformed variants, opts into the service path and
  // cannot fall back to Native anonymous bootstrap.
  if (req.headers.has("x-ordax-public-site")) {
    if (!authenticatedAccountBridge(req.headers, rawBridgeSecretKeys)) {
      return { ok: false, code: "public-account-boundary-authentication-required" };
    }
    if (!isPublicBridgeRoute(req.method, path)) {
      return { ok: false, code: "public-account-route-not-allowed" };
    }
    return { ok: true, mode: "service" };
  }

  if (isNativeBootstrapRoute(req.method, path)) {
    return { ok: true, mode: "native-bootstrap" };
  }

  if (typeof verifyNativeSession !== "function") {
    return { ok: false, code: "native-account-session-required" };
  }
  try {
    if (await verifyNativeSession(req)) {
      return { ok: true, mode: "native-user" };
    }
  } catch {
    return { ok: false, code: "native-identity-unavailable" };
  }
  return { ok: false, code: "native-account-session-required" };
}
