// Canonical backend-only RPC transport for a bounded set of Account functions.
// The Supabase API gateway accepts opaque service keys via apikey; these are
// not JWTs and must never be duplicated in Authorization: Bearer.
import { readBoundedBody } from "./bounded_body.mjs";

export const ACCOUNT_RPC_NAMES = Object.freeze([
  "ordax_get_account_registration_legal_policy_v1",
  "ordax_begin_account_registration_legal_intent_v1",
  "ordax_account_has_registration_legal_receipt_v1",
  "ordax_consume_public_auth_rate_limit_v1",
]);
const ALLOWED = new Set(ACCOUNT_RPC_NAMES);
const MAX_REQUEST_BYTES = 4096;
const MAX_RESPONSE_BYTES = 16384;

export async function accountPrivilegedRpc({ url, key, name, args = {}, fetcher = fetch }) {
  const failure = code => ({ data: null, error: { code } });
  if (!ALLOWED.has(name)) return failure("account-rpc-method-forbidden");
  if (typeof key !== "string" || !key || key.length > 512 || /\s/.test(key)) {
    return failure("account-rpc-credential-invalid");
  }
  let origin;
  try {
    origin = new URL(url);
    if (origin.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/.test(origin.hostname)
      || origin.username || origin.password || origin.port || origin.search || origin.hash
      || origin.pathname !== "/" || ![origin.origin, origin.origin + "/"].includes(url)) {
      return failure("account-rpc-origin-invalid");
    }
  } catch {
    return failure("account-rpc-origin-invalid");
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return failure("account-rpc-arguments-invalid");
  }
  let body;
  try { body = JSON.stringify(args); } catch { return failure("account-rpc-arguments-invalid"); }
  if (!body || new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    return failure("account-rpc-arguments-invalid");
  }
  const headers = {
    apikey: key,
    accept: "application/json",
    "content-type": "application/json",
  };
  if (!key.startsWith("sb_secret_")) {
    // Legacy JWT service keys remain compatible during provider migration.
    // The opaque key path above never receives an Authorization header.
    if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
      return failure("account-rpc-credential-invalid");
    }
    headers.authorization = "Bearer " + key;
  }
  try {
    const response = await fetcher(
      origin.origin + "/rest/v1/rpc/" + name,
      { method: "POST", headers, body, redirect: "error",
        cache: "no-store", signal: AbortSignal.timeout(12000) },
    );
    if (!response.ok) return failure("account-rpc-upstream-unavailable");
    const bytes = await readBoundedBody(
      response.body, response.headers.get("content-length"), MAX_RESPONSE_BYTES,
    );
    return { data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), error: null };
  } catch {
    return failure("account-rpc-upstream-unavailable");
  }
}
