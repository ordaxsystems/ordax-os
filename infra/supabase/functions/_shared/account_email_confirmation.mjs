// Canonical OrdaX public-account email confirmation contract.
// Never send an access/refresh token into a confirmation email or URL.
export const PUBLIC_ACCOUNT_ORIGIN = "https://ordax.com.br";
export const PUBLIC_SIGNUP_REDIRECT = PUBLIC_ACCOUNT_ORIGIN + "/login/";
export const PUBLIC_CONFIRMATION_PATH = "/auth/confirm";
export const PUBLIC_CONFIRMATION_URL = PUBLIC_ACCOUNT_ORIGIN + PUBLIC_CONFIRMATION_PATH;
const EMAIL_TOKEN_HASH_RE = /^[0-9a-f]{64}$/i;

export function parseSignupConfirmation(url, routePath = PUBLIC_CONFIRMATION_PATH) {
  if (!(url instanceof URL) || routePath !== PUBLIC_CONFIRMATION_PATH) return null;
  const entries = [...url.searchParams];
  if (entries.length !== 2) return null;
  const hashes = url.searchParams.getAll("token_hash");
  const types = url.searchParams.getAll("type");
  if (hashes.length !== 1 || types.length !== 1 || types[0] !== "email") return null;
  return EMAIL_TOKEN_HASH_RE.test(hashes[0]) ? hashes[0] : null;
}
