// Native Windows transport for the same Store content-addressed protocol.
// The catalog supplies only signed SHA-256 identities; this module cannot
// select versions, sign anything, stage a slot or alter activation state.
import { createHash, randomUUID } from "node:crypto";
import { lstat, link, mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { validateAppArtifactIdentity, appArtifactContentPath, MAX_APP_ARTIFACT_BYTES } from "../../contracts/app-artifact-identity.mjs";
import { desktopStoreCatalogEnvelopeUrl } from "./verified-store-catalog-host.mjs";

const ARTIFACT_ROLES = Object.freeze(["package", "release", "compatibility", "componentEnvelope"]);
const TIMEOUT_MS = 20000;
// Limit both network concurrency and resident signed bytes while preserving
// the caller's single canonical catalog-watermark transaction.
const MAX_CONCURRENT_ARTIFACT_DOWNLOADS = 2;

export function desktopStoreArtifactUrl(baseOrigin, identity) {
  const normalized = validateAppArtifactIdentity(identity);
  const catalogUrl = desktopStoreCatalogEnvelopeUrl(baseOrigin);
  if (catalogUrl === null) throw Error("Signed Store artifact HTTPS origin is unavailable");
  return new URL(appArtifactContentPath(normalized),
    new URL(".", catalogUrl)).href;
}

async function realDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error("Store artifact directory is unsafe");
  return path;
}

async function ensureDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  return realDirectory(path);
}

