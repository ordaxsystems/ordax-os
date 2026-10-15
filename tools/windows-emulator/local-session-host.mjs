import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const N = 1 << 15;
const R = 8;
const P = 1;
const DKLEN = 32;
const MAXMEM = 64 * 1024 * 1024;
const MIN_SECRET_CHARS = 6;
const MAX_SECRET_CHARS = 128;

function validSecret(value) {
  return typeof value === "string"
    && !value.includes("\0")
    && value.length >= MIN_SECRET_CHARS
    && value.length <= MAX_SECRET_CHARS
    && Boolean(value.trim());
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function sendEmpty(res, status) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

async function readBody(req, maxBytes = 2048) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request-too-large");
    chunks.push(chunk);
  }
  if (size === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function derive(secret, salt) {
  return Buffer.from(await scrypt(secret, salt, DKLEN, { N, r: R, p: P, maxmem: MAXMEM }));
}

function validCredential(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.schema === "ordax.local-session-credential/1"
    && value.kdf === "scrypt"
    && value.n === N && value.r === R && value.p === P
    && typeof value.saltHex === "string" && /^[0-9a-f]{64}$/.test(value.saltHex)
    && typeof value.verifierHex === "string" && /^[0-9a-f]{64}$/.test(value.verifierHex);
}

export function createWindowsLocalSessionHost(stateRoot) {
  const credentialPath = join(stateRoot, "local-session-credential.json");
  let locked = false;
  let failures = 0;
  let retryAfter = 0;

  async function readCredential() {
    try {
      const parsed = JSON.parse(await readFile(credentialPath, "utf8"));
      if (!validCredential(parsed)) throw new Error("unsafe-local-session-credential");
      return parsed;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function credentialPresent() {
    try { return (await readCredential()) !== null; } catch { return false; }
  }

  async function snapshot() {
    const configured = locked || await credentialPresent();
    return {
      schema: "ordax.local-session/1",
      state: locked ? "locked" : "unlocked",
      credentialConfigured: configured,
      canLock: configured,
      protectionScope: "surface-session-not-storage-encryption",
    };
  }

  async function writeCredential(secret) {
    const salt = randomBytes(32);
    const verifier = await derive(secret, salt);
    const payload = {
      schema: "ordax.local-session-credential/1",
      kdf: "scrypt",
      n: N,
      r: R,
      p: P,
      saltHex: salt.toString("hex"),
      verifierHex: verifier.toString("hex"),
    };
    await mkdir(stateRoot, { recursive: true });
    const temporary = credentialPath + ".tmp." + process.pid + "." + Date.now();
    await writeFile(temporary, JSON.stringify(payload) + "\n", { encoding: "utf8", flag: "wx" });
    await rename(temporary, credentialPath);
  }

  async function verify(secret) {
    const credential = await readCredential();
    if (!credential || !validSecret(secret)) return false;
    const expected = Buffer.from(credential.verifierHex, "hex");
    const actual = await derive(secret, Buffer.from(credential.saltHex, "hex"));
    return expected.byteLength === actual.byteLength && timingSafeEqual(actual, expected);
  }

  return async function handleLocalSession(req, res, url) {
    if (url.pathname !== "/__ordax/native/local-session") return false;

    if (req.method === "GET") {
      sendJson(res, 200, await snapshot());
      return true;
    }
    if (req.method !== "POST") {
      sendEmpty(res, 405);
      return true;
    }

    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      sendEmpty(res, 400);
      return true;
    }

    const action = body.action;
    const keys = Object.keys(body).sort().join(",");
    const expectedKeys = action === "lock" ? "action" : "action,secret";
    if (keys !== expectedKeys || (action !== "lock" && !validSecret(body.secret))) {
      sendEmpty(res, 400);
      return true;
    }

    const credential = await readCredential();
    const now = Date.now();
    if (action === "configure-credential") {
      if (credential !== null || locked) { sendEmpty(res, 409); return true; }
      await writeCredential(body.secret);
      locked = false; failures = 0; retryAfter = 0;
    } else if (action === "remove-credential") {
      if (credential === null) { sendEmpty(res, 409); return true; }
      if (locked) { sendEmpty(res, 423); return true; }
      if (!(await verify(body.secret))) { sendEmpty(res, 401); return true; }
      await rm(credentialPath, { force: true });
      locked = false; failures = 0; retryAfter = 0;
    } else if (action === "lock") {
      if (credential === null) { sendEmpty(res, 409); return true; }
      locked = true;
    } else if (action === "unlock") {
      if (credential === null) { sendEmpty(res, 409); return true; }
      if (now < retryAfter) { sendEmpty(res, 429); return true; }
      if (!(await verify(body.secret))) {
        failures = Math.min(8, failures + 1);
        const delaySeconds = Math.min(30, (1 << Math.min(5, failures)) - 1);
        retryAfter = now + delaySeconds * 1000;
        sendEmpty(res, 401);
        return true;
      }
      locked = false; failures = 0; retryAfter = 0;
    } else {
      sendEmpty(res, 400);
      return true;
    }

    sendJson(res, 200, await snapshot());
    return true;
  };
}
