// Shared canonical cookie policy for the signed Vercel - Supabase Edge
// boundary. Cookies belonging to Cloudflare/Supabase infrastructure are
// distinct from OrdaX product cookies; never send them in the product envelope.
const MAX_COOKIE_ENVELOPE_BYTES = 32 * 1024;
const MAX_COOKIE_COUNT = 5;
const MAX_TRANSPORT_COOKIES = 32;
const SAFE_COOKIE_NAMES = new Set([
  "ordax_access",
  "ordax_refresh",
  "ordax_recovery",
  "ordax_recovery_access",
  "ordax_recovery_refresh",
]);

export function trustedSetCookie(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 16_384) return null;
  if (/[\r\n]/.test(raw)) return null;
  const parts = raw.split(";").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 5) return null;
  const first = parts[0];
  const separator = first.indexOf("=");
  if (separator < 1) return null;
  const name = first.slice(0, separator);
  if (!SAFE_COOKIE_NAMES.has(name)) return null;

  const attributes = new Map();
  for (const part of parts.slice(1)) {
    const index = part.indexOf("=");
    const key = (index < 0 ? part : part.slice(0, index)).trim().toLowerCase();
    const value = index < 0 ? "" : part.slice(index + 1).trim();
    if (!key || attributes.has(key)) return null;
    attributes.set(key, value);
  }
  if (attributes.has("domain")) return null;
  if (!attributes.has("secure") || !attributes.has("httponly")) return null;
  const expectedPath = name.startsWith("ordax_recovery") ? "/auth/recover" : "/";
  if (attributes.get("path") !== expectedPath) return null;
  if ((attributes.get("samesite") ?? "").toLowerCase() !== "lax") return null;
  const maxAge = attributes.get("max-age");
  if (maxAge === undefined || !/^-?\d{1,10}$/.test(maxAge)) return null;
  return raw;
}

export function trustedCookieEnvelope(raw) {
  if (raw === null || raw === undefined || raw === "") return [];
  if (typeof raw !== "string") throw new TypeError("invalid-cookie-envelope");
  if (new TextEncoder().encode(raw).byteLength > MAX_COOKIE_ENVELOPE_BYTES) {
    throw new RangeError("cookie-envelope-too-large");
  }
  let values;
  try {
    values = JSON.parse(raw);
  } catch {
    throw new TypeError("invalid-cookie-envelope");
  }
  if (!Array.isArray(values) || values.length > MAX_COOKIE_COUNT) {
    throw new TypeError("invalid-cookie-envelope");
  }
  const names = new Set();
  const cookies = [];
  for (const rawCookie of values) {
    const cookie = trustedSetCookie(rawCookie);
    if (!cookie) throw new TypeError("unsafe-upstream-cookie");
    const name = cookie.slice(0, cookie.indexOf("="));
    if (names.has(name)) throw new TypeError("duplicate-upstream-cookie");
    names.add(name);
    cookies.push(cookie);
  }
  return cookies;
}


export function productCookiesFromUpstream(rawValues) {
  if (!Array.isArray(rawValues) || rawValues.length > MAX_TRANSPORT_COOKIES) {
    throw new TypeError("invalid-transport-cookie-collection");
  }
  const product = [];
  for (const raw of rawValues) {
    if (typeof raw !== "string" || !raw || raw.length > 16_384 || /[\r\n]/.test(raw)) {
      throw new TypeError("invalid-transport-cookie");
    }
    const first = raw.split(";", 1)[0];
    const separator = first.indexOf("=");
    const name = separator > 0 ? first.slice(0, separator) : "";
    if (!SAFE_COOKIE_NAMES.has(name)) {
      if (name.startsWith("ordax_")) throw new TypeError("unknown-ordax-cookie");
      // Never forward __cf_bm or any other transport/CDN cookie.
      continue;
    }
    if (!trustedSetCookie(raw)) throw new TypeError("unsafe-upstream-cookie");
    product.push(raw);
  }
  // One owner verifies duplicates, exact cookie attributes, caps and sizes.
  return trustedCookieEnvelope(JSON.stringify(product));
}