function digestOf(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifiedCached(path, identity) {
  let stat;
  try { stat = await lstat(path); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || stat.size !== identity.size) throw Error("Store artifact cache is unsafe");
  const bytes = await readFile(path);
  if (bytes.length !== identity.size || digestOf(bytes) !== identity.sha256)
    throw Error("Store artifact cache identity differs from signed candidate");
  return path;
}

async function download(identity, url, fetchImpl, timeoutMs) {
  const abort = new AbortController();
  let rejectDeadline;
  const expired = new Promise((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => {
    abort.abort();
    rejectDeadline(Error("Store artifact HTTPS read exceeded deadline"));
  }, timeoutMs);
  const reading = (async () => {
    const result = await fetchImpl(url, {
      method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { Accept: "application/octet-stream", "Accept-Encoding": "identity" },
      signal: abort.signal,
    });
    if (abort.signal.aborted) throw Error("Store artifact HTTPS read cancelled");
    if (result?.status !== 200 || result.redirected || result.url !== url
      || !result.headers || !result.body)
      throw Error("Store artifact response is not canonical");
    const encoding = result.headers.get("content-encoding");
    if (encoding !== null && encoding !== "" && encoding !== "identity")
      throw Error("Compressed Store artifacts are not accepted");
    const declared = result.headers.get("content-length");
    if (declared !== null && (!/^[1-9][0-9]*$/.test(declared)
      || Number(declared) !== identity.size))
      throw Error("Store artifact Content-Length mismatch");
    const chunks = [];
    let count = 0;
    for await (const chunk of result.body) {
      if (abort.signal.aborted) throw Error("Store artifact HTTPS read cancelled");
      if (!(chunk instanceof Uint8Array)) throw Error("Nonbinary Store artifact body");
      count += chunk.byteLength;
      if (count > identity.size || count > MAX_APP_ARTIFACT_BYTES)
        throw Error("Store artifact exceeds signed size");
      chunks.push(Buffer.from(chunk));
    }
    if (abort.signal.aborted) throw Error("Store artifact HTTPS read cancelled");
    if (count !== identity.size) throw Error("Truncated signed Store artifact");
    const bytes = Buffer.concat(chunks, count);
    if (digestOf(bytes) !== identity.sha256)
      throw Error("Store artifact SHA-256 mismatch");
    return bytes;
  })();
  try {
    // The installed Go owner must not be blocked indefinitely by a transport
    // that ignores AbortSignal, or accept bytes delivered after timeout.
    return await Promise.race([reading, expired]);
  } finally { clearTimeout(timer); abort.abort(); }
}

async function persistVerified(parent, filename, bytes, identity) {
  const finalPath = join(parent, filename);
  const existing = await verifiedCached(finalPath, identity);
  if (existing) return existing;
  const temp = join(parent, ".store-artifact-" + randomUUID() + ".tmp");
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally { await handle.close(); }
    // Atomic creation; never replace a digest path written by another owner.
    try { await link(temp, finalPath); }
    catch (error) { if (error?.code !== "EEXIST") throw error; }
    // The committed cache file must have exactly one hardlink after the
    // private temporary link has been removed, even on NTFS.
    await rm(temp);
    const committed = await verifiedCached(finalPath, identity);
    if (!committed) throw Error("Store artifact was not committed");
    return committed;
  } finally { await rm(temp, { force: true }).catch(() => {}); }
}

// Called ONLY while the caller holds the canonical Store watermark lock and
// has compared the full private plan against a Go-verified local catalog.
export async function acquireDesktopStoreArtifacts({
  userData, baseOrigin, candidate, fetchImpl = globalThis.fetch,
  fetchTimeoutMs = TIMEOUT_MS,
} = {}) {
  if (!Number.isInteger(fetchTimeoutMs) || fetchTimeoutMs < 1
    || fetchTimeoutMs > TIMEOUT_MS)
    throw TypeError("Store artifact HTTPS deadline must be bounded");
  if (typeof fetchImpl !== "function") throw TypeError("Native artifact fetch is required");
  const identities = Object.fromEntries(ARTIFACT_ROLES.map(role =>
    [role, validateAppArtifactIdentity(candidate?.artifacts?.[role])]));
  // Different signed roles may share immutable CAS bytes, but their signed
  // lengths must agree before the per-digest singleflight can reuse a writer.
  // Reject an inconsistent catalog before reading cache or touching the network.
  const sizesByDigest = new Map();
  for (const role of ARTIFACT_ROLES) {
    const { sha256, size } = identities[role];
    if (sizesByDigest.has(sha256) && sizesByDigest.get(sha256) !== size) {
      throw Error("Signed Store artifact digest has conflicting sizes");
    }
    sizesByDigest.set(sha256, size);
  }
  // Validate origin before creating any files or accepting a cache hit.
  const urls = Object.fromEntries(ARTIFACT_ROLES.map(role =>
    [role, desktopStoreArtifactUrl(baseOrigin, identities[role])]));
  if (typeof userData !== "string") throw TypeError("Native artifact userData is required");
  const store = await realDirectory(join(userData, "Store"));
  const artifacts = await ensureDirectory(join(store, "artifacts"));
  const version = await ensureDirectory(join(artifacts, "v1"));
  const hashes = await ensureDirectory(join(version, "sha256"));
  // Four independent signed artifact reads do not need four sequential HTTPS
  // round trips. Keep at most two verified byte buffers in flight. An identical
  // SHA-256 across roles shares one CAS writer; otherwise simultaneous hard
  // links to the same digest could briefly fail the nlink=1 safety check.
  const byDigest = new Map();
  const byRole = new Map();
  let cursor = 0, failure = null;
  const acquire = role => {
    const identity = identities[role], name = identity.sha256;
    if (!byDigest.has(name)) {
      byDigest.set(name, (async () => {
        const parent = await ensureDirectory(join(hashes, name.slice(0, 2)));
        const cached = await verifiedCached(join(parent, name), identity);
        return cached ?? await persistVerified(
          parent, name, await download(identity, urls[role], fetchImpl, fetchTimeoutMs), identity);
      })());
    }
    return byDigest.get(name);
  };
  const workers = Array.from({
    length: Math.min(MAX_CONCURRENT_ARTIFACT_DOWNLOADS, ARTIFACT_ROLES.length),
  }, async () => {
    while (cursor < ARTIFACT_ROLES.length && failure === null) {
      const role = ARTIFACT_ROLES[cursor++];
      try { byRole.set(role, await acquire(role)); }
      catch (error) { failure ??= error; }
    }
  });
  // On the first failure, no new downloads start. Still join every already
  // active worker before returning: otherwise the caller could release its
  // watermark lock while a detached CAS writer was still publishing bytes.
  await Promise.all(workers);
  if (failure !== null) throw failure;
  return Object.freeze(Object.fromEntries(
    ARTIFACT_ROLES.map(role => [role, byRole.get(role)]),
  ));
}
