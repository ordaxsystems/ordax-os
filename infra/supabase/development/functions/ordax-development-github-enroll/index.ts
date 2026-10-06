import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "ordax-development-enrollment";
const REPOSITORY = "washingtonmsdj/ordax-runtime";
const REPOSITORY_ID = "1406415790";
const WORKFLOW_REF =
  "washingtonmsdj/ordax-runtime/.github/workflows/ordax-agent-recovery.yml@refs/heads/main";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "pragma": "no-cache",
  "x-content-type-options": "nosniff",
};

type JwtHeader = {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
};

type GithubClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  iat?: unknown;
  nbf?: unknown;
  jti?: unknown;
  repository?: unknown;
  repository_id?: unknown;
  ref?: unknown;
  event_name?: unknown;
  runner_environment?: unknown;
  workflow_ref?: unknown;
  sha?: unknown;
  run_id?: unknown;
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function base64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function decodeJsonPart<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value))) as T;
}

async function githubSigningKey(kid: string): Promise<JsonWebKey> {
  const configResponse = await fetch(`${ISSUER}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
  });
  if (!configResponse.ok) throw new Error("oidc_discovery_failed");
  const config = await configResponse.json() as { jwks_uri?: unknown };
  if (typeof config.jwks_uri !== "string" || !config.jwks_uri.startsWith("https://")) {
    throw new Error("oidc_jwks_uri_invalid");
  }

  const keysResponse = await fetch(config.jwks_uri, {
    headers: { accept: "application/json" },
  });
  if (!keysResponse.ok) throw new Error("oidc_jwks_fetch_failed");
  const payload = await keysResponse.json() as { keys?: unknown };
  if (!Array.isArray(payload.keys)) throw new Error("oidc_jwks_invalid");

  const key = payload.keys.find((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const record = candidate as Record<string, unknown>;
    return record.kid === kid && record.kty === "RSA";
  });
  if (!key) throw new Error("oidc_signing_key_not_found");
  return key as JsonWebKey;
}

function audienceMatches(aud: unknown): boolean {
  return aud === AUDIENCE || (Array.isArray(aud) && aud.includes(AUDIENCE));
}

async function verifyGithubOidc(token: string): Promise<GithubClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("oidc_token_format_invalid");

  const header = decodeJsonPart<JwtHeader>(parts[0]);
  const claims = decodeJsonPart<GithubClaims>(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("oidc_header_invalid");
  }

  const jwk = await githubSigningKey(header.kid);
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) throw new Error("oidc_signature_invalid");

  const now = Math.floor(Date.now() / 1000);
  if (
    claims.iss !== ISSUER ||
    !audienceMatches(claims.aud) ||
    typeof claims.exp !== "number" ||
    typeof claims.iat !== "number" ||
    claims.exp < now - 30 ||
    claims.iat > now + 30 ||
    claims.iat < now - 600 ||
    (typeof claims.nbf === "number" && claims.nbf > now + 30)
  ) {
    throw new Error("oidc_time_or_issuer_invalid");
  }

  if (
    claims.repository !== REPOSITORY ||
    String(claims.repository_id ?? "") !== REPOSITORY_ID ||
    claims.ref !== "refs/heads/main" ||
    !["push", "workflow_dispatch"].includes(String(claims.event_name ?? "")) ||
    claims.runner_environment !== "self-hosted" ||
    claims.workflow_ref !== WORKFLOW_REF ||
    typeof claims.sha !== "string" ||
    !/^[0-9a-f]{40}$/.test(claims.sha) ||
    typeof claims.jti !== "string" ||
    claims.jti.length < 8 ||
    claims.jti.length > 200
  ) {
    throw new Error("oidc_workflow_identity_denied");
  }

  return claims;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function enroll(
  claims: GithubClaims,
  machineBindingSha256: string,
  deviceName: string,
) {
  const deviceToken = randomToken();
  const tokenSha256 = await sha256Hex(deviceToken);
  const jtiSha256 = await sha256Hex(String(claims.jti));
  const stableIdentity = `github-oidc:${machineBindingSha256}`;

  const rpcResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/ordax_enroll_github_runner_device_v1`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_stable_identity: stableIdentity,
        p_device_name: deviceName,
        p_token_sha256: tokenSha256,
        p_token_hint: deviceToken.slice(0, 8),
        p_oidc_jti_sha256: jtiSha256,
        p_repository: REPOSITORY,
        p_workflow_ref: WORKFLOW_REF,
        p_run_id: Number(claims.run_id ?? 0),
      }),
    },
  );

  const raw = await rpcResponse.text();
  if (!rpcResponse.ok) {
    console.error("github_oidc_enrollment_rpc_failed", rpcResponse.status);
    throw new Error("enrollment_rpc_failed");
  }
  const result = raw ? JSON.parse(raw) as Record<string, unknown> : {};
  if (result.ok !== true || typeof result.device_id !== "string") {
    throw new Error("enrollment_rpc_rejected");
  }

  return {
    deviceId: result.device_id,
    deviceToken,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return respond(405, { ok: false, error: "method_not_allowed" });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return respond(503, { ok: false, error: "backend_not_configured" });
  }

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Object.keys(body).some((key) =>
      !["oidc_token", "machine_binding_sha256", "device_name", "sha"].includes(key)
    )) {
      return respond(400, { ok: false, error: "request_invalid" });
    }

    const oidcToken = typeof body.oidc_token === "string" ? body.oidc_token : "";
    const machineBindingSha256 =
      typeof body.machine_binding_sha256 === "string"
        ? body.machine_binding_sha256.toLowerCase()
        : "";
    const deviceName = typeof body.device_name === "string" ? body.device_name.trim() : "";
    const sha = typeof body.sha === "string" ? body.sha.toLowerCase() : "";

    if (
      oidcToken.length < 100 ||
      oidcToken.length > 20_000 ||
      !/^[0-9a-f]{64}$/.test(machineBindingSha256) ||
      deviceName.length < 1 ||
      deviceName.length > 120 ||
      /[\x00-\x1f\x7f]/.test(deviceName) ||
      !/^[0-9a-f]{40}$/.test(sha)
    ) {
      return respond(400, { ok: false, error: "request_fields_invalid" });
    }

    const claims = await verifyGithubOidc(oidcToken);
    if (claims.sha !== sha || typeof claims.run_id !== "string" && typeof claims.run_id !== "number") {
      return respond(403, { ok: false, error: "workflow_sha_or_run_invalid" });
    }
    const runId = Number(claims.run_id);
    if (!Number.isSafeInteger(runId) || runId <= 0) {
      return respond(403, { ok: false, error: "workflow_run_invalid" });
    }
    claims.run_id = runId;

    const enrollment = await enroll(claims, machineBindingSha256, deviceName);
    return respond(200, {
      ok: true,
      protocol: "development-v2",
      control_plane: "ordax-control-plane",
      device_id: enrollment.deviceId,
      device_token: enrollment.deviceToken,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "enrollment_internal_error";
    if (code === "oidc_enrollment_replay") {
      return respond(409, { ok: false, error: code });
    }
    const denied = code.startsWith("oidc_");
    if (!denied) console.error("ordax-development-github-enroll", code);
    return respond(denied ? 403 : 500, { ok: false, error: denied ? code : "enrollment_failed" });
  }
});
