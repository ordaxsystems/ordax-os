// Windows Desktop read-only adapter for the canonical signed Store publication.
// Cryptography belongs to the installed Go runtime-component-channel, never to JS.
// One local acceptance watermark rejects rollback/equivocation across requests.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import {
  VERIFIED_APP_STORE_CATALOG_SCHEMA, validateVerifiedAppStoreCatalogSnapshot,
} from "../../contracts/verified-app-store-catalog.mjs";
import { readDesktopPinnedComponentTrust, withinPinnedRoot } from "./pinned-component-trust.mjs";

const ENDPOINT = "/__ordax/native/store-catalog";
const MAX_ENVELOPE = 4 * 1024 * 1024;
const MAX_VERIFIED = 2 * 1024 * 1024;
const WATERMARK_SCHEMA = "ordax.store-catalog-watermark/1";
const SHA256 = /^[0-9a-f]{64}$/;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function unavailable(reason) {
  return validateVerifiedAppStoreCatalogSnapshot({
    schema: VERIFIED_APP_STORE_CATALOG_SCHEMA, state: "unavailable",
    sequence: null, catalogSha256: null, source: null, trust: null,
    entries: [], reason, authority: "none",
  });
}
function storeRoot(userData) {
  try {
    const parent = lstatSync(userData);
    if (!parent.isDirectory() || parent.isSymbolicLink()) return null;
    const root = join(userData, "Store");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || !withinPinnedRoot(realpathSync(userData), realpathSync(root))) return null;
    return root;
  } catch { return null; }
}
async function boundedRegular(path, max) {
  try {
    const stat = await lstat(path);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= max;
  } catch { return false; }
}
async function watermark(path) {
  let bytes;
  try {
    if (!await boundedRegular(path, 16 * 1024)) {
      await lstat(path); // Existing malformed/symlink watermark must never reset history.
      throw Error("Invalid Store watermark");
    }
    bytes = await readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!value || Array.isArray(value) || typeof value !== "object"
    || Object.keys(value).sort().join(",") !== "catalogSha256,schema,sequence"
    || value.schema !== WATERMARK_SCHEMA
    || !Number.isSafeInteger(value.sequence) || value.sequence <= 0
    || !SHA256.test(value.catalogSha256)) throw Error("Invalid Store watermark identity");
  return value;
}
// A single host-process Promise queue cannot protect a persisted watermark if
// two installed Native hosts overlap. The canonical Go activation owner uses
// exclusive lock directories for exactly this cross-process failure mode.
// This lock is synchronization metadata, never a second catalog identity.
// Existing locks (including interrupted owners) fail closed: no stale-lock
// reclamation by the HTTP reader or request-supplied paths.

const FETCH_TIMEOUT_MS = 8000;

// Same HTTPS base-origin policy as the canonical Native Store transports.
// An origin selects untrusted bytes only: never a catalog, signer or artifact.
export function desktopStoreCatalogEnvelopeUrl(baseOrigin) {
  if (baseOrigin === "") return null;
  if (typeof baseOrigin !== "string" || baseOrigin !== baseOrigin.trim()
    || /[\u0000-\u0020\u007f\\%]/.test(baseOrigin)) {
    throw new TypeError("Invalid configured Store HTTPS origin");
  }
  const raw = /^https:\/\/[^/?#]+(\/[^?#]*)?$/.exec(baseOrigin);
  if (!raw || (raw[1] ?? "/").split("/").some(part => part === "." || part === "..")) {
    throw new TypeError("Invalid configured Store HTTPS origin");
  }
  let url;
  try { url = new URL(baseOrigin); } catch { throw new TypeError("Invalid configured Store HTTPS origin"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password
    || url.search || url.hash || url.port === "0") {
    throw new TypeError("Invalid configured Store HTTPS origin");
  }
  url.pathname = url.pathname.endsWith("/") ? url.pathname : url.pathname + "/";
  return new URL("catalog-envelope.json", url).href;
}

async function fetchRemoteEnvelope(url, fetchImpl) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { Accept: "application/json", "Accept-Encoding": "identity" },
      signal: controller.signal,
    });
    if (response?.status !== 200 || response.redirected || response.url !== url
      || !response.headers || !response.body) throw Error("Store HTTPS response is not canonical");
    const encoding = response.headers.get("content-encoding");
    if (encoding !== null && encoding !== "" && encoding !== "identity")
      throw Error("Store HTTPS compressed responses are forbidden");
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^[1-9][0-9]*$/.test(declared)
      || !Number.isSafeInteger(Number(declared)) || Number(declared) > MAX_ENVELOPE))
      throw Error("Store HTTPS content length is invalid");
    let total = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      if (!(chunk instanceof Uint8Array)) throw Error("Store HTTPS chunk is invalid");
      total += chunk.byteLength;
      if (total > MAX_ENVELOPE) throw Error("Store HTTPS catalog exceeds bound");
      chunks.push(Buffer.from(chunk));
    }
    if (total === 0 || declared !== null && total !== Number(declared))
      throw Error("Store HTTPS response was incomplete");
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(deadline);
    controller.abort();
  }
}

