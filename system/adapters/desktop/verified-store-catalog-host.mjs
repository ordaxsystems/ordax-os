// Windows Desktop read-only adapter for the canonical signed Store publication.
// Cryptography belongs to the installed Go runtime-component-channel, never to JS.
// One local acceptance watermark rejects rollback/equivocation across requests.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { lstat, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
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
async function acceptVerifiedCatalog(snapshot, path) {
  const current = await watermark(path);
  if (current) {
    if (snapshot.sequence < current.sequence
      || snapshot.sequence === current.sequence
      && snapshot.catalogSha256 !== current.catalogSha256)
      throw Error("Store catalog replay or equivocation");
    if (snapshot.sequence === current.sequence) return;
  }
  const candidate = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(candidate, JSON.stringify({
      schema: WATERMARK_SCHEMA, sequence: snapshot.sequence,
      catalogSha256: snapshot.catalogSha256,
    }) + "\n", { flag: "wx", mode: 0o600 });
    await rename(candidate, path);
  } finally { await rm(candidate, { force: true }).catch(() => {}); }
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
} = {}) {
  if (typeof systemRoot !== "string" || typeof verifierRoot !== "string"
    || typeof userData !== "string" || typeof execFileImpl !== "function")
    throw TypeError("Desktop Store requires Electron-owned verifier and OS paths");
  let queue = Promise.resolve();
  async function readSigned() {
    const pinned = platform === "win32"
      ? readDesktopPinnedComponentTrust(systemRoot, verifierRoot) : null;
    if (!pinned) return unavailable("catalog-trust-unavailable");
    if (!pinned.publicationAuthorized) return unavailable("catalog-publication-disabled");
    const directory = storeRoot(userData);
    if (!directory) return unavailable("catalog-storage-unavailable");
    const envelope = join(directory, "catalog-envelope.json");
    if (!await boundedRegular(envelope, MAX_ENVELOPE))
      return unavailable("catalog-envelope-unavailable");
    let scratch = null;
    try {
      scratch = await mkdtemp(join(directory, ".verified-"));
      const output = join(scratch, "catalog.json");
      await verify(pinned.helper, envelope, pinned.trust, output, execFileImpl);
      if (!await boundedRegular(output, MAX_VERIFIED))
        throw Error("Verified Store output missing or outside bounds");
      const bytes = await readFile(output);
      if (bytes.length === 0 || bytes.length > MAX_VERIFIED)
        throw Error("Verified Store output exceeded bounds");
      const snapshot = validateVerifiedAppStoreCatalogSnapshot(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
      if (snapshot.state !== "ready") throw Error("Store verifier did not attest ready");
      // Revoking or rotating a root mid-request must not expose a stale signed catalog.
      const after = readDesktopPinnedComponentTrust(systemRoot, verifierRoot);
      if (!after || !after.publicationAuthorized
        || after.trustSha256 !== pinned.trustSha256)
        throw Error("Store trust changed during verification");
      await acceptVerifiedCatalog(snapshot, join(directory, "catalog-watermark.json"));
      return snapshot;
    } catch { return unavailable("catalog-verification-failed"); }
    finally { if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {}); }
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
