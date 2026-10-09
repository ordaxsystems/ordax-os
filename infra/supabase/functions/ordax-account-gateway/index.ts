import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  authRateLimitBucket,
  canonicalizeClientAddress,
  validateRateLimitRpcResult,
} from "../_shared/auth_rate_limit.mjs";
import { readBoundedBody } from "../_shared/bounded_body.mjs";
import { accountPrivilegedRpc } from "../_shared/account_privileged_rpc.mjs";
import { authorizeAccountTransport, accountGatewayRoutePath } from "../_shared/account_transport_admission.mjs";

const SESSION_SCHEMA = "prototype-ordax.public-identity-session/1";
const REGISTRATION_POLICY_SCHEMA = "prototype-ordax.registration-legal-policy/1";
const ACCOUNT_SPACES_SCHEMA = "prototype-ordax.account-spaces/1";
const ENTITLEMENTS_SCHEMA = "ordax.entitlements/1";
const MEMORY_CLOUD_ENTITLEMENT = "memory.cloud.enabled";
const MAX_MEMORY_ENTITLEMENT_ROWS = 16;
const MAX_VISIBLE_SPACES = 64;
const NETWORK_MUTATION_SCHEMA = "prototype-ordax.network-mutation-outcome/2";
const NETWORK_SEND_PATH = "/network/v2/messages/send";
const MAX_NETWORK_MESSAGE_CHARACTERS = 4000;
const NETWORK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NETWORK_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,120}$/;
const NETWORK_MACHINE_CODE = /^[a-z][a-z0-9-]{2,95}$/;
const NETWORK_RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const NETWORK_UNSAFE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const NETWORK_OUTCOMES = new Set(["applied", "idempotent", "rate_limited", "denied", "invalid"]);
const PUBLIC_SITE_NETWORK_ENABLED = false;
const SYNC_BATCH_SCHEMA = "prototype-ordax.sync-batch/1";
const SYNC_SNAPSHOT_SCHEMA = "prototype-ordax.sync-snapshot/1";
const SYNC_CHANGES_SCHEMA = "prototype-ordax.sync-changes/1";
const SYNC_ACK_SCHEMA = "prototype-ordax.sync-ack/1";
const ERROR_SCHEMA = "prototype-ordax.public-identity-error/1";
const ACCESS_COOKIE = "ordax_access";
const REFRESH_COOKIE = "ordax_refresh";
const RECOVERY_COOKIE = "ordax_recovery";
const RECOVERY_ACCESS_COOKIE = "ordax_recovery_access";
const RECOVERY_REFRESH_COOKIE = "ordax_recovery_refresh";
const RECOVERY_SESSION_MAX_AGE = 10 * 60;
const MAX_BODY = 64 * 1024;
const MIN_REGISTRATION_PASSWORD_CHARS = 12;
const MAX_REGISTRATION_PASSWORD_CHARS = 256;
const PWNED_PASSWORDS_ORIGIN = "https://api.pwnedpasswords.com";
const PWNED_PASSWORDS_MAX_RESPONSE = 256 * 1024;
const PWNED_PASSWORDS_USER_AGENT = "OrdaX-Account-Gateway/1";
const PUBLIC_SITE_ACCOUNT_ENABLED = false;
const ACCOUNT_REGISTRATION_ENABLED = false;
const LEGAL_ACCEPTANCE_FIELD = "legal_acceptance";
const LEGAL_ACCEPTANCE_VALUE = "accepted";
const REGISTRATION_INTENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_SUBJECT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_CLOSE_ENABLED = false;
const ACCOUNT_RECOVERY_REQUEST_ENABLED = false;
const ACCOUNT_RECOVERY_COMPLETION_ENABLED = false;
const DATA_CLASSES = new Set([
  "appearance",
  "preferences",
  "workspace-metadata",
  "app-state-metadata",
  "user-selected-cloud-content",
]);

function json(status: number, value: unknown, cookies: string[] = []) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "pragma": "no-cache",
    "x-content-type-options": "nosniff",
  });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(value) + "\n", { status, headers });
}

function error(status: number, code: string, message: string) {
  return json(status, { $schema: ERROR_SCHEMA, error: code, message });
}

function redirectResponse(location: string, cookies: string[] = []) {
  const headers = new Headers({
    location,
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
  });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function wantsJson(req: Request) {
  const accept = (req.headers.get("accept") ?? "").toLowerCase();
  return accept.includes("application/json") && !accept.includes("text/html");
}

function parseCookies(req: Request) {
  const result = new Map<string, string>();
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) result.set(name, value);
  }
  return result;
}

