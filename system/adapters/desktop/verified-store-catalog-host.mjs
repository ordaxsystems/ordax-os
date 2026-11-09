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
const MAX_PUBLIC_CATALOG_READS = 8;

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

// Operator prepares one immutable HTTPS prefix for the signed catalog and its
// content-addressed artifacts. Existing Native environment variables remain
// the sole configuration; neither the renderer nor a request may override them.
// Half-configured or divergent origins must never expose a verified candidate
// whose artifacts would be fetched from another authority.
export function resolveDesktopStoreHttpsOrigins(catalogOrigin = "", artifactOrigin = "") {
  if (catalogOrigin === "" && artifactOrigin === "") {
    return Object.freeze({ catalogBaseOrigin: "", artifactBaseOrigin: "" });
  }
  try {
    const catalogUrl = desktopStoreCatalogEnvelopeUrl(catalogOrigin);
    const artifactUrl = desktopStoreCatalogEnvelopeUrl(artifactOrigin);
    if (!catalogUrl || !artifactUrl || catalogUrl !== artifactUrl) {
      throw Error("Store HTTPS origins are incomplete or divergent");
    }
    return Object.freeze({
      catalogBaseOrigin: catalogOrigin,
      artifactBaseOrigin: artifactOrigin,
    });
  } catch {
    // null is rejected by both existing transport validators. Do not fall
    // back to an unsigned catalog, a second origin or local candidate bytes.
    return Object.freeze({ catalogBaseOrigin: null, artifactBaseOrigin: null });
  }
}

async function fetchRemoteEnvelope(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  let rejectDeadline;
  const expired = new Promise((_, reject) => { rejectDeadline = reject; });
  // AbortSignal alone is not a deadline: an injected HTTPS transport or
  // streaming body can ignore abort and otherwise monopolize the Store queue.
  const deadline = setTimeout(() => {
    controller.abort();
    rejectDeadline(Error("Store HTTPS catalog read exceeded deadline"));
  }, timeoutMs);
  const reading = (async () => {
    const response = await fetchImpl(url, {
      method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { Accept: "application/json", "Accept-Encoding": "identity" },
      signal: controller.signal,
    });
    if (controller.signal.aborted) throw Error("Store HTTPS catalog read cancelled");
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
      if (controller.signal.aborted) throw Error("Store HTTPS catalog read cancelled");
      if (!(chunk instanceof Uint8Array)) throw Error("Store HTTPS chunk is invalid");
      total += chunk.byteLength;
      if (total > MAX_ENVELOPE) throw Error("Store HTTPS catalog exceeds bound");
      chunks.push(Buffer.from(chunk));
    }
    if (controller.signal.aborted) throw Error("Store HTTPS catalog read cancelled");
    if (total === 0 || declared !== null && total !== Number(declared))
      throw Error("Store HTTPS response was incomplete");
    return Buffer.concat(chunks, total);
  })();
  try {
    return await Promise.race([reading, expired]);
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

async function withLockedWatermark(path, task) {
  const lockPath = path + ".lock";
  let locked = false;
  try {
    await mkdir(lockPath, { mode: 0o700 });
    locked = true;
    return await task();
  } finally {
    // Never release a lock acquired by another Native process.
    // Interrupted locks require explicit operator recovery.
    if (locked) await rmdir(lockPath);
  }
}

// Server-only: hold the same monotonic watermark lock through the canonical
// Go state mutation. This cannot be reached through the read-only Store HTTP
// endpoint or used to change the accepted catalog identity.
export async function withDesktopStoreCatalogWatermark(userData, task) {
  if (typeof task !== "function") throw TypeError("Store watermark task required");
  const root = storeRoot(userData);
  if (!root) throw Error("Store catalog storage unavailable");
  const path = join(root, "catalog-watermark.json");
  return withLockedWatermark(path, async () => {
    const current = await watermark(path);
    if (!current) throw Error("Store catalog watermark unavailable");
    return task(current);
  });
}

async function acceptVerifiedCatalog(snapshot, path, candidateEnvelope = null, activeEnvelope = null) {
  return withLockedWatermark(path, async () => {
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
  });
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
  fetchTimeoutMs = FETCH_TIMEOUT_MS,
} = {}) {
  if (!Number.isInteger(fetchTimeoutMs) || fetchTimeoutMs < 1
    || fetchTimeoutMs > FETCH_TIMEOUT_MS)
    throw TypeError("Desktop Store HTTPS deadline must be bounded");
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
  // One serial verifier/watermark owner per installed host. A public catalog
  // flood cannot monopolize that owner or delay a locally verified lifecycle
  // decision behind an unlimited number of remote HTTPS reads.
  const publicReads = [];
  const localReads = [];
  let publicOutstanding = 0;
  let reading = false;

  async function readSigned(allowRemote = true) {
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
    if (allowRemote && remoteUrl !== null) {
      const candidate = join(directory, ".catalog-remote-" + randomUUID() + ".tmp");
      try {
        const payload = await fetchRemoteEnvelope(remoteUrl, fetchImpl, fetchTimeoutMs);
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
  function runNextRead() {
    if (reading) return;
    const next = localReads.shift() ?? publicReads.shift();
    if (!next) return;
    reading = true;
    // Only the fixed Go verifier reads signed catalog bytes. Priority changes
    // execution order, never source identity, trust, or acceptance watermark.
    void readSigned(next.allowRemote)
      .then(next.resolve, next.reject)
      .finally(() => {
        if (next.allowRemote) publicOutstanding--;
        reading = false;
        runNextRead();
      });
  }

  function queuedRead(allowRemote) {
    if (allowRemote && publicOutstanding >= MAX_PUBLIC_CATALOG_READS) {
      // A valid, fail-closed Store snapshot, never a stale ready/catalog grant.
      return Promise.resolve(unavailable("catalog-reader-busy"));
    }
    return new Promise((resolve, reject) => {
      if (allowRemote) publicOutstanding++;
      (allowRemote ? publicReads : localReads).push({ allowRemote, resolve, reject });
      runNextRead();
    });
  }
  function desktopVerifiedStoreCatalog(req, res, next) {
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
    void queuedRead(true).then(
      result => reply(200, result),
      () => reply(200, unavailable("catalog-verification-failed")),
    );
  }
  // Private, serialized, locally reverified signed catalog. Privileged
  // lifecycle endpoints never download bytes inside a mutation.
  Object.defineProperty(desktopVerifiedStoreCatalog, "readVerifiedLocalCatalog", {
    value: () => queuedRead(false),
  });
  return desktopVerifiedStoreCatalog;
}
