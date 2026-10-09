// Canonical OrdaX public-account email confirmation contract.
// Never send an access/refresh token into a confirmation email or URL.
export const PUBLIC_ACCOUNT_ORIGIN = "https://ordax.com.br";
export const PUBLIC_SIGNUP_REDIRECT = PUBLIC_ACCOUNT_ORIGIN + "/login/";
export const PUBLIC_CONFIRMATION_PATH = "/auth/confirm";
export const PUBLIC_CONFIRMATION_URL = PUBLIC_ACCOUNT_ORIGIN + PUBLIC_CONFIRMATION_PATH;
// Supabase Auth's {{ .TokenHash }} is an opaque, provider-generated hex
// value. A real 2026-10-09 signup message carried 56 hex characters, not 64.
// Enforce a bounded hex encoding here; the server verifies one-time validity
// and expiry with Supabase Auth's verifyOtp (never via client-side length).
const EMAIL_TOKEN_HASH_RE = /^[0-9a-f]{32,128}$/i;

export function parseSignupConfirmation(url, routePath = PUBLIC_CONFIRMATION_PATH) {
  // Supabase Edge Functions may present the deployment prefix in req.url.
  // Resolve only the exact known function path; never accept arbitrary suffixes.
  const acceptedPaths = new Set([
    PUBLIC_CONFIRMATION_PATH,
    "/ordax-account-gateway" + PUBLIC_CONFIRMATION_PATH,
    "/functions/v1/ordax-account-gateway" + PUBLIC_CONFIRMATION_PATH,
  ]);
  if (!(url instanceof URL) || routePath !== PUBLIC_CONFIRMATION_PATH || !acceptedPaths.has(url.pathname)) return null;
  const entries = [...url.searchParams];
  if (entries.length !== 2) return null;
  const hashes = url.searchParams.getAll("token_hash");
  const types = url.searchParams.getAll("type");
  if (hashes.length !== 1 || types.length !== 1 || types[0] !== "email") return null;
  return EMAIL_TOKEN_HASH_RE.test(hashes[0]) ? hashes[0] : null;
}

// Recovery links share the same bounded, opaque token hash encoding as signup
// confirmation, but cannot be used for signup (or vice versa).
export const PUBLIC_RECOVERY_VERIFY_PATH = "/auth/recover/verify";
export const PUBLIC_RECOVERY_VERIFY_URL = PUBLIC_ACCOUNT_ORIGIN + PUBLIC_RECOVERY_VERIFY_PATH;

export function parseRecoveryLink(url, routePath = PUBLIC_RECOVERY_VERIFY_PATH) {
  const acceptedPaths = new Set([
    PUBLIC_RECOVERY_VERIFY_PATH,
    "/ordax-account-gateway" + PUBLIC_RECOVERY_VERIFY_PATH,
    "/functions/v1/ordax-account-gateway" + PUBLIC_RECOVERY_VERIFY_PATH,
  ]);
  if (!(url instanceof URL) || routePath !== PUBLIC_RECOVERY_VERIFY_PATH || !acceptedPaths.has(url.pathname)) return null;
  if ([...url.searchParams].length !== 2) return null;
  const hashes = url.searchParams.getAll("token_hash");
  const types = url.searchParams.getAll("type");
  if (hashes.length !== 1 || types.length !== 1 || types[0] !== "recovery") return null;
  return EMAIL_TOKEN_HASH_RE.test(hashes[0]) ? hashes[0] : null;
}
