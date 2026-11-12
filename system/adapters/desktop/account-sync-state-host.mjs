// Windows Native implementation of the existing Linux sync-checkpoint and
// sync-state contracts. One installed Desktop user-data owner, no new sync
// authority, cloud client, credential persistence or renderer-owned token.
import { randomUUID, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { validateSyncCheckpoint } from "../../contracts/sync-checkpoint-store.mjs";
import { validateSyncStatePayload, MAX_SYNC_STATE_PAYLOAD_BYTES } from "../../contracts/sync-state-store.mjs";

const TOKEN = /^[0-9a-f]{64}$/;
const HEADER = "x-ordax-desktop-state-token";
const MAX_CHECKPOINT_BODY = 8192;
const MAX_CHECKPOINT_FILE = 8192;
const MAX_SYNC_STATE_BODY = MAX_SYNC_STATE_PAYLOAD_BYTES + 64;
const MAX_SYNC_STATE_FILE = MAX_SYNC_STATE_BODY;
const ROUTES = new Map([
  ["/__ordax/native/sync-checkpoint", {
    key: "checkpoint",
    filename: "desktop-account-sync-checkpoint.json",
    maxBody: MAX_CHECKPOINT_BODY,
    maxFile: MAX_CHECKPOINT_FILE,
    validate: validateSyncCheckpoint,
  }],
  ["/__ordax/native/sync-state", {
    key: "payload",
    filename: "desktop-account-sync-state.json",
    maxBody: MAX_SYNC_STATE_BODY,
    maxFile: MAX_SYNC_STATE_FILE,
    validate: validateSyncStatePayload,
  }],
]);
const isLoopback = value => value === "127.0.0.1"
  || value === "::1" || value === "::ffff:127.0.0.1";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function regularOrAbsent(path, maximum) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximum) {
      throw new Error("Untrusted Desktop sync state file");
    }
    return info;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function decodeRecord(value, route) {
  if (!isRecord(value) || Object.keys(value).length !== 1
    || !Object.hasOwn(value, route.key)) {
    throw new TypeError("Native sync body must contain exactly its canonical field");
  }
  return route.validate(value[route.key]);
}

async function readRecord(path, route) {
  const prior = await regularOrAbsent(path, route.maxFile);
  if (prior === null) return null;
  // Check an already-open descriptor as well as lstat: never read a directory,
  // substituted symlink or oversized file as a checkpoint of another subject.
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > route.maxFile
      || info.ino !== prior.ino || info.dev !== prior.dev) {
      throw new Error("Desktop sync file identity changed during read");
    }
    const raw = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(raw, "utf8") > route.maxFile) {
      throw new Error("Desktop sync file exceeds its bounded contract");
    }
    return decodeRecord(JSON.parse(raw), route);
  } finally {
    await handle.close();
  }
}

async function writeRecord(userData, path, route, value) {
  const normalized = route.validate(value);
  const bytes = Buffer.from(JSON.stringify({ [route.key]: normalized }) + "\n", "utf8");
  if (bytes.length > route.maxFile) throw new TypeError("Native sync payload exceeds storage bounds");
  await mkdir(userData, { recursive: true });
  // A malformed or substituted durable checkpoint must not be silently
  // overwritten. Preserve the existing bytes for explicit recovery.
  await readRecord(path, route);
  const temporary = join(userData, "." + route.filename + "." + randomUUID());
  let handle = null;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    // A successful HTTP acknowledgement requires durable file bytes.
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
  } finally {
    if (handle !== null) await handle.close();
    await unlink(temporary).catch(error => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  return normalized;
}

export function createDesktopAccountSyncStateMiddleware(userData, {
  token,
  sessionLocked = null,
} = {}) {
  if (typeof userData !== "string" || !userData || !TOKEN.test(token)
    || (sessionLocked !== null && typeof sessionLocked !== "function")) {
    throw new TypeError("Desktop sync persistence requires private userData and Electron state grant");
  }
  const expected = Buffer.from(token, "hex");
  let queue = Promise.resolve();
  const serial = operation => {
    const result = queue.then(operation);
    queue = result.then(() => {}, () => {});
    return result;
  };

  const middleware = (request, response, next) => {
    const path = String(request.url ?? "").split("?")[0];
    const route = ROUTES.get(path);
    if (!route) return next();
    const reply = (status, body = null) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(JSON.stringify(body ?? { error: "Native sync persistence unavailable" }));
    };
    const supplied = request.headers[HEADER];
    if (!isLoopback(request.socket?.remoteAddress)
      || typeof supplied !== "string" || !TOKEN.test(supplied)
      || !timingSafeEqual(expected, Buffer.from(supplied, "hex"))) {
      return reply(401);
    }
    if (request.url !== path) return reply(400);
    if (request.method !== "GET" && request.method !== "POST") return reply(405);
    if (request.method === "POST" && request.headers.origin !== "http://" + request.headers.host) {
      return reply(403);
    }
    if (request.method === "POST" && request.headers["content-type"] !== "application/json") {
      return reply(415);
    }

    void serial(async () => {
      if (sessionLocked && await sessionLocked()) return { status: 423 };
      const file = join(userData, route.filename);
      if (request.method === "GET") {
        return { status: 200, body: { [route.key]: await readRecord(file, route) } };
      }
      let length = 0;
      const chunks = [];
      for await (const chunk of request) {
        length += chunk.length;
        if (length > route.maxBody) return { status: 413 };
        chunks.push(chunk);
      }
      let nextValue;
      try {
        nextValue = decodeRecord(JSON.parse(Buffer.concat(chunks).toString("utf8")), route);
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof TypeError) return { status: 400 };
        throw error;
      }
      const saved = await writeRecord(userData, file, route, nextValue);
      return { status: 200, body: { [route.key]: saved } };
    }).then(({ status, body }) => reply(status, body), () => reply(503));
  };

  return Object.freeze({ middleware });
}