function cookie(name: string, value: string, maxAge: number, path = "/") {
  return `${name}=${value}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function sessionCookies(access: string, refresh: string, expiresIn: number) {
  return [
    cookie(ACCESS_COOKIE, access, Math.max(60, expiresIn)),
    cookie(REFRESH_COOKIE, refresh, 60 * 60 * 24 * 30),
  ];
}

function clearCookies() {
  return [cookie(ACCESS_COOKIE, "", 0), cookie(REFRESH_COOKIE, "", 0)];
}

function recoveryCookies(access: string, refresh: string, expiresIn: number) {
  const maxAge = Math.max(1, Math.min(Number(expiresIn) || RECOVERY_SESSION_MAX_AGE, RECOVERY_SESSION_MAX_AGE));
  return [
    cookie(RECOVERY_ACCESS_COOKIE, access, maxAge, "/auth/recover"),
    cookie(RECOVERY_REFRESH_COOKIE, refresh, maxAge, "/auth/recover"),
    cookie(RECOVERY_COOKIE, "1", maxAge, "/auth/recover"),
  ];
}

function clearRecoveryCookies() {
  return [
    cookie(RECOVERY_ACCESS_COOKIE, "", 0, "/auth/recover"),
    cookie(RECOVERY_REFRESH_COOKIE, "", 0, "/auth/recover"),
    cookie(RECOVERY_COOKIE, "", 0, "/auth/recover"),
  ];
}

function firstNamedKey(raw: string, name: string) {
  if (!raw.trim()) return null;
  try {
    const value = JSON.parse(raw);
    const key = value && typeof value === "object" ? value[name] : null;
    return typeof key === "string" && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

function config() {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const key = firstNamedKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "", "default")
    ?? (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  if (!url || !key) throw new Error("provider-unconfigured");
  return { url, key };
}

function adminConfig() {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const key = firstNamedKey(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "", "default")
    ?? (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!url || !key) throw new Error("provider-admin-unconfigured");
  return { url, key };
}

function recoveryRedirect() {
  const value = (Deno.env.get("ORDAX_ACCOUNT_RECOVERY_REDIRECT_URL") ?? "").trim();
  if (!value) return null;
  try {
    const split = new URL(value);
    if (
      split.protocol !== "https:" ||
      !split.host ||
      split.username ||
      split.password ||
      split.search ||
      split.hash
    ) return null;
    return split.toString();
  } catch {
    return null;
  }
}

async function compromisedPasswordCount(password: string) {
  const digestBuffer = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(password),
  );
  const digest = Array.from(new Uint8Array(digestBuffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  const response = await fetch(`${PWNED_PASSWORDS_ORIGIN}/range/${prefix}`, {
    method: "GET",
    headers: {
      Accept: "text/plain",
      "Add-Padding": "true",
      "User-Agent": PWNED_PASSWORDS_USER_AGENT,
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("pwned-passwords-unavailable");
  // The remote response is attacker-controlled; never call text() first.
  const body = new TextDecoder("utf-8", { fatal: true }).decode(
    await readBoundedBody(
      response.body,
      response.headers.get("content-length"),
      PWNED_PASSWORDS_MAX_RESPONSE,
    ),
  );
  for (const line of body.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    if (line.slice(0, separator).trim().toUpperCase() !== suffix) continue;
    const count = Number(line.slice(separator + 1).trim());
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("pwned-passwords-invalid-response");
    }
    return count;
  }
  return 0;
}

async function screenNewPassword(password: string) {
  try {
    return (await compromisedPasswordCount(password)) > 0
      ? "compromised"
      : "safe";
  } catch {
    return "unavailable";
  }
}

function client(accessToken?: string) {
  const { url, key } = config();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });
}

function accountAdminRpc(name: string, args: Record<string, unknown> = {}) {
  const { url, key } = adminConfig();
  return accountPrivilegedRpc({ url, key, name, args });
}

async function registrationLegalPolicy() {
  const { data, error: rpcError } = await accountAdminRpc(
    "ordax_get_account_registration_legal_policy_v1",
    {},
  );
  if (
    rpcError
    || !Array.isArray(data)
    || data.length !== 1
    || !data[0]
  ) {
    throw new Error("registration-legal-policy-unavailable");
  }
  const item = data[0] as Record<string, unknown>;
  const validSha = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  const validVersion = (value: unknown) =>
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
  const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const validHttpsUrl = (value: unknown) => {
    if (typeof value !== "string") return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:"
        && !parsed.username
        && !parsed.password
        && !parsed.search
        && !parsed.hash;
    } catch {
      return false;
    }
  };
  if (
    typeof item.policy_id !== "string"
    || !REGISTRATION_INTENT_UUID.test(item.policy_id)
    || !validVersion(item.privacy_version)
    || !validDate(item.privacy_effective_date)
    || !validSha(item.privacy_sha256)
    || !validHttpsUrl(item.privacy_url)
    || !validVersion(item.terms_version)
    || !validDate(item.terms_effective_date)
    || !validSha(item.terms_sha256)
    || !validHttpsUrl(item.terms_url)
  ) {
    throw new Error("registration-legal-policy-invalid");
  }
  return {
    $schema: REGISTRATION_POLICY_SCHEMA,
    active: true,
    registrationEnabled: ACCOUNT_REGISTRATION_ENABLED,
    policyId: item.policy_id,
    privacy: {
      version: item.privacy_version,
      effectiveDate: item.privacy_effective_date,
      sha256: item.privacy_sha256,
      url: item.privacy_url,
    },
    terms: {
      version: item.terms_version,
      effectiveDate: item.terms_effective_date,
      sha256: item.terms_sha256,
      url: item.terms_url,
    },
  };
}

async function beginRegistrationLegalIntent(email: string, legalAcceptance: string) {
  if (legalAcceptance !== LEGAL_ACCEPTANCE_VALUE) {
    throw new Error("registration-legal-acceptance-required");
  }
  const normalized = email.trim().toLowerCase();
  const { data, error: rpcError } = await accountAdminRpc(
    "ordax_begin_account_registration_legal_intent_v1",
    {
      p_normalized_email: normalized,
      p_accepted: legalAcceptance === LEGAL_ACCEPTANCE_VALUE,
    },
  );
  if (
    rpcError
    || !Array.isArray(data)
    || data.length !== 1
    || !data[0]
    || typeof data[0].intent_id !== "string"
    || !REGISTRATION_INTENT_UUID.test(data[0].intent_id)
  ) {
    throw new Error("registration-legal-intent-unavailable");
  }
  return data[0].intent_id;
}

async function hasRegistrationLegalReceipt(userId: unknown) {
  if (typeof userId !== "string" || !ACCOUNT_SUBJECT_UUID.test(userId)) {
    throw new Error("account-subject-invalid");
  }
  const { data, error: rpcError } = await accountAdminRpc(
    "ordax_account_has_registration_legal_receipt_v1",
    { p_user_id: userId },
  );
  if (rpcError || typeof data !== "boolean") {
    throw new Error("account-legal-receipt-check-unavailable");
  }
  return data;
}

async function revokeCurrentSession(accessToken: string) {
  try {
    await client(accessToken).auth.signOut({ scope: "local" });
  } catch {
    // The session is never returned to the caller; cookie clearing still wins.
  }
}

function crossSiteStateChange(req: Request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return false;
  const fetchSite = (req.headers.get("sec-fetch-site") ?? "").toLowerCase();
  if (fetchSite === "cross-site") return true;

  const forwardedHost = (req.headers.get("x-forwarded-host") ?? "").trim().toLowerCase();
  const origin = (req.headers.get("origin") ?? "").trim();
  if (!forwardedHost || !origin) return false;
  try {
    return new URL(origin).host.toLowerCase() !== forwardedHost;
  } catch {
    return true;
  }
}

function publicSiteRequest(req: Request) {
  return (req.headers.get("x-ordax-public-site") ?? "") === "1";
}

function directNativeClientAddress(req: Request) {
  if (publicSiteRequest(req)) return null;
  return canonicalizeClientAddress(req.headers.get("cf-connecting-ip"));
}

async function enforceDirectAuthRateLimit(req: Request, path: string) {
  if (publicSiteRequest(req)) return null;
  const bucket = authRateLimitBucket(req.method, path);
  if (!bucket) return null;

  const address = directNativeClientAddress(req);
  if (!address) {
    return error(
      400,
      "native-client-address-required",
      "Endereço de origem confiável ausente.",
    );
  }

  let data: unknown;
  let rpcError: unknown;
  try {
    const result = await accountAdminRpc("ordax_consume_public_auth_rate_limit_v1", {
      p_bucket: bucket,
      p_client_address: address,
    });
    data = result.data;
    rpcError = result.error;
  } catch {
    return error(
      503,
      "auth-rate-limit-unavailable",
      "A proteção de acesso está temporariamente indisponível.",
    );
  }

  const decision = rpcError ? null : validateRateLimitRpcResult(data, bucket);
  if (!decision) {
    return error(
      503,
      "auth-rate-limit-unavailable",
      "A proteção de acesso está temporariamente indisponível.",
    );
  }
  if (decision.decision === "rate_limited") {
    const response = error(
      429,
      "auth-rate-limited",
      "Muitas tentativas. Tente novamente mais tarde.",
    );
    response.headers.set("retry-after", String(decision.retry_after_seconds));
    return response;
  }
  return null;
}

async function boundedBody(req: Request) {
  const raw = await readBoundedBody(req.body, req.headers.get("content-length"), MAX_BODY);
  return new TextDecoder().decode(raw);
}

function syncObject(item: Record<string, unknown>) {
  return {
    objectId: item.stable_object_id,
    dataClass: item.data_class,
    objectSchemaVersion: item.object_schema_version,
    resolverVersion: item.resolver_version,
    serverRevision: item.server_revision,
    tombstone: item.tombstone,
    payload: item.payload,
    updatedAt: item.updated_at ?? item.changed_at,
  };
}

// A request must resolve its Supabase session only once, including after a
// refresh: both transport admission and the route handler consume this owner.
const sessionVerificationCache = new WeakMap<Request, ReturnType<typeof resolveAuthenticated>>();

function bearerUserToken(req: Request) {
  const raw = (req.headers.get("authorization") ?? "").trim();
  if (!raw.startsWith("Bearer ")) return "";
  const value = raw.slice("Bearer ".length).trim();
  return value.length >= 32 && value.length <= 8192
    && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
    ? value : "";
}

async function resolveAuthenticated(req: Request) {
  const cookies = parseCookies(req);
  const access = cookies.get(ACCESS_COOKIE) || bearerUserToken(req);
  const refresh = cookies.get(REFRESH_COOKIE) ?? "";
  if (access) {
    const supabase = client();
    // Supabase Auth, not a locally decoded JWT, is the sole user authority.
    const { data, error } = await supabase.auth.getUser(access);
    if (!error && data.user) return { access, user: data.user, cookies: [] as string[] };
  }
  if (refresh) {
    const supabase = client();
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refresh });
    if (!error && data.session && data.user) {
      return {
        access: data.session.access_token,
        user: data.user,
        cookies: sessionCookies(data.session.access_token, data.session.refresh_token, data.session.expires_in),
      };
    }
  }
  return { access: "", user: null, cookies: clearCookies() };
}

function authenticated(req: Request) {
  let result = sessionVerificationCache.get(req);
  if (!result) {
    result = resolveAuthenticated(req);
    sessionVerificationCache.set(req, result);
  }
  return result;
}

async function authenticatedRecovery(req: Request) {
  const cookies = parseCookies(req);
  if (cookies.get(RECOVERY_COOKIE) !== "1") {
    return { access: "", user: null, cookies: clearRecoveryCookies() };
  }
  const access = cookies.get(RECOVERY_ACCESS_COOKIE);
  const refresh = cookies.get(RECOVERY_REFRESH_COOKIE);
  if (access) {
    const supabase = client(access);
    const { data, error } = await supabase.auth.getUser(access);
    if (!error && data.user) {
      return { access, user: data.user, cookies: [] as string[] };
    }
  }
  if (refresh) {
    const supabase = client();
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refresh });
    if (!error && data.session && data.user) {
      return {
        access: data.session.access_token,
        user: data.user,
        cookies: recoveryCookies(
          data.session.access_token,
          data.session.refresh_token,
          data.session.expires_in,
        ),
      };
    }
  }
  return { access: "", user: null, cookies: clearRecoveryCookies() };
}

async function recovery(req: Request) {
  if (!ACCOUNT_RECOVERY_REQUEST_ENABLED) {
    return error(503, "account-recovery-disabled", "A recuperação da Conta OrdaX ainda não foi ativada.");
  }
  const redirectTo = recoveryRedirect();
  if (!redirectTo) {
    return error(503, "account-recovery-unavailable", "A recuperação da Conta OrdaX ainda não está configurada.");
  }
  let raw = "";
  try { raw = await boundedBody(req); } catch {
    return error(413, "request-too-large", "A solicitação excede o limite permitido.");
  }
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return wantsJson(req)
      ? error(400, "invalid-recovery-form", "Revise o e-mail informado.")
      : redirectResponse("/login/?erro=recuperacao-formulario");
  }
  const form = new URLSearchParams(raw);
  const email = (form.get("email") ?? "").trim();
  if (
    email.length < 3 ||
    email.length > 320 ||
    !email.includes("@") ||
    email.includes("\n") ||
    email.includes("\r")
  ) {
    return wantsJson(req)
      ? error(400, "invalid-recovery-form", "Revise o e-mail informado.")
      : redirectResponse("/login/?erro=recuperacao-formulario");
  }

  try {
    const supabase = client();
    const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (recoveryError) {
      const status = Number(recoveryError.status ?? 0);
      if (status === 429) {
        return wantsJson(req)
          ? error(429, "account-recovery-rate-limited", "Tente novamente mais tarde.")
          : redirectResponse("/login/?erro=recuperacao-limite");
      }
      if (!status || status >= 500) {
        return wantsJson(req)
          ? error(503, "account-recovery-unavailable", "A recuperação da Conta OrdaX está temporariamente indisponível.")
          : redirectResponse("/login/?erro=recuperacao-indisponivel");
      }
      // Provider-level 4xx is intentionally normalized to avoid account enumeration.
    }
  } catch {
    return wantsJson(req)
      ? error(503, "account-recovery-unavailable", "A recuperação da Conta OrdaX está temporariamente indisponível.")
      : redirectResponse("/login/?erro=recuperacao-indisponivel");
  }

  return wantsJson(req)
    ? json(202, {
        recoveryRequested: true,
        message: "Se a conta puder ser recuperada, as instruções serão enviadas por e-mail.",
      })
    : redirectResponse("/login/?recuperacao=verifique-email");
}

async function verifyRecoveryLink(req: Request, url: URL) {
  if (!ACCOUNT_RECOVERY_COMPLETION_ENABLED) {
    return error(503, "account-recovery-completion-disabled", "A conclusão da recuperação da Conta OrdaX ainda não foi ativada.");
  }
  const tokenHash = url.searchParams.get("token_hash") ?? "";
  const recoveryType = url.searchParams.get("type") ?? "";
  if (
    recoveryType !== "recovery" ||
    tokenHash.length < 16 ||
    tokenHash.length > 2048 ||
    /\s/.test(tokenHash)
  ) {
    return error(400, "invalid-recovery-link", "O link de recuperação é inválido ou expirou.");
  }

  try {
    const supabase = client();
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    if (verifyError || !data.session) {
      return error(400, "invalid-recovery-link", "O link de recuperação é inválido ou expirou.");
    }
    const expiresIn = Math.min(
      Number(data.session.expires_in ?? RECOVERY_SESSION_MAX_AGE),
      RECOVERY_SESSION_MAX_AGE,
    );
    return redirectResponse(
      "/recuperar/nova-senha/",
      [
        ...clearCookies(),
        ...recoveryCookies(
          data.session.access_token,
          data.session.refresh_token,
          expiresIn,
        ),
      ],
    );
  } catch {
    return error(400, "invalid-recovery-link", "O link de recuperação é inválido ou expirou.");
  }
}

async function updateRecoveryPassword(req: Request) {
  if (!ACCOUNT_RECOVERY_COMPLETION_ENABLED) {
    return error(503, "account-recovery-completion-disabled", "A conclusão da recuperação da Conta OrdaX ainda não foi ativada.");
  }
  const session = await authenticatedRecovery(req);
  if (!session.user || !session.access) {
    return json(
      401,
      {
        $schema: ERROR_SCHEMA,
        error: "recovery-session-required",
        message: "Inicie novamente a recuperação da Conta OrdaX.",
      },
      session.cookies,
    );
  }

  let raw = "";
  try { raw = await boundedBody(req); } catch {
    return error(413, "request-too-large", "A solicitação excede o limite permitido.");
  }
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return error(400, "recovery-password-policy", "Use uma senha válida e confirme exatamente o mesmo valor.");
  }
  const form = new URLSearchParams(raw);
  const password = form.get("password") ?? "";
  const confirmation = form.get("password_confirmation") ?? "";
  if (
    password !== confirmation ||
    password.length < MIN_REGISTRATION_PASSWORD_CHARS ||
    password.length > MAX_REGISTRATION_PASSWORD_CHARS ||
    password.includes("\0")
  ) {
    return error(400, "recovery-password-policy", "Use uma senha válida e confirme exatamente o mesmo valor.");
  }

  const screening = await screenNewPassword(password);
  if (screening === "compromised") {
    return error(400, "compromised-password", "Escolha outra senha; esta senha aparece em bases públicas de credenciais comprometidas.");
  }
  if (screening === "unavailable") {
    return error(503, "password-screening-unavailable", "A validação de segurança da senha está temporariamente indisponível.");
  }

  try {
    const { url, key } = config();
    const response = await fetch(`${url}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: key,
        Authorization: `Bearer ${session.access}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      if (response.status === 429) {
        return error(429, "account-recovery-rate-limited", "Tente novamente mais tarde.");
      }
      return error(503, "account-recovery-unavailable", "Não foi possível concluir a recuperação da Conta OrdaX.");
    }
    try {
      await client(session.access).auth.signOut({ scope: "global" });
    } catch {
      // Password was already changed; local cookie clearing still wins.
    }
  } catch {
    return error(503, "account-recovery-unavailable", "Não foi possível concluir a recuperação da Conta OrdaX.");
  }

  return wantsJson(req)
    ? json(
        200,
        { recoveryCompleted: true },
        [...clearCookies(), ...clearRecoveryCookies()],
      )
    : redirectResponse(
        "/login/?recuperacao=concluida",
        [...clearCookies(), ...clearRecoveryCookies()],
      );
}

async function closeAccount(req: Request) {
  if (!ACCOUNT_CLOSE_ENABLED) {
    return error(503, "account-close-disabled", "O fechamento da Conta OrdaX ainda não está ativado.");
  }

  const session = await authenticated(req);
  if (!session.user || !session.access || !session.user.email) {
    return json(401, {
      $schema: ERROR_SCHEMA,
      error: "authentication-required",
      message: "Entre novamente na Conta OrdaX.",
    }, session.cookies);
  }

  let raw = "";
  try {
    raw = await boundedBody(req);
  } catch {
    return error(413, "request-too-large", "A solicitação excede o limite permitido.");
  }
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/x-www-form-urlencoded")) {
    return error(400, "invalid-account-close-request", "Solicitação de fechamento inválida.");
  }
  const form = new URLSearchParams(raw);
  const password = form.get("password") ?? "";
  const confirmation = form.get("confirmation") ?? "";
  if (!password || confirmation !== "close-account") {
    return error(
      400,
      "account-close-confirmation-required",
      "Confirmação explícita e senha atual são obrigatórias.",
    );
  }

  const authClient = client();
  const { data: fresh, error: reauthError } = await authClient.auth.signInWithPassword({
    email: session.user.email,
    password,
  });
  if (reauthError || !fresh.session) {
    return error(401, "recent-authentication-required", "Confirme sua senha atual para fechar a conta.");
  }

  const { url, key } = config();
  let lifecycleResponse: Response;
  try {
    lifecycleResponse = await fetch(url + "/functions/v1/ordax-account-lifecycle/close", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": key,
        "authorization": "Bearer " + fresh.session.access_token,
      },
      body: JSON.stringify({ confirmation: "close-account" }),
    });
  } catch {
    return error(503, "account-close-unavailable", "O serviço de fechamento está indisponível.");
  }

  if (!lifecycleResponse.ok) {
    let code = "account-close-unavailable";
    try {
      const payload = await lifecycleResponse.json();
      if (payload && typeof payload.error === "string") code = payload.error;
    } catch {
      // Keep a neutral error code.
    }
    if (lifecycleResponse.status === 401) {
      return error(401, "recent-authentication-required", "Reautenticação recente obrigatória.");
    }
    if (lifecycleResponse.status === 409) {
      return error(409, "account-close-blocked", "Não foi possível concluir o fechamento da conta.");
    }
    return error(503, code, "O serviço de fechamento está indisponível.");
  }

  return wantsJson(req)
    ? json(200, { closed: true }, [...clearCookies(), ...clearRecoveryCookies()])
    : redirectResponse("/", [...clearCookies(), ...clearRecoveryCookies()]);
}

async function credentials(req: Request, register: boolean) {
  if (register && !ACCOUNT_REGISTRATION_ENABLED) {
    return error(
      503,
      "account-registration-disabled",
      "A criação de Conta OrdaX ainda não foi ativada.",
    );
  }
  let raw = "";
  try { raw = await boundedBody(req); } catch { return error(413, "request-too-large", "A solicitação excede o limite permitido."); }
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return wantsJson(req)
      ? error(400, "invalid-credentials-form", "Revise o e-mail e a senha informados.")
      : redirectResponse(register ? "/cadastro/?erro=formulario" : "/login/?erro=formulario");
  }
  const form = new URLSearchParams(raw);
  const email = (form.get("email") ?? "").trim();
  const password = form.get("password") ?? "";
  const legalAcceptance = form.get(LEGAL_ACCEPTANCE_FIELD) ?? "";
  if (!email || !password) {
    return wantsJson(req)
      ? error(400, "invalid-credentials-form", "Revise o e-mail e a senha informados.")
      : redirectResponse(register ? "/cadastro/?erro=formulario" : "/login/?erro=formulario");
  }
  if (register && legalAcceptance !== LEGAL_ACCEPTANCE_VALUE) {
    return wantsJson(req)
      ? error(
          400,
          "registration-legal-acceptance-required",
          "Confirme o aceite da Política de Privacidade e dos Termos para criar a Conta OrdaX.",
        )
      : redirectResponse("/cadastro/?erro=aceite-legal");
  }
  if (
    register &&
    (password.length < MIN_REGISTRATION_PASSWORD_CHARS ||
      password.length > MAX_REGISTRATION_PASSWORD_CHARS)
  ) {
    return wantsJson(req)
      ? error(400, "registration-password-policy", "Use uma senha com pelo menos 12 caracteres.")
      : redirectResponse("/cadastro/?erro=senha");
  }

  if (register) {
    const screening = await screenNewPassword(password);
    if (screening === "compromised") {
      return wantsJson(req)
        ? error(400, "compromised-password", "Escolha outra senha; esta senha aparece em bases públicas de credenciais comprometidas.")
        : redirectResponse("/cadastro/?erro=senha-comprometida");
    }
    if (screening === "unavailable") {
      return wantsJson(req)
        ? error(503, "password-screening-unavailable", "A validação de segurança da senha está temporariamente indisponível.")
        : redirectResponse("/cadastro/?erro=seguranca-indisponivel");
    }
  }

  const supabase = client();
  let registrationIntentId: string | null = null;
  if (register) {
    try {
      registrationIntentId = await beginRegistrationLegalIntent(email, legalAcceptance);
    } catch {
      return wantsJson(req)
        ? error(503, "registration-legal-policy-unavailable", "A política legal de cadastro ainda não está disponível.")
        : redirectResponse("/cadastro/?erro=politica-legal-indisponivel");
    }
  }
  const result = register
    ? await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            ordax_registration_intent_id: registrationIntentId,
          },
        },
      })
    : await supabase.auth.signInWithPassword({ email, password });

  if (result.error) {
    if (!wantsJson(req)) {
      return redirectResponse(register ? "/cadastro/?erro=cadastro" : "/login/?erro=credenciais");
    }
    return error(register ? 400 : 401, register ? "registration-failed" : "authentication-failed", "Não foi possível concluir esta operação de conta.");
  }
  if (!result.data.session) {
    return wantsJson(req)
      ? json(202, { authenticated: false, confirmationRequired: true })
      : redirectResponse("/login/?cadastro=verifique-email");
  }

  if (!register && publicSiteRequest(req)) {
    let legalReceiptPresent = false;
    try {
      legalReceiptPresent = await hasRegistrationLegalReceipt(result.data.user?.id);
    } catch {
      await revokeCurrentSession(result.data.session.access_token);
      return wantsJson(req)
        ? error(
            503,
            "account-legal-receipt-check-unavailable",
            "A validação da Conta OrdaX está temporariamente indisponível.",
          )
        : redirectResponse("/login/?erro=validacao-conta-indisponivel");
    }
    if (!legalReceiptPresent) {
      await revokeCurrentSession(result.data.session.access_token);
      return wantsJson(req)
        ? error(
            403,
            "account-legal-receipt-required",
            "Esta conta precisa ser reconciliada antes do acesso público.",
          )
        : redirectResponse("/login/?erro=conta-requer-reconciliacao");
    }
  }

  const cookies = sessionCookies(
    result.data.session.access_token,
    result.data.session.refresh_token,
    result.data.session.expires_in,
  );
  return wantsJson(req)
    ? json(200, { authenticated: true, confirmationRequired: false }, cookies)
    : redirectResponse("/conta/", cookies);
}

function exactObjectKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validNetworkOutcomeRow(value: unknown, expectedIdempotencyKey: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!exactObjectKeys(row, [
    "schema",
    "outcome",
    "operation",
    "code",
    "resource_id",
    "retry_after_seconds",
    "idempotency_key",
  ])) return false;
  if (row.schema !== NETWORK_MUTATION_SCHEMA || row.operation !== "message-send") return false;
  if (typeof row.outcome !== "string" || !NETWORK_OUTCOMES.has(row.outcome)) return false;
  if (typeof row.code !== "string" || !NETWORK_MACHINE_CODE.test(row.code)) return false;
  if (row.idempotency_key !== expectedIdempotencyKey) return false;

  const successLike = row.outcome === "applied" || row.outcome === "idempotent";
  if (successLike) {
    if (typeof row.resource_id !== "string" || !NETWORK_RESOURCE_ID.test(row.resource_id)) return false;
  } else if (row.resource_id !== null) {
    return false;
  }

  if (row.outcome === "rate_limited") {
    if (
      !Number.isInteger(row.retry_after_seconds)
      || Number(row.retry_after_seconds) < 1
      || Number(row.retry_after_seconds) > 86400
    ) return false;
  } else if (row.retry_after_seconds !== null) {
    return false;
  }
  return true;
}

async function sendNetworkMessage(req: Request) {
  let session;
  try {
    session = await authenticated(req);
  } catch {
    return error(503, "network-identity-unavailable", "A identidade da Rede OrdaX está temporariamente indisponível.");
  }
  if (!session.user || !session.access) {
    return json(401, {
      $schema: ERROR_SCHEMA,
      error: "authentication-required",
      message: "Entre na Conta OrdaX para enviar mensagens.",
    }, session.cookies);
  }

  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return error(400, "invalid-network-send-request", "A solicitação de envio é inválida.");
  }

  let request: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await boundedBody(req));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object-required");
    request = parsed as Record<string, unknown>;
  } catch {
    return error(400, "invalid-network-send-request", "A solicitação de envio é inválida.");
  }

  if (
    !exactObjectKeys(request, ["space_id", "conversation_id", "idempotency_key", "body"])
    || typeof request.space_id !== "string"
    || !NETWORK_UUID.test(request.space_id)
    || typeof request.conversation_id !== "string"
    || !NETWORK_UUID.test(request.conversation_id)
    || typeof request.idempotency_key !== "string"
    || !NETWORK_IDEMPOTENCY_KEY.test(request.idempotency_key)
    || typeof request.body !== "string"
    || request.body.length < 1
    || request.body.length > MAX_NETWORK_MESSAGE_CHARACTERS
    || NETWORK_UNSAFE_CONTROL.test(request.body)
    || request.body.trim().length < 1
  ) {
    return error(400, "invalid-network-send-request", "A solicitação de envio é inválida.");
  }

  try {
    const supabase = client(session.access);
    const { data, error: rpcError } = await supabase.rpc("ordax_network_send_message_v2", {
      p_space_id: request.space_id,
      p_conversation_id: request.conversation_id,
      p_client_idempotency_key: request.idempotency_key,
      p_body: request.body,
    });
    if (
      rpcError
      || !Array.isArray(data)
      || data.length !== 1
      || !validNetworkOutcomeRow(data[0], request.idempotency_key)
    ) {
      return error(502, "network-send-failed", "Não foi possível concluir o envio pela Rede OrdaX.");
    }
    return json(200, data[0], session.cookies);
  } catch {
    return error(503, "network-unavailable", "A Rede OrdaX está temporariamente indisponível.");
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = accountGatewayRoutePath(url.pathname) ?? "";

  if (crossSiteStateChange(req)) {
    return error(403, "cross-site-request-rejected", "Solicitação de outra origem rejeitada.");
  }

  // Must run before Native rate-limit bypass and before any route handler.
  // Public calls prove the named service key; Native sessions are verified
  // by Supabase Auth itself and then reused by the route handler.
  const transport = await authorizeAccountTransport(req, path, {
    rawBridgeSecretKeys: Deno.env.get("SUPABASE_SECRET_KEYS") ?? "",
    verifyNativeSession: async () => {
      const session = await authenticated(req);
      return Boolean(session.user && session.access);
    },
  });
  if (!transport.ok) {
    const transportCode = transport.code ?? "account-transport-untrusted";
    if (transportCode === "public-account-boundary-authentication-required") {
      return error(403, transportCode, "Boundary público não autenticado.");
    }
    if (transportCode === "native-identity-unavailable") {
      return error(503, transportCode, "O serviço de identidade OrdaX está indisponível.");
    }
    return error(401, transportCode, "Autenticação da Conta OrdaX obrigatória.");
  }

  const directRateLimitResponse = await enforceDirectAuthRateLimit(req, path);
  if (directRateLimitResponse) return directRateLimitResponse;

  if (publicSiteRequest(req) && path.startsWith("/network/") && !PUBLIC_SITE_NETWORK_ENABLED) {
    return error(503, "public-network-access-disabled", "A Rede OrdaX pública ainda não foi ativada.");
  }

  if (publicSiteRequest(req) && !PUBLIC_SITE_ACCOUNT_ENABLED) {
    if (path === "/auth/login" && req.method === "GET") return redirectResponse("/login/");
    if (path === "/auth/register" && req.method === "GET") return redirectResponse("/cadastro/");
    if (path === "/auth/logout" && req.method === "POST") {
      return wantsJson(req)
        ? json(200, { signedOut: true }, clearCookies())
        : redirectResponse("/", clearCookies());
    }
    if (path === "/auth/registration-policy" && req.method === "GET") {
      try {
        return json(200, await registrationLegalPolicy());
      } catch {
        return error(503, "registration-legal-policy-unavailable", "A política legal de cadastro ainda não está disponível.");
      }
    }
    if (path === "/auth/session" && req.method === "GET") {
      return json(200, {
        $schema: SESSION_SCHEMA,
        authenticated: false,
        provider: "gated",
        status: "anonymous",
        accountCloseEnabled: false,
      }, clearCookies());
    }
    if (path.startsWith("/auth/") || path.startsWith("/sync/") || path.startsWith("/account/")) {
      return error(503, "public-account-access-disabled", "O acesso público à Conta OrdaX ainda não foi ativado.");
    }
  }

  if (path === "/health" && req.method === "GET") {
    return json(200, { status: "ok", service: "ordax-account-gateway", version: 17 });
  }

  if (path === NETWORK_SEND_PATH && req.method === "POST") {
    return sendNetworkMessage(req);
  }

  if (path === "/auth/registration-policy" && req.method === "GET") {
    try {
      return json(200, await registrationLegalPolicy());
    } catch {
      return error(503, "registration-legal-policy-unavailable", "A política legal de cadastro ainda não está disponível.");
    }
  }

  if (path === "/auth/session" && req.method === "GET") {
    try {
      const session = await authenticated(req);
      if (!session.user) {
        return json(200, {
          $schema: SESSION_SCHEMA,
          authenticated: false,
          provider: "supabase",
          status: "anonymous",
          accountCloseEnabled: false,
        }, session.cookies);
      }
      return json(200, {
        $schema: SESSION_SCHEMA,
        authenticated: true,
        provider: "supabase",
        status: "authenticated",
        subject: session.user.id,
        email: session.user.email ?? null,
        accountCloseEnabled: ACCOUNT_CLOSE_ENABLED,
      }, session.cookies);
    } catch {
      return error(503, "identity-provider-unavailable", "O serviço de identidade OrdaX está indisponível.");
    }
  }

  if (path === "/auth/login" && req.method === "GET") return redirectResponse("/login/");
  if (path === "/auth/register" && req.method === "GET") return redirectResponse("/cadastro/");
  if (path === "/auth/login" && req.method === "POST") return credentials(req, false);
  if (path === "/auth/register" && req.method === "POST") return credentials(req, true);
  if (path === "/auth/recover" && req.method === "POST") return recovery(req);
  if (path === "/auth/recover/verify" && req.method === "GET") return verifyRecoveryLink(req, url);
  if (path === "/auth/recover/complete" && req.method === "POST") return updateRecoveryPassword(req);

  if (path === "/auth/logout" && req.method === "POST") {
    try {
      const access = parseCookies(req).get(ACCESS_COOKIE);
      if (access) await client(access).auth.signOut({ scope: "local" });
    } catch {
      // Idempotent logout: cookie removal still wins.
    }
    return wantsJson(req)
      ? json(200, { signedOut: true }, [...clearCookies(), ...clearRecoveryCookies()])
      : redirectResponse("/", [...clearCookies(), ...clearRecoveryCookies()]);
  }


  if (path === "/account/close" && req.method === "POST") {
    return closeAccount(req);
  }

  if (path === "/account/export" && req.method === "GET") {
    const session = await authenticated(req);
    if (!session.user || !session.access) {
      return json(401, {
        $schema: ERROR_SCHEMA,
        error: "authentication-required",
        message: "Entre na Conta OrdaX para exportar seus dados.",
      }, session.cookies);
    }
    const supabase = client(session.access);
    const { data, error: rpcError } = await supabase.rpc("ordax_account_export_v1");
    if (
      rpcError ||
      !data ||
      typeof data !== "object" ||
      data.$schema !== "prototype-ordax.account-export/1"
    ) {
      return error(502, "account-export-failed", "Não foi possível gerar a exportação da Conta OrdaX.");
    }
    return json(200, data, session.cookies);
  }

  if (path === "/account/spaces" && req.method === "GET") {
    const session = await authenticated(req);
    if (!session.user || !session.access) {
      return json(401, {
        $schema: ERROR_SCHEMA,
        error: "authentication-required",
        message: "Entre na Conta OrdaX para ver seus Spaces.",
      }, session.cookies);
    }

    const supabase = client(session.access);
    const [spacesResult, packsResult] = await Promise.all([
      supabase
        .from("ordax_spaces")
        .select("space_id,owner_user_id,name,kind,state")
        .order("created_at", { ascending: true })
        .limit(MAX_VISIBLE_SPACES + 1),
      supabase
        .from("ordax_space_profile_packs")
        .select("space_id,pack_slug,pack_version")
        .limit(MAX_VISIBLE_SPACES + 1),
    ]);

    if (
      spacesResult.error ||
      packsResult.error ||
      !Array.isArray(spacesResult.data) ||
      !Array.isArray(packsResult.data) ||
      spacesResult.data.length > MAX_VISIBLE_SPACES ||
      packsResult.data.length > MAX_VISIBLE_SPACES
    ) {
      return error(502, "spaces-read-failed", "Não foi possível ler seus Spaces.");
    }

    const packBySpace = new Map<string, string>();
    for (const raw of packsResult.data as Array<Record<string, unknown>>) {
      if (
        typeof raw.space_id !== "string" ||
        typeof raw.pack_slug !== "string" ||
        raw.pack_slug.length < 1 ||
        raw.pack_slug.length > 160 ||
        !Number.isSafeInteger(Number(raw.pack_version)) ||
        Number(raw.pack_version) < 1 ||
        packBySpace.has(raw.space_id)
      ) {
        return error(502, "spaces-read-failed", "Não foi possível validar seus Spaces.");
      }
      packBySpace.set(raw.space_id, raw.pack_slug);
    }

    const spaces = [];
    for (const raw of spacesResult.data as Array<Record<string, unknown>>) {
      if (
        typeof raw.space_id !== "string" ||
        typeof raw.owner_user_id !== "string" ||
        typeof raw.name !== "string" ||
        raw.name.length < 1 ||
        raw.name.length > 120 ||
        !["personal", "work", "professional"].includes(String(raw.kind)) ||
        !["active", "archived"].includes(String(raw.state))
      ) {
        return error(502, "spaces-read-failed", "Não foi possível validar seus Spaces.");
      }
      spaces.push({
        id: raw.space_id,
        ownerId: raw.owner_user_id,
        name: raw.name,
        kind: raw.kind,
        state: raw.state,
        profilePack: packBySpace.get(raw.space_id) ?? null,
      });
    }

    return json(200, { $schema: ACCOUNT_SPACES_SCHEMA, spaces }, session.cookies);
  }

  if (path === "/account/entitlements/memory-cloud") {
    if (req.method !== "GET") {
      return error(405, "method-not-allowed", "Método não permitido.");
    }
    let session;
    try {
      session = await authenticated(req);
    } catch {
      return error(503, "identity-provider-unavailable", "O serviço de identidade OrdaX está indisponível.");
    }
    if (!session.user || !session.access) {
      return json(401, {
        $schema: ERROR_SCHEMA,
        error: "authentication-required",
        message: "Entre na Conta OrdaX para consultar este entitlement.",
      }, session.cookies);
    }

    const supabase = client(session.access);
    const entitlementResult = await supabase
      .from("ordax_entitlement_grants")
      .select("entitlement_value,valid_from,valid_until")
      .eq("user_id", session.user.id)
      .eq("entitlement_key", MEMORY_CLOUD_ENTITLEMENT)
      .limit(MAX_MEMORY_ENTITLEMENT_ROWS + 1);

    if (
      entitlementResult.error ||
      !Array.isArray(entitlementResult.data) ||
      entitlementResult.data.length > MAX_MEMORY_ENTITLEMENT_ROWS
    ) {
      return error(502, "memory-entitlement-read-failed", "Não foi possível consultar o entitlement de Memory.");
    }

    const now = Date.now();
    let allowed = false;
    for (const raw of entitlementResult.data as Array<Record<string, unknown>>) {
      const entitlement = raw.entitlement_value;
      const validFrom = typeof raw.valid_from === "string" ? Date.parse(raw.valid_from) : Number.NaN;
      const validUntil = raw.valid_until === null
        ? null
        : typeof raw.valid_until === "string"
          ? Date.parse(raw.valid_until)
          : Number.NaN;
      if (
        !entitlement ||
        typeof entitlement !== "object" ||
        Array.isArray(entitlement) ||
        !Number.isFinite(validFrom) ||
        (validUntil !== null && !Number.isFinite(validUntil)) ||
        (validUntil !== null && validUntil <= validFrom)
      ) {
        return error(502, "memory-entitlement-read-failed", "Não foi possível validar o entitlement de Memory.");
      }
      if (
        (entitlement as Record<string, unknown>).decision === "allowed" &&
        validFrom <= now &&
        (validUntil === null || validUntil > now)
      ) {
        allowed = true;
      }
    }

    return json(200, {
      schema: ENTITLEMENTS_SCHEMA,
      subjectType: "account",
      subjectId: session.user.id,
      key: MEMORY_CLOUD_ENTITLEMENT,
      decision: allowed ? "allowed" : "denied",
      value: null,
      authority: "server",
      expiresAt: null,
    }, session.cookies);
  }

  if (path === "/sync/snapshot" && req.method === "GET") {
    const session = await authenticated(req);
    if (!session.user || !session.access) {
      return json(401, { $schema: ERROR_SCHEMA, error: "authentication-required", message: "Entre na Conta OrdaX para sincronizar." }, session.cookies);
    }
    const limit = Number(url.searchParams.get("limit") ?? "200");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return error(400, "invalid-sync-query", "Consulta de sincronização inválida.");
    }
    const supabase = client(session.access);
    const { data, error: rpcError } = await supabase.rpc("ordax_sync_snapshot_v1", {
      p_limit: limit,
    });
    if (
      rpcError ||
      !data ||
      typeof data !== "object" ||
      !Number.isSafeInteger(Number(data.cursor)) ||
      !Array.isArray(data.objects)
    ) return error(502, "sync-snapshot-failed", "Não foi possível ler o snapshot sincronizado.");

    return json(200, {
      $schema: SYNC_SNAPSHOT_SCHEMA,
      cursor: Number(data.cursor),
      objects: data.objects.map((item: Record<string, unknown>) => syncObject(item)),
    }, session.cookies);
  }

  if (path === "/sync/changes" && req.method === "GET") {
    const session = await authenticated(req);
    if (!session.user || !session.access) {
      return json(401, { $schema: ERROR_SCHEMA, error: "authentication-required", message: "Entre na Conta OrdaX para sincronizar." }, session.cookies);
    }
    const afterCursor = Number(url.searchParams.get("afterCursor") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "200");
    if (
      !Number.isSafeInteger(afterCursor) || afterCursor < 0 ||
      !Number.isInteger(limit) || limit < 1 || limit > 500
    ) return error(400, "invalid-sync-query", "Consulta de sincronização inválida.");

    const supabase = client(session.access);
    const { data, error: rpcError } = await supabase.rpc("ordax_pull_sync_changes_v1", {
      p_after_cursor: afterCursor,
      p_limit: limit,
    });
    if (rpcError || !Array.isArray(data)) {
      return error(502, "sync-pull-failed", "Não foi possível ler as mudanças sincronizadas.");
    }
    const changes = data.map((item: Record<string, unknown>) => ({
      cursor: Number(item.change_cursor),
      ...syncObject(item),
    }));
    const nextCursor = changes.length ? changes[changes.length - 1].cursor : afterCursor;
    return json(200, {
      $schema: SYNC_CHANGES_SCHEMA,
      afterCursor,
      nextCursor,
      changes,
    }, session.cookies);
  }

  if (path === "/sync/objects" && req.method === "GET") {
    const session = await authenticated(req);
    if (!session.user || !session.access) {
      return json(401, { $schema: ERROR_SCHEMA, error: "authentication-required", message: "Entre na Conta OrdaX para sincronizar." }, session.cookies);
    }
    const after = Number(url.searchParams.get("afterRevision") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "200");
    if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) {
      return error(400, "invalid-sync-query", "Consulta de sincronização inválida.");
    }
    const supabase = client(session.access);
    const { data, error: rpcError } = await supabase.rpc("ordax_list_sync_objects_v1", {
      p_after_revision: after,
      p_limit: limit,
    });
    if (rpcError || !Array.isArray(data)) return error(502, "sync-read-failed", "Não foi possível ler o estado sincronizado.");
    const objects = data.map((item: Record<string, unknown>) => syncObject(item));
    return json(200, { $schema: SYNC_BATCH_SCHEMA, objects }, session.cookies);
  }

  if (path === "/sync/mutate" && req.method === "POST") {
    const session = await authenticated(req);
    if (!session.user || !session.access) {
      return json(401, { $schema: ERROR_SCHEMA, error: "authentication-required", message: "Entre na Conta OrdaX para sincronizar." }, session.cookies);
    }
    let mutation: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(await boundedBody(req));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new TypeError("sync-mutation-object-required");
      }
      mutation = parsed as Record<string, unknown>;
    } catch {
      return error(400, "invalid-sync-mutation", "A alteração de sincronização é inválida.");
    }
    if (
      mutation.$schema !== "ordax.sync-mutation/1" ||
      typeof mutation.dataClass !== "string" ||
      !DATA_CLASSES.has(mutation.dataClass)
    ) return error(400, "invalid-sync-mutation", "A alteração de sincronização é inválida.");

    const supabase = client(session.access);
    const { data, error: rpcError } = await supabase.rpc("ordax_apply_sync_mutation_v2", {
      p_idempotency_key: mutation.idempotencyKey,
      p_data_class: mutation.dataClass,
      p_stable_object_id: mutation.objectId,
      p_object_schema_version: mutation.objectSchemaVersion,
      p_resolver_version: mutation.resolverVersion ?? 1,
      p_base_server_revision: mutation.baseServerRevision,
      p_tombstone: mutation.operation === "delete",
      p_payload: mutation.payload ?? {},
    });
    if (rpcError || !Array.isArray(data) || data.length !== 1) return error(502, "sync-write-failed", "Não foi possível gravar o estado sincronizado.");
    const item = data[0] as Record<string, unknown>;
    return json(200, {
      $schema: SYNC_ACK_SCHEMA,
      objectId: mutation.objectId,
      dataClass: mutation.dataClass,
      serverRevision: item.server_revision,
      tombstone: item.tombstone,
      applied: item.applied,
      conflict: item.conflict,
      changeCursor: item.change_cursor === null ? null : Number(item.change_cursor),
    }, session.cookies);
  }

  if (
    (path.startsWith("/auth/") || path.startsWith("/sync/") || path.startsWith("/account/") || path.startsWith("/network/")) &&
    !["GET", "POST"].includes(req.method)
  ) {
    return error(405, "method-not-allowed", "Método não permitido.");
  }
  return error(404, "gateway-route-not-found", "Rota inexistente.");
});
