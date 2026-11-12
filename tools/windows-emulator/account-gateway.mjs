import { validateIdentityCredentialInput, validateIdentityRegistrationInput } from "../../system/contracts/identity-credentials.mjs";
import { validateEntitlementDecision } from "../../system/contracts/entitlements.mjs";
import { validateAccountCloseRequest } from "../../system/contracts/account-lifecycle.mjs";
import { validateSpaceCreateCommand, validateSpaceCreateReceipt } from "../../system/contracts/space-creation.mjs";

const SESSION_SCHEMA = "prototype-ordax.public-identity-session/1";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_CREDENTIAL_BYTES = 4 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MEMORY_ENTITLEMENT_BYTES = 16 * 1024;
const MAX_NETWORK_MESSAGE_BYTES = 24 * 1024;
const MAX_SPACE_CREATE_BYTES = 4 * 1024;
const COOKIE_NAMES = new Set(["ordax_access", "ordax_refresh"]);
const COOKIE_VALUE_RE = /^[^;\r\n]{1,16384}$/;

const READ_PATHS = new Set([
  "/auth/session",
  "/auth/registration-policy",
  "/account/export",
  "/account/spaces",
  "/account/entitlements/memory-cloud",
  "/sync/objects",
  "/sync/snapshot",
  "/sync/changes",
]);

const WRITE_PATHS = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/logout",
  "/account/close",
  "/account/spaces/create",
  "/sync/mutate",
  "/network/v2/messages/send",
]);

function validatedGatewayUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:"
    || !url.hostname
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname.endsWith("/")
  ) {
    throw new TypeError("Native emulator account gateway must be an HTTPS base URL");
  }
  return url.href;
}

