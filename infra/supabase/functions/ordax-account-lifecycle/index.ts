import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ACCOUNT_CLOSE_ENABLED = false;
const CLOSE_CONFIRMATION = "close-account";
const MAX_BODY = 8 * 1024;
const MAX_FRESH_TOKEN_AGE_SECONDS = 5 * 60;

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

Deno.serve(async (req: Request) => {
  const path = routePath(new URL(req.url));

  if (path === "/health" && req.method === "GET") {
    return json(200, {
      status: "ok",
      service: "ordax-account-lifecycle",
      version: 1,
      accountCloseEnabled: ACCOUNT_CLOSE_ENABLED,
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
    const { error: signOutError } = await admin.auth.admin.signOut(token, "global");
    if (signOutError) {
      return error(
        409,
        "account-close-session-revocation-failed",
        "Não foi possível revogar as sessões da conta.",
      );
    }
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      return error(409, "account-close-blocked", "Não foi possível concluir o fechamento da conta.");
    }
  } catch {
    return error(503, "account-close-unavailable", "O serviço de fechamento está indisponível.");
  }

  return json(200, { closed: true });
});
