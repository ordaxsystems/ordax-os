import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PREFIX = "/__ordax/native/local-ai";
const UPSTREAM = "http://127.0.0.1:17865";
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_DISCOVERY_BYTES = 256 * 1024;
const MAX_COMPLETION_BYTES = 1024 * 1024;
const ALLOWED = new Map([
  ["GET /health", 0],
  ["GET /v1/models", MAX_DISCOVERY_BYTES],
  ["POST /v1/chat/completions", MAX_COMPLETION_BYTES],
]);

function sendEmpty(res, status) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end();
}

function sendJsonBytes(res, status, bytes) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(bytes.byteLength));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(bytes);
}

function boundedText(value, max) {
  return typeof value === "string" && !value.includes("\0") && Boolean(value.trim()) && value.trim().length <= max;
}

function validateCompletionRequest(bytes) {
  if (!(bytes instanceof Buffer) || bytes.byteLength < 1 || bytes.byteLength > MAX_REQUEST_BYTES) {
    throw new TypeError("local-ai-request-outside-byte-limit");
  }
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new TypeError("local-ai-request-invalid-json"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("local-ai-request-invalid-object");
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "max_tokens,messages,model,stream") throw new TypeError("local-ai-request-schema-unsupported");
  if (!boundedText(value.model, 160) || value.stream !== false) throw new TypeError("local-ai-request-model-stream-invalid");
  if (!Number.isSafeInteger(value.max_tokens) || value.max_tokens < 1 || value.max_tokens > 2048) throw new TypeError("local-ai-request-token-budget-invalid");
  if (!Array.isArray(value.messages) || ![1, 2].includes(value.messages.length)) throw new TypeError("local-ai-request-messages-invalid");
  const roles = value.messages.length === 1 ? ["user"] : ["system", "user"];
  for (let index = 0; index < roles.length; index += 1) {
    const message = value.messages[index];
    const role = roles[index];
    const cap = role === "system" ? 8192 : 32768;
    if (!message || typeof message !== "object" || Array.isArray(message)
      || Object.keys(message).sort().join(",") !== "content,role"
      || message.role !== role || !boundedText(message.content, cap)) {
      throw new TypeError("local-ai-request-message-invalid");
    }
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > MAX_REQUEST_BYTES) throw Object.assign(new Error("request-too-large"), { status: 413 });
    chunks.push(chunk);
  }
  if (size === 0) throw Object.assign(new Error("request-empty"), { status: 400 });
  return Buffer.concat(chunks);
}

async function inferenceKey(stateRoot) {
  const path = join(stateRoot, "LocalAi", "auth.key");
  let raw;
  try { raw = await readFile(path, "utf8"); }
  catch { return null; }
  if (!/^[0-9a-f]{64}\r?\n?$/.test(raw)) return null;
  return raw.trim();
}

function loopbackClient(req) {
  const remote = req.socket?.remoteAddress ?? "";
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

async function forward(method, suffix, body, key, maxResponseBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), method === "POST" ? 120_000 : 3_000);
  try {
    const response = await fetch(`${UPSTREAM}${suffix}`, {
      method,
      redirect: "error",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body } : {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      const allowedStatus = [400, 404, 409, 429, 503].includes(response.status) ? response.status : 503;
      try { await response.body?.cancel(); } catch {}
      return { status: allowedStatus, body: Buffer.alloc(0) };
    }
    if (method === "GET" && suffix === "/health") {
      try { await response.body?.cancel(); } catch {}
      return { status: 200, body: Buffer.alloc(0) };
    }
    const encoding = response.headers.get("content-encoding");
    if (encoding && encoding.toLowerCase() !== "identity") throw new Error("compressed-upstream-response-rejected");
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxResponseBytes)) throw new Error("upstream-response-length-invalid");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maxResponseBytes) throw new Error("upstream-response-too-large");
    let decoded;
    try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("upstream-response-not-utf8"); }
    try { JSON.parse(decoded); }
    catch { throw new Error("upstream-response-invalid-json"); }
    return { status: 200, body: bytes };
  } finally {
    clearTimeout(timer);
  }
}

export function createWindowsLocalAiHost(stateRoot, { isSessionLocked = () => false } = {}) {
  return async function handleLocalAi(req, res, url) {
    if (!url.pathname.startsWith(`${PREFIX}/`)) return false;
    if (!loopbackClient(req)) { sendEmpty(res, 403); return true; }
    if (url.search || url.hash || req.url !== url.pathname) { sendEmpty(res, 400); return true; }
    const suffix = url.pathname.slice(PREFIX.length);
    const maxResponseBytes = ALLOWED.get(`${req.method} ${suffix}`);
    if (maxResponseBytes === undefined) { sendEmpty(res, 404); return true; }
    if (req.method === "POST" && isSessionLocked()) { sendEmpty(res, 423); return true; }

    let body = null;
    if (req.method === "POST") {
      const type = String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
      if (type !== "application/json") { sendEmpty(res, 415); return true; }
      try {
        body = await readBody(req);
        validateCompletionRequest(body);
      } catch (error) {
        sendEmpty(res, Number.isInteger(error?.status) ? error.status : 400);
        return true;
      }
    }

    const key = await inferenceKey(stateRoot);
    if (key === null) { sendEmpty(res, 503); return true; }
    try {
      const result = await forward(req.method, suffix, body, key, maxResponseBytes);
      if (result.body.byteLength === 0) sendEmpty(res, result.status);
      else sendJsonBytes(res, result.status, result.body);
    } catch {
      sendEmpty(res, 503);
    }
    return true;
  };
}