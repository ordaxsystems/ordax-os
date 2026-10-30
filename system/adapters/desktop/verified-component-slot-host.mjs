// Read-only Windows Desktop transport for the existing Go runtime-component
// verifier. The Electron owner selects the verified OS/template root; no
// private key, HTTP client, or Surface renderer may select verifier/trust paths.
// Activation, pending health, probation and rollback remain separate owners.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS } from "../../services/apps/external-first-party-policy.mjs";

const META = "/__ordax/native/component-runtime";
const MODULE = "/__ordax/native/component-module/";
const IDS = new Set(EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS);
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const MAX_META = 16 * 1024;
const MAX_MODULE = 2 * 1024 * 1024;
const REQUEST_TIMEOUT = 3000;
const MIME = Object.freeze({
  ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".avif": "image/avif", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".otf": "font/otf",
});

function regular(path, maxBytes) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink()
      && stat.size > 0 && stat.size <= maxBytes;
  } catch { return false; }
}

function within(root, path) {
  if (!isAbsolute(path)) return false;
  const rest = relative(root, path);
  return rest.length > 0 && rest !== ".." && !rest.startsWith(".." + sep)
    && !isAbsolute(rest);
}

function trustedConfiguration(systemRoot, verifierRoot, userData) {
  // Re-evaluate on every request; a removed or changed anchor revokes reads.
  const policyPath = join(systemRoot, "docs", "contracts", "runtime-component-trust-policy.json");
  const packagePolicyPath = join(systemRoot, "docs", "contracts", "runtime-component-package.json");
  const anchorPath = join(systemRoot, "system", "trust", "runtime-components-ed25519.json");
  const helper = join(verifierRoot, "tools", "runtime-component-channel", "ordax-runtime-component-channel.exe");
  const root = join(userData, "Components");
  if (!regular(policyPath, 64 * 1024) || !regular(packagePolicyPath, 64 * 1024)
      || !regular(anchorPath, 16 * 1024) || !regular(helper, 32 * 1024 * 1024)) return null;
  try {
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    const packagePolicy = JSON.parse(readFileSync(packagePolicyPath, "utf8"));
    if (policy["$schema"] !== "prototype-ordax.runtime-component-trust-policy/1"
      || policy.status !== "canonical-public-trust-pinned"
      || policy.trust_domain !== "runtime-components"
      || policy.key_id !== "ordax-runtime-components-v1"
      || policy.public_anchor?.repository_path !== "system/trust/runtime-components-ed25519.json"
      || policy.public_anchor?.pinned !== true
      || policy.current_gates?.canonical_component_trust_anchor_pinned !== true
      || packagePolicy["$schema"] !== "prototype-ordax.runtime-component-package-policy/1"
      || packagePolicy.canonical_component_trust_anchor_pinned !== true
      || !SHA256.test(policy.public_anchor?.sha256)) return null;
    const anchor = readFileSync(anchorPath);
    if (createHash("sha256").update(anchor).digest("hex") !== policy.public_anchor.sha256) return null;
    const trust = JSON.parse(anchor.toString("utf8"));
    if (trust["$schema"] !== "prototype-ordax.runtime-component-trust/1"
      || trust.key_id !== policy.key_id
      || typeof trust.public_key_base64 !== "string"
      || !/^[A-Za-z0-9+/]{43}=$/.test(trust.public_key_base64)
      || Buffer.from(trust.public_key_base64, "base64").length !== 32) return null;
    // The executable is part of the Electron-installed runtime-template, not
    // the Git-managed OS checkout selected by ordax-pull. Only the Electron
    // owner may select this path. Policies and anchor still belong to the
    // exact active OS checkout. Never resolve executable files from user data.
    if (lstatSync(verifierRoot).isSymbolicLink()
      || !within(realpathSync(verifierRoot), realpathSync(helper))
      || !within(realpathSync(systemRoot), realpathSync(anchorPath))) return null;
    const slot = lstatSync(root);
    if (!slot.isDirectory() || slot.isSymbolicLink()) return null;
    return Object.freeze({ helper, trust: anchorPath, root });
  } catch { return null; }
}

function parseFields(buffer, id, state, slotRoot) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_META) throw Error("Invalid component verifier output");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  const fields = new Map();
  for (const line of text.trimEnd().split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1) throw Error("Malformed component verifier output");
    const key = line.slice(0, eq), value = line.slice(eq + 1);
    if (!/^[A-Z][A-Z_]*$/.test(key) || fields.has(key)) throw Error("Duplicate or invalid component verifier field");
    fields.set(key, value);
  }
  const marker = state === "current" ? "RUNTIME_COMPONENT_CURRENT_RESOLVED" : "RUNTIME_COMPONENT_PENDING_RESOLVED";
  if (state !== "current" || fields.get(marker) !== "YES"
    || fields.get("COMPONENT_ID") !== id || fields.get("RUNTIME_SERVED_FROM_SLOT") !== "NO"
    || !/^(0|[1-9][0-9]*)$/.test(fields.get("REVISION") ?? "")
    || !Number.isSafeInteger(Number(fields.get("REVISION")))) throw Error("Component verifier identity mismatch");
  const revision = Number(fields.get("REVISION"));
  const source = fields.get("SOURCE");
  if (source === "ABSENT" || source === "REMOVED") {
    if (fields.size !== 5) throw Error("Unexpected absent component fields");
    return { componentId: id, state, source: source === "REMOVED" ? "removed" : "absent",
      revision, version: null, sourceCommit: null, entrypoint: null, pendingHealth: null };
  }
  if (source !== "SLOT" || fields.size !== 9
    || !SEMVER.test(fields.get("CURRENT_VERSION") ?? "")
    || !SHA.test(fields.get("CURRENT_SOURCE_COMMIT") ?? "")
    || !within(slotRoot, fields.get("SLOT") ?? "")
    || !(fields.get("ENTRYPOINT") ?? "").startsWith("system/apps/" + id + "/")
    || !(fields.get("ENTRYPOINT") ?? "").split("/").every(part => SEGMENT.test(part) && part !== "." && part !== ".."))
    throw Error("Invalid verified current component slot");
  return { componentId: id, state, source: "slot", revision,
    version: fields.get("CURRENT_VERSION"), sourceCommit: fields.get("CURRENT_SOURCE_COMMIT"),
    entrypoint: fields.get("ENTRYPOINT"), pendingHealth: null };
}

