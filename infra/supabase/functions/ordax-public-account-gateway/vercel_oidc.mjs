import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.12";

const PUBLIC_SITE_HEADER = "x-ordax-public-site";
const VERCEL_OIDC_ISSUER = "https://oidc.vercel.com/jogo-brasils-projects";
const VERCEL_OIDC_AUDIENCE = "https://vercel.com/jogo-brasils-projects";
const VERCEL_OIDC_SUBJECT = "owner:jogo-brasils-projects:project:ordax-os-public:environment:production";
const JWT_RE = /^[A-Za-z0-9_-]{16,4096}\.[A-Za-z0-9_-]{2,16384}\.[A-Za-z0-9_-]{16,16384}$/;

const VERCEL_JWKS = createRemoteJWKSet(
  new URL("/.well-known/jwks", VERCEL_OIDC_ISSUER),
  {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
    timeoutDuration: 5_000,
  },
);

function bearerToken(request) {
  const authorization = (request.headers.get("authorization") ?? "").trim();
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return JWT_RE.test(token) ? token : null;
}

async function verifyRuntimeToken(token) {
  return jwtVerify(token, VERCEL_JWKS, {
    issuer: VERCEL_OIDC_ISSUER,
    audience: VERCEL_OIDC_AUDIENCE,
    subject: VERCEL_OIDC_SUBJECT,
    algorithms: ["RS256", "ES256"],
  });
}

export async function verifyPublicProxyIdentity(
  request,
  { verifyToken = verifyRuntimeToken } = {},
) {
  if ((request.headers.get(PUBLIC_SITE_HEADER) ?? "") !== "1") {
    return { ok: false, code: "public-proxy-authentication-required" };
  }

  const token = bearerToken(request);
  if (!token) {
    return { ok: false, code: "public-proxy-authentication-required" };
  }

  let verified;
  try {
    verified = await verifyToken(token);
  } catch {
    return { ok: false, code: "public-proxy-authentication-required" };
  }

  const payload = verified?.payload;
  if (!payload || typeof payload !== "object") {
    return { ok: false, code: "public-proxy-authentication-required" };
  }
  if (
    payload.iss !== VERCEL_OIDC_ISSUER
    || payload.aud !== VERCEL_OIDC_AUDIENCE
    || payload.sub !== VERCEL_OIDC_SUBJECT
  ) {
    return { ok: false, code: "public-proxy-authentication-required" };
  }

  return {
    ok: true,
    source: "vercel-production-oidc",
    subject: VERCEL_OIDC_SUBJECT,
  };
}

export const VERCEL_PUBLIC_PROXY_IDENTITY = Object.freeze({
  issuer: VERCEL_OIDC_ISSUER,
  audience: VERCEL_OIDC_AUDIENCE,
  subject: VERCEL_OIDC_SUBJECT,
  jwks: "https://oidc.vercel.com/.well-known/jwks",
  environment: "production",
  project: "ordax-os-public",
  team: "jogo-brasils-projects",
});
