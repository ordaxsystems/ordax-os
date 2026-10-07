import {
  canonicalizeClientAddress,
  validateRateLimitRpcResult,
} from "../_shared/auth_rate_limit.mjs";

const PUBLIC_CLIENT_ADDRESS_HEADER = "x-ordax-client-address";

export function canonicalizePublicClientAddress(raw) {
  return canonicalizeClientAddress(raw);
}

export function trustedPublicClientAddress(request) {
  const address = canonicalizeClientAddress(
    request.headers.get(PUBLIC_CLIENT_ADDRESS_HEADER),
  );
  if (!address) {
    return { ok: false, code: "trusted-client-address-required" };
  }
  return { ok: true, address };
}

export { validateRateLimitRpcResult };
