// Canonical authorization boundary between public and internal Account gateways.
// Named Supabase secret keys authenticate a service, not a user and not a JWT.
// Never allow the project's default admin key or a legacy service_role key here.
export const ACCOUNT_BRIDGE_KEY_NAME = "ordax_account_public_bridge";
// Supabase Secret API Key names permit only lowercase letters, digits and _.
// Never use a hyphen: the Dashboard refuses it and the bridge remains closed.
if (!/^[a-z0-9_]+$/.test(ACCOUNT_BRIDGE_KEY_NAME)) {
  throw new Error("invalid-supabase-named-secret");
}
const SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]{16,256}$/;

export function accountBridgeSecret(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (!Object.prototype.hasOwnProperty.call(parsed, ACCOUNT_BRIDGE_KEY_NAME)) return null;
  const key = parsed[ACCOUNT_BRIDGE_KEY_NAME];
  if (typeof key !== "string" || !SECRET_KEY_PATTERN.test(key)) return null;
  return key;
}

function constantTimeEqual(left, right) {
  const l = new TextEncoder().encode(left);
  const r = new TextEncoder().encode(right);
  if (l.byteLength !== r.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < l.length; i += 1) diff |= l[i] ^ r[i];
  return diff === 0;
}

// Caller provenance is NOT provided by the marker alone. A named secret key
// and the marker are both mandatory. No JWT/user identity is inferred here.
export function authenticatedAccountBridge(headers, rawSecretKeys) {
  let marker;
  let actual;
  try {
    marker = headers?.get?.("x-ordax-public-site");
    actual = headers?.get?.("apikey");
  } catch {
    return false;
  }
  if (marker !== "1") return false;
  if (typeof actual !== "string" || !SECRET_KEY_PATTERN.test(actual)) return false;
  const expected = accountBridgeSecret(rawSecretKeys);
  return expected !== null && constantTimeEqual(actual, expected);
}
