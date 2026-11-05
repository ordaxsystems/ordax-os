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

async function download(identity, url, fetchImpl) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const result = await fetchImpl(url, {
      method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { Accept: "application/octet-stream", "Accept-Encoding": "identity" },
      signal: abort.signal,
    });
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
      if (!(chunk instanceof Uint8Array)) throw Error("Nonbinary Store artifact body");
      count += chunk.byteLength;
      if (count > identity.size || count > MAX_APP_ARTIFACT_BYTES)
        throw Error("Store artifact exceeds signed size");
      chunks.push(Buffer.from(chunk));
    }
    if (count !== identity.size) throw Error("Truncated signed Store artifact");
    const bytes = Buffer.concat(chunks, count);
    if (digestOf(bytes) !== identity.sha256)
      throw Error("Store artifact SHA-256 mismatch");
    return bytes;
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
} = {}) {
  if (typeof fetchImpl !== "function") throw TypeError("Native artifact fetch is required");
  const identities = Object.fromEntries(ARTIFACT_ROLES.map(role =>
    [role, validateAppArtifactIdentity(candidate?.artifacts?.[role])]));
  // Validate origin before creating any files or accepting a cache hit.
  const urls = Object.fromEntries(ARTIFACT_ROLES.map(role =>
    [role, desktopStoreArtifactUrl(baseOrigin, identities[role])]));
  if (typeof userData !== "string") throw TypeError("Native artifact userData is required");
  const store = await realDirectory(join(userData, "Store"));
  const artifacts = await ensureDirectory(join(store, "artifacts"));
  const version = await ensureDirectory(join(artifacts, "v1"));
  const hashes = await ensureDirectory(join(version, "sha256"));
  const result = {};
  for (const role of ARTIFACT_ROLES) {
    const identity = identities[role], name = identity.sha256;
    const parent = await ensureDirectory(join(hashes, name.slice(0, 2)));
    const cached = await verifiedCached(join(parent, name), identity);
    result[role] = cached ?? await persistVerified(
      parent, name, await download(identity, urls[role], fetchImpl), identity);
  }
  return Object.freeze(result);
}