function normalizeLoopback(address) {
  if (typeof address !== "string") return false;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function parseSetCookie(raw, cookies) {
  if (typeof raw !== "string") return;
  const separator = raw.indexOf(";");
  const pair = separator === -1 ? raw : raw.slice(0, separator);
  const equals = pair.indexOf("=");
  if (equals <= 0) return;
  const name = pair.slice(0, equals).trim();
  if (!COOKIE_NAMES.has(name)) return;
  let value = pair.slice(equals + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  const attributes = separator === -1 ? "" : raw.slice(separator + 1);
  const maxAge = attributes.match(/(?:^|;)\s*max-age\s*=\s*(-?\d+)/i)?.[1];
  const expires = attributes.match(/(?:^|;)\s*expires\s*=\s*([^;]+)/i)?.[1];
  const expired = maxAge !== undefined
    ? Number(maxAge) <= 0
    : expires !== undefined && Number.isFinite(Date.parse(expires)) && Date.parse(expires) <= Date.now();
  if (expired || value.length === 0) {
    cookies.delete(name);
    return;
  }
  if (!COOKIE_VALUE_RE.test(value)) throw new TypeError("Account gateway returned an invalid session cookie");
  cookies.set(name, value);
}

function setCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
}

function jsonObject(response) {
  if (response.bytes.length === 0) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(response.bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function decodeCredentials(body, contentType, expectedKeys) {
  let value;
  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(body.toString("utf8"));
    value = Object.fromEntries(form.entries());
  } else if (contentType === "application/json") {
    value = JSON.parse(body.toString("utf8"));
  } else {
    return null;
  }
  return exactKeys(value, expectedKeys) ? value : null;
}

function safeDisplayName(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > 120 || /[\u0000-\u001f\u007f]/u.test(normalized)) return null;
  return normalized;
}

function verifiedSession(value, { allowAnonymous = true } = {}) {
  if (!value || value.$schema !== SESSION_SCHEMA) return null;
  if (
    value.authenticated === true
    && value.status === "authenticated"
    && typeof value.provider === "string"
    && value.provider.length > 0
    && value.provider !== "unconfigured"
    && value.provider !== "gated"
    && typeof value.subject === "string"
    && value.subject.length > 0
    && typeof value.email === "string"
    && value.email.length > 0
  ) {
    const displayName = safeDisplayName(value.displayName);
    return {
      $schema: SESSION_SCHEMA,
      authenticated: true,
      status: "authenticated",
      provider: value.provider,
      subject: value.subject,
      email: value.email,
      ...(displayName ? { displayName } : {}),
      accountCloseEnabled: value.accountCloseEnabled === true,
    };
  }
  if (allowAnonymous && value.authenticated === false && value.status === "anonymous") {
    return {
      $schema: SESSION_SCHEMA,
      authenticated: false,
      status: "anonymous",
      provider: typeof value.provider === "string" && value.provider ? value.provider : "unconfigured",
      accountCloseEnabled: false,
    };
  }
  return null;
}

async function readBody(request, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(response, status, value = null) {
  const headers = {
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
  if (value !== null) headers["Content-Type"] = "application/json; charset=utf-8";
  response.writeHead(status, headers);
  response.end(value === null ? undefined : JSON.stringify(value));
}

export function createEmulatorAccountGateway({ origin = "", fetchImpl = globalThis.fetch, cookieVault = null } = {}) {
  const baseUrl = validatedGatewayUrl(origin);
  const cookies = new Map();
  // Emulator stays memory-only. Only the Windows Desktop host may supply a
  // user-bound encrypted vault. Never expose its contents to the renderer.
  let initialization = null;
  const initialize = () => {
    // Load lazily when the first authorized request arrives, so a corrupted
    // vault fails closed with HTTP 503 instead of an unobserved rejection.
    if (!initialization) initialization = (async () => {
      if (!cookieVault) return;
      const restored = await cookieVault.load();
      if (!(restored instanceof Map)) throw Error("Untrusted Desktop account vault reader");
      for (const [name, value] of restored) {
        if (!COOKIE_NAMES.has(name) || typeof value !== "string" || !COOKIE_VALUE_RE.test(value))
          throw Error("Invalid restored Desktop account cookie");
        cookies.set(name, value);
      }
    })();
    return initialization;
  };
  let queue = Promise.resolve();

  const serialized = (operation) => {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  const upstream = async (method, path, body = null, contentType = null) => {
    if (!baseUrl || typeof fetchImpl !== "function") throw new Error("Account gateway is unavailable");
    const headers = {
      Accept: "application/json",
      "User-Agent": "OrdaX-Native-Account/1",
    };
    if (cookies.size) {
      headers.Cookie = [...cookies.entries()].sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => `${name}=${value}`).join("; ");
    }
    if (body !== null) headers["Content-Type"] = contentType ?? "application/octet-stream";
    const result = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === null ? undefined : body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const bytes = new Uint8Array(await result.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("Account gateway response is too large");
    const priorCookies = JSON.stringify([...cookies]);
    for (const cookie of setCookieHeaders(result.headers)) parseSetCookie(cookie, cookies);
    if (cookieVault && JSON.stringify([...cookies]) !== priorCookies) {
      try { await cookieVault.save(cookies); }
      catch { cookies.clear(); throw Error("Secure Desktop account cookie persistence failed"); }
    }
    return { status: result.status, bytes };
  };

  const readVerifiedSession = async () => {
    const result = await upstream("GET", "/auth/session");
    if (result.status !== 200) return null;
    const session = verifiedSession(jsonObject(result));
    if (session === null) return null;
    return session;
  };

  const dispatch = (method, path, search, body) => serialized(async () => {
    try { await initialize(); }
    catch (error) {
      // Explicit local logout must still erase a damaged encrypted cache.
      // No authenticated server action is claimed without valid cookies.
      if (method !== "POST" || path !== "/auth/logout" || !cookieVault) throw error;
      cookies.clear();
      await cookieVault.save(cookies);
      initialization = null;
      return { status: 204, value: null };
    }
    if (!baseUrl) {
      if (method === "GET" && path === "/auth/session") {
        return { status: 200, value: {
          $schema: SESSION_SCHEMA,
          authenticated: false,
          status: "anonymous",
          provider: "unconfigured",
          accountCloseEnabled: false,
        } };
      }
      return { status: 503, value: null };
    }

    if (method === "GET" && path === "/auth/session") {
      const session = await readVerifiedSession();
      return session === null ? { status: 503, value: null } : { status: 200, value: session };
    }

    if (method === "GET" && path === "/auth/registration-policy") {
      const result = await upstream("GET", path);
      const policy = jsonObject(result);
      if (result.status !== 200 || policy === null || policy.$schema !== "prototype-ordax.registration-legal-policy/1") {
        return { status: 503, value: null };
      }
      // The server is the only authority for registration availability.
      return { status: result.status, value: policy };
    }

    if (method === "POST" && path === "/auth/register") {
      let credentials;
      try {
        if (body.byteLength > MAX_CREDENTIAL_BYTES) return { status: 413, value: null };
        const form = decodeCredentials(body, "application/x-www-form-urlencoded", ["email", "password", "legal_acceptance"]);
        if (form === null) return { status: 400, value: null };
        credentials = validateIdentityRegistrationInput({
          email: form.email,
          password: form.password,
          legalAccepted: form.legal_acceptance === "accepted",
        });
      } catch {
        return { status: 400, value: null };
      }
      const form = new URLSearchParams({
        email: credentials.email,
        password: credentials.password,
        legal_acceptance: "accepted",
      });
      const registration = await upstream("POST", path, form.toString(), "application/x-www-form-urlencoded");
      if (![200, 202, 303].includes(registration.status)) return { status: registration.status, value: null };
      const session = await readVerifiedSession();
      if (session === null) return { status: 503, value: null };
      return session.authenticated === true
        ? { status: 200, value: session }
        : { status: 202, value: { ...session, confirmationRequired: true } };
    }

    if (method === "POST" && path === "/auth/login") {
      let credentials;
      try {
        if (body.byteLength > MAX_CREDENTIAL_BYTES) return { status: 413, value: null };
        const form = decodeCredentials(body, "application/x-www-form-urlencoded", ["email", "password"]);
        if (form === null) return { status: 400, value: null };
        credentials = validateIdentityCredentialInput(form);
      } catch {
        return { status: 400, value: null };
      }
      const form = new URLSearchParams({ email: credentials.email, password: credentials.password });
      const login = await upstream("POST", "/auth/login", form.toString(), "application/x-www-form-urlencoded");
      if (![200, 202, 303].includes(login.status)) return { status: login.status, value: null };
      const session = await readVerifiedSession();
      return session?.authenticated === true
        ? { status: 200, value: session }
        : { status: 503, value: null };
    }

    if (method === "POST" && path === "/auth/logout") {
      let result;
      try { result = await upstream("POST", path, "", "application/json"); }
      finally {
        // Logout clears local secret state even if the upstream is offline.
        cookies.clear();
        if (cookieVault) await cookieVault.save(cookies);
      }
      return [200, 204, 303].includes(result.status)
        ? { status: 204, value: null }
        : { status: result.status, value: null };
    }

    if (method === "POST" && path === "/account/close") {
      let payload;
      try {
        if (body.byteLength > MAX_CREDENTIAL_BYTES) return { status: 413, value: null };
        payload = decodeCredentials(body, "application/x-www-form-urlencoded", ["password", "confirmation"]);
        if (payload !== null) payload = validateAccountCloseRequest(payload);
      } catch {
        return { status: 400, value: null };
      }
      if (payload === null) return { status: 400, value: null };
      const form = new URLSearchParams({ password: payload.password, confirmation: payload.confirmation });
      const result = await upstream("POST", path, form.toString(), "application/x-www-form-urlencoded");
      if (result.bytes.length === 0) return { status: result.status, value: null };
      const value = jsonObject(result);
      return value === null ? { status: 503, value: null } : { status: result.status, value };
    }

    if (method === "POST" && path === "/account/spaces/create") {
      if (body.byteLength > MAX_SPACE_CREATE_BYTES) return { status: 413, value: null };
      let intent;
      try {
        intent = validateSpaceCreateCommand(JSON.parse(body.toString("utf8")));
      } catch {
        return { status: 400, value: null };
      }
      // Validate the same account session that the renderer displays, but never
      // forward its bearer/cookies to the renderer or invent creation authority.
      const session = await readVerifiedSession();
      if (session === null) return { status: 503, value: null };
      if (session.authenticated !== true) return { status: 401, value: null };

      const result = await upstream("POST", path, JSON.stringify(intent), "application/json");
      if (![200, 201].includes(result.status)) {
        return { status: result.status, value: null };
      }
      try {
        const receipt = validateSpaceCreateReceipt(jsonObject(result), {
          subjectId: session.subject,
          request: intent,
        });
        // 201 is a new Space; 200 is a replay of the same idempotency key.
        if ((result.status === 201) !== receipt.created) {
          return { status: 503, value: null };
        }
        return { status: result.status, value: receipt };
      } catch {
        return { status: 503, value: null };
      }
    }

    if (method === "GET" && path === "/account/entitlements/memory-cloud") {
      const result = await upstream("GET", path);
      if (result.status !== 200 || result.bytes.length > MAX_MEMORY_ENTITLEMENT_BYTES) {
        return { status: result.status === 200 ? 503 : result.status, value: null };
      }
      const value = jsonObject(result);
      const keys = ["schema", "subjectType", "subjectId", "key", "decision", "value", "authority", "expiresAt"];
      if (
        !exactKeys(value, keys)
        || value.schema !== "ordax.entitlements/1"
        || value.subjectType !== "account"
        || value.key !== "memory.cloud.enabled"
        || value.authority !== "server"
        || value.value !== null
        || !(value.expiresAt === null || (typeof value.expiresAt === "string" && value.expiresAt.trim() === value.expiresAt && value.expiresAt.length <= 96))
      ) return { status: 503, value: null };
      try {
        const decision = validateEntitlementDecision(value);
        if (decision.authority !== "server" || decision.subjectType !== "account" || decision.key !== "memory.cloud.enabled" || decision.value !== null) {
          return { status: 503, value: null };
        }
        return { status: 200, value: { ...decision, expiresAt: value.expiresAt } };
      } catch {
        return { status: 503, value: null };
      }
    }

    if (method === "POST" && path === "/network/v2/messages/send") {
      if (body.byteLength > MAX_NETWORK_MESSAGE_BYTES) return { status: 413, value: null };
      let payload;
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        return { status: 400, value: null };
      }
      if (!exactKeys(payload, ["space_id", "conversation_id", "idempotency_key", "body"])) {
        return { status: 400, value: null };
      }
      const result = await upstream("POST", path, JSON.stringify(payload), "application/json");
      if (result.bytes.length === 0) return { status: result.status, value: null };
      const value = jsonObject(result);
      return value === null ? { status: 503, value: null } : { status: result.status, value };
    }

    if (method === "POST" && path === "/sync/mutate") {
      let payload;
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        return { status: 400, value: null };
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { status: 400, value: null };
      const result = await upstream("POST", path, JSON.stringify(payload), "application/json");
      if (result.bytes.length === 0) return { status: result.status, value: null };
      const value = jsonObject(result);
      return value === null ? { status: 503, value: null } : { status: result.status, value };
    }

    const result = await upstream(method, path + search, body, body === null ? null : "application/json");
    if (result.bytes.length === 0) return { status: result.status, value: null };
    const value = jsonObject({ status: result.status, bytes: result.bytes });
    return value === null ? { status: 503, value: null } : { status: result.status, value };
  });

  return async function accountMiddleware(request, response) {
    const finish = (status, value = null) => {
      send(response, status, value);
      return true;
    };
    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    } catch {
      return false;
    }
    const path = url.pathname;
    const inAccountNamespace = path.startsWith("/auth/") || path.startsWith("/account/")
      || path.startsWith("/sync/") || path.startsWith("/network/");
    if (!inAccountNamespace) return false;

    const method = request.method?.toUpperCase();
    const allowed = method === "GET" ? READ_PATHS.has(path) : method === "POST" && WRITE_PATHS.has(path);
    if (!allowed) return finish(404);
    if (!normalizeLoopback(request.socket?.remoteAddress)) return finish(403);
    if (method === "POST" && request.headers.origin !== `http://${request.headers.host}`) {
      return finish(403);
    }
    if (path === "/auth/login" && !request.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) {
      return finish(415);
    }
    if ((path.startsWith("/auth/") || path === "/account/close") && url.search) return finish(400);
    if (path === "/account/entitlements/memory-cloud" && url.search) return finish(400);
    if (path === "/account/spaces/create") {
      if (url.search) return finish(400);
      if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        return finish(415);
      }
    }
    if (url.search.length > 1024) return finish(400);

    try {
      const body = method === "POST" ? await readBody(request, MAX_REQUEST_BYTES) : null;
      if (method === "POST" && body === null) return finish(413);
      const result = await dispatch(method, path, url.search, body);
      return finish(result.status, result.value);
    } catch {
      // Never place passwords, cookies, upstream diagnostics or URLs in logs or
      // the browser response. The product Surface already presents unavailable.
      return finish(503);
    }
  };
}
