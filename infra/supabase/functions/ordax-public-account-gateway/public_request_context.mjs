const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_ORIGIN_LENGTH = 512;

export function normalizePublicOrigin(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_ORIGIN_LENGTH) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== "/"
  ) return null;
  return url.origin;
}

function fail(code) {
  return Object.freeze({ ok: false, code });
}

export function verifyBrowserOriginContext(request, canonicalOriginRaw) {
  const canonicalOrigin = normalizePublicOrigin(canonicalOriginRaw);
  if (!canonicalOrigin) return fail("trusted-public-origin-required");

  const browserOriginRaw = (request?.headers?.get?.("origin") ?? "").trim();
  if (browserOriginRaw) {
    const browserOrigin = normalizePublicOrigin(browserOriginRaw);
    if (!browserOrigin || browserOrigin !== canonicalOrigin) {
      return fail("browser-origin-mismatch");
    }
  }

  if (STATE_CHANGING_METHODS.has(request.method)) {
    if (!browserOriginRaw) return fail("browser-origin-required");
    const fetchSite = (request.headers.get("sec-fetch-site") ?? "").trim().toLowerCase();
    if (fetchSite !== "same-origin") return fail("same-origin-fetch-metadata-required");
  }

  return Object.freeze({ ok: true, origin: canonicalOrigin });
}

export function verifyTrustedPublicRequestContext(request) {
  const canonicalOrigin = normalizePublicOrigin(request?.headers?.get?.("x-ordax-public-origin") ?? "");
  if (!canonicalOrigin) return fail("trusted-public-origin-required");

  const canonical = new URL(canonicalOrigin);
  const forwardedProto = (request.headers.get("x-forwarded-proto") ?? "").trim().toLowerCase();
  const forwardedHost = (request.headers.get("x-forwarded-host") ?? "").trim().toLowerCase();
  if (forwardedProto !== "https" || forwardedHost !== canonical.host.toLowerCase()) {
    return fail("trusted-forwarded-authority-mismatch");
  }

  const browserContext = verifyBrowserOriginContext(request, canonicalOrigin);
  if (!browserContext.ok) return browserContext;

  return Object.freeze({
    ok: true,
    origin: canonicalOrigin,
    host: canonical.host,
  });
}

export const PUBLIC_REQUEST_CONTEXT_CONTRACT = Object.freeze({
  schema: "prototype-ordax.public-request-context/1",
  stateChangingMethods: Object.freeze([...STATE_CHANGING_METHODS]),
  exactOriginRequiredForStateChange: true,
  sameOriginFetchMetadataRequiredForStateChange: true,
  missingOriginFailsClosedForStateChange: true,
  canonicalAuthorityComesFromAuthenticatedProxy: true,
});