async function writeDurably(path, content) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function acceptVerifiedCatalog(snapshot, path, candidateEnvelope = null, activeEnvelope = null) {
  const lockPath = path + ".lock";
  let locked = false;
  try {
    await mkdir(lockPath, { mode: 0o700 });
    locked = true;
    const current = await watermark(path);
    if (current) {
      if (snapshot.sequence < current.sequence
        || snapshot.sequence === current.sequence
        && snapshot.catalogSha256 !== current.catalogSha256)
        throw Error("Store catalog replay or equivocation");
      if (snapshot.sequence === current.sequence) {
        if (candidateEnvelope === null) return;
        if (activeEnvelope === null) throw Error("Missing active Store envelope");
        // The durable watermark can outlive an interrupted/removed envelope.
        // Restore the exact same signed identity from HTTPS only if the active
        // path is missing. Never replace a symlink or malformed local object.
        let active;
        try { active = await lstat(activeEnvelope); }
        catch (error) { if (error?.code !== "ENOENT") throw error; }
        if (active) {
          if (!active.isFile() || active.isSymbolicLink()
            || active.size === 0 || active.size > MAX_ENVELOPE)
            throw Error("Active Store envelope is unsafe");
          return;
        }
        await rename(candidateEnvelope, activeEnvelope);
        return;
      }
    }
    // An envelope and its watermark must be committed in the same lock.
    // Persist verified bytes first: interruption can be repaired by a local
    // re-verification, but watermark-first would strand the last-known-good.
    if (candidateEnvelope !== null) {
      if (activeEnvelope === null) throw Error("Missing active Store envelope");
      try {
        const currentEnvelope = await lstat(activeEnvelope);
        if (!currentEnvelope.isFile() || currentEnvelope.isSymbolicLink()
          || currentEnvelope.size === 0 || currentEnvelope.size > MAX_ENVELOPE)
          throw Error("Active Store envelope is unsafe");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await rename(candidateEnvelope, activeEnvelope);
    }
    const candidate = path + "." + randomUUID() + ".tmp";
    try {
      await writeDurably(candidate, JSON.stringify({
        schema: WATERMARK_SCHEMA, sequence: snapshot.sequence,
        catalogSha256: snapshot.catalogSha256,
      }) + "\n");
      await rename(candidate, path);
      const persisted = await watermark(path);
      if (persisted?.sequence !== snapshot.sequence
        || persisted.catalogSha256 !== snapshot.catalogSha256)
        throw Error("Store watermark persistence readback failed");
    } finally { await rm(candidate, { force: true }).catch(() => {}); }
  } finally {
    // Never delete a lock acquired by another host or silently reclaim a
    // potentially live process's lock. On failure, retain fail-closed state.
    if (locked) await rmdir(lockPath);
  }
}

function verify(helper, envelope, trust, output, execFileImpl) {
  return new Promise((resolve, reject) => {
    execFileImpl(helper, [
      "verify-store-catalog", "--envelope", envelope,
      "--trust", trust, "--out", output,
    ], {
      encoding: "buffer", timeout: 3000, maxBuffer: 32 * 1024, windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" },
    }, error => error ? reject(Error("Store signature verification failed")) : resolve());
  });
}
export function createDesktopVerifiedStoreCatalogMiddleware({
  systemRoot, verifierRoot, userData, platform = process.platform, execFileImpl = execFile,
  catalogBaseOrigin = "", fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof systemRoot !== "string" || typeof verifierRoot !== "string"
    || typeof userData !== "string" || typeof execFileImpl !== "function"
    || typeof fetchImpl !== "function")
    throw TypeError("Desktop Store requires Electron-owned verifier and OS paths");
  // An absent origin preserves the existing local signed-envelope workflow.
  // No renderer, HTTP request or ordax-pull candidate may select a signer.
  // A malformed operator origin must disable the Store transport, not crash
  // the whole installed Native host (and not fall back to an arbitrary URL).
  let remoteUrl;
  try { remoteUrl = desktopStoreCatalogEnvelopeUrl(catalogBaseOrigin); }
  catch { remoteUrl = false; }
  let queue = Promise.resolve();

  async function readSigned() {
    const pinned = platform === "win32"
      ? readDesktopPinnedComponentTrust(systemRoot, verifierRoot) : null;
    if (!pinned) return unavailable("catalog-trust-unavailable");
    if (!pinned.publicationAuthorized) return unavailable("catalog-publication-disabled");
    if (remoteUrl === false) return unavailable("catalog-transport-invalid-origin");
    const directory = storeRoot(userData);
    if (!directory) return unavailable("catalog-storage-unavailable");
    const envelope = join(directory, "catalog-envelope.json");
    const watermarkPath = join(directory, "catalog-watermark.json");

    async function verifyAndAccept(source, candidate = null) {
      let scratch = null;
      try {
        scratch = await mkdtemp(join(directory, ".verified-"));
        const output = join(scratch, "catalog.json");
        await verify(pinned.helper, source, pinned.trust, output, execFileImpl);
        if (!await boundedRegular(output, MAX_VERIFIED))
          throw Error("Verified Store output missing or outside bounds");
        const bytes = await readFile(output);
        if (bytes.length === 0 || bytes.length > MAX_VERIFIED)
          throw Error("Verified Store output exceeded bounds");
        const snapshot = validateVerifiedAppStoreCatalogSnapshot(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
        if (snapshot.state !== "ready") throw Error("Store verifier did not attest ready");
        const after = readDesktopPinnedComponentTrust(systemRoot, verifierRoot);
        if (!after || !after.publicationAuthorized
          || after.trustSha256 !== pinned.trustSha256)
          throw Error("Store trust changed during verification");
        await acceptVerifiedCatalog(snapshot, watermarkPath, candidate, envelope);
        return snapshot;
      } finally {
        if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {});
      }
    }

    // The HTTPS source is a byte transport only. Verify with the installed Go
    // CLI before atomic LKG promotion. A remote failure preserves the previous
    // signed envelope and monotonic watermark; no unsigned fallback is added.
    if (remoteUrl !== null) {
      const candidate = join(directory, ".catalog-remote-" + randomUUID() + ".tmp");
      try {
        const payload = await fetchRemoteEnvelope(remoteUrl, fetchImpl);
        await writeDurably(candidate, payload);
        return await verifyAndAccept(candidate, candidate);
      } catch {
        // Keep the last-known-good when the network, signer or replay check fails.
      } finally {
        await rm(candidate, { force: true }).catch(() => {});
      }
    }
    if (!await boundedRegular(envelope, MAX_ENVELOPE))
      return unavailable("catalog-envelope-unavailable");
    try { return await verifyAndAccept(envelope); }
    catch { return unavailable("catalog-verification-failed"); }
  }
  return function desktopVerifiedStoreCatalog(req, res, next) {
    if (req.url?.split("?")[0] !== ENDPOINT) return next();
    const reply = (code, body) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(body));
    };
    if (req.url !== ENDPOINT) return reply(400, { error: "Invalid Store catalog path" });
    if (req.method !== "GET") return reply(405, { error: "Store catalog is read-only" });
    if (!LOOPBACK.has(req.socket?.remoteAddress))
      return reply(403, { error: "Native Store requires loopback" });
    if (req.headers.origin && req.headers.origin !== "http://" + req.headers.host)
      return reply(403, { error: "Native Store rejects foreign origin" });
    const task = queue.then(readSigned, readSigned);
    queue = task.then(() => {}, () => {});
    void task.then(result => reply(200, result), () => reply(200, unavailable("catalog-verification-failed")));
  };
}
