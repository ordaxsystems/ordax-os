import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ACCOUNT_CLOSE_ENABLED = false;
const CLOSE_CONFIRMATION = "close-account";
const CLOSE_BAN_DURATION = "876000h";
const MAX_BODY = 8 * 1024;
const MAX_FRESH_TOKEN_AGE_SECONDS = 5 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status: number, value: unknown) {
  return new Response(JSON.stringify(value) + "\n", {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "pragma": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}

function error(status: number, code: string, message: string) {
  return json(status, { error: code, message });
}

function routePath(url: URL) {
  const marker = "/ordax-account-lifecycle";
  const index = url.pathname.indexOf(marker);
  if (index >= 0) {
    const rest = url.pathname.slice(index + marker.length);
    return rest || "/";
  }
  return url.pathname;
}

function bearer(req: Request) {
  const value = (req.headers.get("authorization") ?? "").trim();
  if (!value.startsWith("Bearer ")) return "";
  return value.slice("Bearer ".length).trim();
}

function decodeIssuedAt(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    const iat = payload?.iat;
    return Number.isSafeInteger(iat) ? iat : null;
  } catch {
    return null;
  }
}

async function boundedJson(req: Request) {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY) throw new Error("request-too-large");
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > MAX_BODY) throw new Error("request-too-large");
  const value = JSON.parse(new TextDecoder().decode(raw));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("json-object-required");
  }
  return value as Record<string, unknown>;
}

function authConfig() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anon) throw new Error("auth-unconfigured");
  return { url, anon };
}

function adminConfig() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRole) throw new Error("admin-unconfigured");
  return { url, serviceRole };
}

function exactlyOneRow(data: unknown) {
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== "object") {
    return null;
  }
  return data[0] as Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  const path = routePath(new URL(req.url));

  if (path === "/health" && req.method === "GET") {
    return json(200, {
      status: "ok",
      service: "ordax-account-lifecycle",
      version: 2,
      accountCloseEnabled: ACCOUNT_CLOSE_ENABLED,
      durableCleanupRequired: true,
    });
  }

  if (path !== "/close") {
    return error(404, "lifecycle-route-not-found", "Rota inexistente.");
  }
  if (req.method !== "POST") {
    return error(405, "method-not-allowed", "Método não permitido.");
  }
  if (!ACCOUNT_CLOSE_ENABLED) {
    return error(503, "account-close-disabled", "O fechamento de Conta OrdaX ainda não está ativado.");
  }

  let payload: Record<string, unknown>;
  try {
    payload = await boundedJson(req);
  } catch {
    return error(400, "invalid-account-close-request", "Solicitação de fechamento inválida.");
  }
  if (payload.confirmation !== CLOSE_CONFIRMATION) {
    return error(400, "account-close-confirmation-required", "Confirmação explícita obrigatória.");
  }

  const token = bearer(req);
  if (!token) {
    return error(401, "authentication-required", "Autenticação obrigatória.");
  }

  let userId = "";
  try {
    const { url, anon } = authConfig();
    const authClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error: authError } = await authClient.auth.getUser(token);
    if (authError || !data.user) {
      return error(401, "authentication-required", "Autenticação obrigatória.");
    }
    userId = data.user.id;
  } catch {
    return error(503, "account-close-unavailable", "O serviço de fechamento está indisponível.");
  }

  const issuedAt = decodeIssuedAt(token);
  const now = Math.floor(Date.now() / 1000);
  if (
    issuedAt === null ||
    issuedAt > now + 60 ||
    now - issuedAt > MAX_FRESH_TOKEN_AGE_SECONDS
  ) {
    return error(401, "recent-authentication-required", "Reautenticação recente obrigatória.");
  }

  try {
    const { url, serviceRole } = adminConfig();
    const admin = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // Persist cleanup authority and freeze cloud writes before touching Auth. The
    // journal intentionally survives auth.users deletion and copies external blob
    // references before any ON DELETE CASCADE can remove their metadata.
    const { data: beginData, error: beginError } = await admin.rpc(
      "ordax_begin_account_close_v1",
      { p_subject_user_id: userId },
    );
    const close = exactlyOneRow(beginData);
    const closeId = typeof close?.close_id === "string" ? close.close_id : "";
    if (beginError || !UUID.test(closeId)) {
      return error(
        409,
        "account-close-journal-unavailable",
        "Não foi possível iniciar o fechamento seguro da conta.",
      );
    }

    // A closing account must not be able to create a fresh session while its
    // external-object cleanup is pending. This runs only on the server-side
    // service-role client; the public gateway never receives this credential.
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: CLOSE_BAN_DURATION,
    });
    if (banError) {
      return error(
        409,
        "account-close-identity-freeze-failed",
        "Não foi possível bloquear novas sessões durante o fechamento.",
      );
    }

    const { error: signOutError } = await admin.auth.admin.signOut(token, "global");
    if (signOutError) {
      return error(
        409,
        "account-close-session-revocation-failed",
        "Não foi possível revogar as sessões da conta.",
      );
    }

    // The asynchronous cleanup worker may outlive this HTTP request. Persist the
    // Auth fence only after both the login freeze and global session revocation
    // succeeded, so a later worker can never infer that authority from cleanup
    // completion alone.
    const { data: fenceData, error: fenceError } = await admin.rpc(
      "ordax_record_account_close_auth_fence_v1",
      {
        p_close_id: closeId,
        p_subject_user_id: userId,
        p_identity_frozen: true,
        p_sessions_revoked: true,
      },
    );
    if (fenceError || fenceData !== true) {
      return error(
        409,
        "account-close-auth-fence-unavailable",
        "Não foi possível registrar com segurança a revogação da conta.",
      );
    }

    const { data: verifyData, error: verifyError } = await admin.rpc(
      "ordax_verify_account_close_cleanup_v1",
      { p_close_id: closeId, p_subject_user_id: userId },
    );
    const verification = exactlyOneRow(verifyData);
    if (verifyError || !verification) {
      return error(
        409,
        "account-close-cleanup-state-unavailable",
        "Não foi possível verificar a limpeza dos dados da conta.",
      );
    }

    if (verification.ready_for_identity_delete !== true) {
      const remaining = Number.isInteger(verification.remaining_cleanup_count)
        ? verification.remaining_cleanup_count
        : null;
      return json(202, {
        closed: false,
        cleanupPending: true,
        remainingCleanupCount: remaining,
      });
    }

    // Identity deletion is the last destructive step. It is unreachable until
    // the durable cleanup queue proves that every external provider object was
    // deleted and the durable Auth fence proves that sessions were closed.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      return error(409, "account-close-blocked", "Não foi possível concluir o fechamento da conta.");
    }

    const { data: markData, error: markError } = await admin.rpc(
      "ordax_mark_account_closed_v1",
      { p_close_id: closeId, p_subject_user_id: userId },
    );
    if (markError || markData !== true) {
      return error(
        503,
        "account-close-journal-finalization-pending",
        "A identidade foi removida, mas a finalização do comprovante de fechamento precisa ser reconciliada.",
      );
    }
  } catch {
    return error(503, "account-close-unavailable", "O serviço de fechamento está indisponível.");
  }

  return json(200, { closed: true, cleanupPending: false });
});
