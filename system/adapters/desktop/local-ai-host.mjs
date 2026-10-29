// One Windows Native Host boundary for the canonical ordax.local-ai/1.
// The model/router/Memory and inference contract stay in OrdaX OS/Intelligence.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:net";
import { availableParallelism, constants as osConstants, getPriority, setPriority } from "node:os";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyWindowsLocalAiPackage } from "./local-ai-package.mjs";
import {
  LOCAL_AI_MAX_PROMPT_CHARS, LOCAL_AI_MAX_OUTPUT_TOKENS,
  LOCAL_AI_MAX_SYSTEM_PROMPT_CHARS,
} from "../../contracts/local-ai.mjs";

const ROUTES = new Map([
  ["/__ordax/native/local-ai/health", ["GET", "/health"]],
  ["/__ordax/native/local-ai/v1/models", ["GET", "/v1/models"]],
  ["/__ordax/native/local-ai/v1/chat/completions", ["POST", "/v1/chat/completions"]],
]);
const TOKEN = /^[0-9a-f]{64}$/;
const LIMIT = 1048576;
// The contract allows 32,768 user + 8,192 system UTF-16 code units;
// UTF-8 JSON may exceed 64 KiB for valid multilingual prompts.
const MAX_REQUEST = 262144;
const loopback = ip => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);

function assertRequest(value, modelId) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "max_tokens,messages,model,stream" ||
      value.model !== modelId || typeof value.stream !== "boolean" ||
      !Number.isSafeInteger(value.max_tokens) ||
      value.max_tokens < 1 || value.max_tokens > LOCAL_AI_MAX_OUTPUT_TOKENS ||
      !Array.isArray(value.messages) || ![1, 2].includes(value.messages.length)) {
    throw TypeError("Invalid consultative Local AI request");
  }
  const roles = value.messages.map(x => x?.role);
  if (roles.join(",") !== "user" && roles.join(",") !== "system,user")
    throw TypeError("Only canonical consultative roles are allowed");
  for (const item of value.messages) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).sort().join(",") !== "content,role" ||
        typeof item.content !== "string" || !item.content.trim() ||
        item.content.includes("\0") ||
        item.content.length > (item.role === "system"
          ? LOCAL_AI_MAX_SYSTEM_PROMPT_CHARS : LOCAL_AI_MAX_PROMPT_CHARS))
      throw TypeError("Invalid Local AI prompt");
  }
  return value;
}

// Windows-only CPU latency guard. The Native Host recognizes the exact
// context-free Intelligence envelope; it never fabricates or caches an answer.
const WINDOWS_QUICK_GREETING = /^(?:oi|ol[aá]|ola|opa|hola|hi|hello|hey|bom dia|boa tarde|boa noite)(?:[!,.\s]+(?:tudo bem|como vai|como você está|how are you))?[!?.,\s]*$/iu;
const INTELLIGENCE_GREETING_PREFIX = "Intent: ask\nModel purpose: general\nUser request:\n";

const PORTUGUESE_GREETING = /^(?:oi|ol[aá]|ola|opa|bom dia|boa tarde|boa noite)(?:[!?.,\s]|$)/iu;
const PORTUGUESE_GREETING_STYLE =
  "For a simple Portuguese greeting such as oi or olá, respond in Brazilian Portuguese in one very short friendly sentence. Do not mention permissions or capabilities unless the user asks.";
const OTHER_GREETING_STYLE =
  "For a simple greeting, respond in the user's language in one very short friendly sentence. Do not mention permissions or capabilities unless asked.";
const CANONICAL_INTELLIGENCE_IDENTITY =
  "You are Ordax Intelligence, the consultative intelligence layer of the OrdaX system.";