function parseRequest(url) {
  if (typeof url !== "string") return null;
  const [path, rawQuery, ...extra] = url.split("?");
  // A middleware must never answer for an unrelated Native/static route.
  // This also preserves the established 404 on unsafe ordinary file paths.
  if (path !== META && !path.startsWith(MODULE)) return null;
  if (url.length > 900 || /[%\\#\0]/.test(url) || url.includes("//"))
    return { error: 400 };
  if (extra.length) return { error: 400 };
  if (path === META) {
    if (typeof rawQuery !== "string") return { error: 400 };
    const query = new URLSearchParams(rawQuery);
    if ([...query.keys()].sort().join(",") !== "component,state") return { error: 400 };
    const id = query.get("component"), state = query.get("state");
    if (!ID.test(id ?? "") || !IDS.has(id) || state !== "current") return { error: 404 };
    return { id, state, kind: "metadata" };
  }
  if (path.startsWith(MODULE)) {
    if (rawQuery !== undefined) return { error: 400 };
    const parts = path.slice(MODULE.length).split("/");
    if (parts.length < 7) return { error: 400 };
    const [id, state, version, sourceCommit, ...fileParts] = parts;
    if (!ID.test(id) || !IDS.has(id) || state !== "current") return { error: 404 };
    if (!SEMVER.test(version) || !SHA.test(sourceCommit)
      || !fileParts.every(part => SEGMENT.test(part) && part !== "." && part !== "..")
      || fileParts.slice(0, 3).join("/") !== "system/apps/" + id
      || fileParts.length < 4) return { error: 400 };
    const file = fileParts.join("/");
    const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
    const mime = MIME[extension];
    if (!mime) return { error: 404 };
    return { kind: "module", id, state, version, sourceCommit, file, mime };
  }
  return null;
}

function invoke(helper, args, execFileImpl, max) {
  return new Promise((resolve, reject) => {
    execFileImpl(helper, args, {
      encoding: "buffer", timeout: REQUEST_TIMEOUT,
      maxBuffer: max, windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" },
    }, (error, stdout) => {
      if (error) return reject(Error("Canonical runtime component verification failed"));
      if (!Buffer.isBuffer(stdout) || stdout.length > max) return reject(Error("Unbounded component output"));
      resolve(stdout);
    });
  });
}

export function createDesktopVerifiedComponentSlotMiddleware({
  systemRoot, verifierRoot, userData, platform = process.platform, execFileImpl = execFile,
} = {}) {
  if (typeof systemRoot !== "string" || !isAbsolute(systemRoot)
    || typeof verifierRoot !== "string" || !isAbsolute(verifierRoot)
    || typeof userData !== "string" || !isAbsolute(userData)
    || typeof execFileImpl !== "function") throw TypeError("Verified Desktop component paths are required");
  const respond = (res, status, body = null, mime = "application/json; charset=utf-8") => {
    if (res.headersSent) return res.destroy();
    res.writeHead(status, {
      "Content-Type": mime, "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  };
  return function desktopVerifiedComponentMiddleware(req, res, next) {
    const request = parseRequest(req.url);
    if (request === null) return next();
    if (request.error) return respond(res, request.error);
    if (req.method !== "GET") return respond(res, 405);
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket?.remoteAddress))
      return respond(res, 403);
    // No Windows signed-slot release is operational until a canonical anchor,
    // verified helper executable and installed slot tree all exist together.
    const config = platform === "win32" ? trustedConfiguration(systemRoot, verifierRoot, userData) : null;
    if (!config) return respond(res, 404);
    void (async () => {
      if (request.kind === "metadata") {
        const output = await invoke(config.helper, [
          "resolve-current", "--component", request.id,
          "--trust", config.trust, "--root", config.root,
        ], execFileImpl, MAX_META);
        const identity = parseFields(output, request.id, request.state, config.root);
        return respond(res, 200, JSON.stringify(identity));
      }
      // Exact immutable identity: the Go channel revalidates the signed slot
      // and activation state for every individual file read.
      const output = await invoke(config.helper, [
        "read-runtime-file", "--component", request.id, "--state", "current",
        "--version", request.version, "--source-commit", request.sourceCommit,
        "--path", request.file, "--trust", config.trust, "--root", config.root,
      ], execFileImpl, MAX_MODULE);
      return respond(res, 200, output, request.mime);
    })().catch(() => respond(res, 409));
  };
}