function boundWindowsGreeting(value) {
  const ordinary = { request: value, quick: false };
  if (value.messages.length !== 2 || value.messages[0].role !== "system" ||
      !value.messages[0].content.startsWith(CANONICAL_INTELLIGENCE_IDENTITY)) return ordinary;
  const user = value.messages[1].content;
  if (!user.startsWith(INTELLIGENCE_GREETING_PREFIX)) return ordinary;
  const prompt = user.slice(INTELLIGENCE_GREETING_PREFIX.length);
  if (prompt.includes("\n") || !WINDOWS_QUICK_GREETING.test(prompt.trim())) return ordinary;
  const style = PORTUGUESE_GREETING.test(prompt.trim())
    ? PORTUGUESE_GREETING_STYLE : OTHER_GREETING_STYLE;
  const system = value.messages[0].content;
  // Preserve original security instructions, even under an output budget.
  const styled = system.length + 1 + style.length <= LOCAL_AI_MAX_SYSTEM_PROMPT_CHARS
    ? system + "\n" + style : system;
  return { quick: true, request: {
    ...value, max_tokens: Math.min(value.max_tokens, 64),
    messages: [{ role: "system", content: styled }, value.messages[1]],
  }};
}

async function portAvailable() {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    return server.address().port;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function boundedRequestBody(request) {
  const parts = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST) throw RangeError("Local AI request too large");
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

export function createDesktopLocalAiMiddleware({
  packageRoot, userData, token, sessionLocked = null,
  verifyPackage = verifyWindowsLocalAiPackage,
  launch = spawn, fetchImpl = globalThis.fetch,
  getProcessPriority = getPriority, setProcessPriority = setPriority,
} = {}) {
  if (typeof packageRoot !== "string" || !packageRoot ||
      typeof userData !== "string" || !userData ||
      !TOKEN.test(token) || typeof fetchImpl !== "function") {
    throw TypeError("Desktop Local AI requires trusted package, profile and session token");
  }
  const expected = Buffer.from(token, "hex");
  // The same portable engine uses up to four logical cores. No CPU SKU fork.
  const threads = Math.max(1, Math.min(4, availableParallelism()));
  let model = null, child = null, port = null, secret = null, secretDirectory = null;
  let starting = null, failed = false, disposed = false;
  // Only short interactive consultations get an elevated CPU scheduling share.
  // Restore after the last quick request, including errors and cancellation.
  let quickInFlight = 0, priorityPid = null, previousPriority = null;
  const beginQuickInference = () => {
    quickInFlight++;
    if (quickInFlight !== 1 || !Number.isSafeInteger(child?.pid) || child.pid <= 0) return;
    try {
      const before = getProcessPriority(child.pid);
      setProcessPriority(child.pid, osConstants.priority.PRIORITY_ABOVE_NORMAL);
      previousPriority = before;
      priorityPid = child.pid;
    } catch {
      previousPriority = null;
      priorityPid = null;
    }
  };
  const endQuickInference = () => {
    if (quickInFlight === 0 || --quickInFlight !== 0) return;
    if (priorityPid !== null && previousPriority !== null &&
        child?.pid === priorityPid && child.exitCode === null) {
      try { setProcessPriority(priorityPid, previousPriority); }
      catch { /* The backend may have exited while the request was active. */ }
    }
    priorityPid = null;
    previousPriority = null;
  };
  const reply = (res, status, message) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(status, {
      "Content-Type": "application/json", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify({ error: message }));
  };
  const start = () => {
    if (disposed || failed) return Promise.reject(Error("Local AI unavailable"));
    if (starting) return starting;
    starting = (async () => {
      model = await verifyPackage(packageRoot);
      await mkdir(userData, { recursive: true });
      secretDirectory = await mkdtemp(join(userData, ".local-ai-auth-"));
      secret = randomBytes(32).toString("hex");
      await writeFile(join(secretDirectory, "key"), secret + "\n", { flag: "wx", mode: 0o600 });
      port = await portAvailable();
      // Physical Windows CPU proof: llama.cpp's automatic model context consumed
      // almost 9 GiB without reaching model readiness. The identical pinned GGUF
      // reached health=ok using one 2048-token slot (~713 MiB RSS). Do not let
      // upstream context defaults determine a Windows Desktop memory budget.
      child = launch(model.executable, [
        "--host", "127.0.0.1", "--port", String(port),
        "--model", model.modelFile, "--alias", model.modelId,
        "--reasoning", "off", "--reasoning-budget", "0",
        "--no-ui", "--no-slots", "-ngl", "0",
        "-t", String(threads), "-tb", String(threads),
        "--ctx-size", "2048", "--parallel", "1",
      ], {
        cwd: model.engineDirectory, windowsHide: true, stdio: "ignore",
        env: { ...process.env, LLAMA_ARG_API_KEY_FILE: join(secretDirectory, "key") },
      });
      child.once("error", () => { failed = true; });
      child.once("exit", () => { failed = true; });
      // A cold model load is not allowed to stall the OS or a Surface request.
      // The canonical Local AI probe supervisor retries when the backend warms up.
      return true;
    })().catch(async error => {
      failed = true;
      child?.kill();
      if (secretDirectory) await rm(secretDirectory, { recursive: true, force: true });
      secret = null;
      throw error;
    });
    return starting;
  };
  const middleware = async (req, res, next) => {
    const path = String(req.url || "").split("?")[0];
    if (!path.startsWith("/__ordax/native/local-ai")) return next();
    const route = ROUTES.get(path);
    if (!route || req.url !== path) return reply(res, 404, "Unsupported Local AI route");
    const supplied = req.headers["x-ordax-local-ai-token"];
    if (!loopback(req.socket?.remoteAddress) || typeof supplied !== "string" ||
        !TOKEN.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied, "hex"), expected))
      return reply(res, 401, "Local AI requires authorized Electron Surface");
    if (req.method !== route[0]) return reply(res, 405, "Local AI method unavailable");
    if (req.method === "POST" &&
        (req.headers.origin !== "http://" + req.headers.host ||
         !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")))
      return reply(res, 403, "Local AI requires same-origin JSON");
    if (sessionLocked) {
      try { if (await sessionLocked()) return reply(res, 423, "Desktop session locked"); }
      catch { return reply(res, 503, "Desktop session unavailable"); }
    }
    if (failed || disposed) return reply(res, 503, "Local AI package unavailable");
    // Verification/start is shared by concurrent probes, never a second engine.
    if (!starting) {
      void start().catch(() => {});
      return reply(res, 503, "Local AI starting");
    }
    if (!model || !port || !secret || !child || child.exitCode !== null)
      return reply(res, 503, "Local AI not ready");
    const abort = new AbortController();
    res.once("close", () => { if (!res.writableEnded) abort.abort(); });
    // Short consultations have an explicit 10-second ceiling; long-form
    // inference retains its separate bounded transport deadline.
    let timeout = setTimeout(() => abort.abort(), req.method === "POST" ? 120000 : 3500);
    let priorityHeld = false;
    try {
      let body;
      if (req.method === "POST") {
        const data = await boundedRequestBody(req);
        const decision = boundWindowsGreeting(assertRequest(data, model.modelId));
        const validated = decision.request;
        body = JSON.stringify(validated);
        if (decision.quick) {
          beginQuickInference();
          priorityHeld = true;
        }
        if (validated.max_tokens <= 128) {
          clearTimeout(timeout);
          timeout = setTimeout(() => abort.abort(), 10000);
        }
      }
      const upstream = await fetchImpl("http://127.0.0.1:" + port + route[1], {
        method: req.method, body, signal: abort.signal,
        headers: {
          Authorization: "Bearer " + secret,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
      });
      const type = upstream.headers.get("content-type") || "";
      const stream = type.startsWith("text/event-stream") && req.method === "POST";
      if (!upstream.ok || !(stream || type.includes("application/json")))
        return reply(res, 503, "Local AI backend unavailable");
      res.writeHead(200, { "Content-Type": stream
        ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8",
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      let total = 0;
      if (!upstream.body) throw Error("Local AI backend body missing");
      for await (const chunk of upstream.body) {
        total += chunk.byteLength;
        if (total > LIMIT) throw RangeError("Local AI response exceeded limit");
        res.write(chunk);
      }
      res.end();
    } catch (error) {
      if (!res.headersSent) reply(res,
        error instanceof TypeError || error instanceof SyntaxError ? 400 :
        error instanceof RangeError ? 413 : 503, "Local AI request failed");
      else res.destroy();
    } finally {
      clearTimeout(timeout);
      abort.abort();
      if (priorityHeld) endQuickInference();
    }
  };
  const dispose = async () => {
    disposed = true;
    child?.kill();
    if (secretDirectory) await rm(secretDirectory, { recursive: true, force: true });
    secret = null;
  };
  return { middleware, dispose };
}
