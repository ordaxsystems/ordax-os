// Read-only Windows Desktop transport for the existing Go runtime-component
// verifier. The Electron owner selects the verified OS/template root; no
// private key, HTTP client, or Surface renderer may select verifier/trust paths.
// Activation, pending health, probation and rollback remain separate owners.
import { execFile } from "node:child_process";
import { lstatSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { readDesktopPinnedComponentTrust, withinPinnedRoot as within } from "./pinned-component-trust.mjs";
import {
  EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS,
  EXTERNAL_FIRST_PARTY_NATIVE_PROBATION_IDS,
} from "../../services/apps/external-first-party-policy.mjs";

const META = "/__ordax/native/component-runtime";
const COMPAT = "/__ordax/native/component-compatibility";
const MODULE = "/__ordax/native/component-module/";
const IDS = new Set(EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS);
// Narrow signed pending reads to the probation scope derived from the same
// package SSOT. They grant neither activation nor any lifecycle mutation.
const PENDING_IDS = new Set(EXTERNAL_FIRST_PARTY_NATIVE_PROBATION_IDS);
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const MAX_META = 16 * 1024;
const MAX_COMPAT = 96 * 1024;
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

function trustedConfiguration(systemRoot, verifierRoot, userData) {
  const trusted = readDesktopPinnedComponentTrust(systemRoot, verifierRoot);
  if (!trusted) return null;
  const root = join(userData, "Components");
  try {
    const slot = lstatSync(root);
    if (!slot.isDirectory() || slot.isSymbolicLink()) return null;
    return Object.freeze({ ...trusted, root });
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
  if (!["current", "pending"].includes(state) || fields.get(marker) !== "YES"
    || fields.get("COMPONENT_ID") !== id || fields.get("RUNTIME_SERVED_FROM_SLOT") !== "NO"
    || !/^(0|[1-9][0-9]*)$/.test(fields.get("REVISION") ?? "")
    || !Number.isSafeInteger(Number(fields.get("REVISION")))) throw Error("Component verifier identity mismatch");
  const revision = Number(fields.get("REVISION"));
  const source = fields.get("SOURCE");
  if (state === "current" && (source === "ABSENT" || source === "REMOVED")) {
    if (fields.size !== 5) throw Error("Unexpected absent component fields");
    return { componentId: id, state, source: source === "REMOVED" ? "removed" : "absent",
      revision, version: null, sourceCommit: null, entrypoint: null, pendingHealth: null };
  }
  const versionKey = state === "current" ? "CURRENT_VERSION" : "PENDING_VERSION";
  const commitKey = state === "current" ? "CURRENT_SOURCE_COMMIT" : "PENDING_SOURCE_COMMIT";
  // The Go owner attests signed release/health modes with the exact
  // activation generation. For probation, only unknown-health pending
  // runtime slots are readable; healthy/failed need a new decision, not a probe.
  if (source !== "SLOT" || fields.size !== (state === "pending" ? 12 : 11)
    || fields.get("RELEASE_MODE") !== "component-slot"
    || (state === "pending"
      ? fields.get("HEALTH_MODE") !== "runtime"
        || fields.get("PENDING_HEALTH") !== "unknown"
      : !["runtime", "none"].includes(fields.get("HEALTH_MODE")))
    || !SEMVER.test(fields.get(versionKey) ?? "")
    || !SHA.test(fields.get(commitKey) ?? "")
    || !within(slotRoot, fields.get("SLOT") ?? "")
    || !(fields.get("ENTRYPOINT") ?? "").startsWith("system/apps/" + id + "/")
    || !(fields.get("ENTRYPOINT") ?? "").split("/").every(part => SEGMENT.test(part) && part !== "." && part !== ".."))
    throw Error("Invalid verified component slot");
  return { componentId: id, state, source: "slot", revision,
    version: fields.get(versionKey), sourceCommit: fields.get(commitKey),
    entrypoint: fields.get("ENTRYPOINT"),
    pendingHealth: state === "pending" ? fields.get("PENDING_HEALTH") : null };
}

function parseRequest(url) {
  if (typeof url !== "string") return null;
  const [path, rawQuery, ...extra] = url.split("?");
  // A middleware must never answer for an unrelated Native/static route.
  // This also preserves the established 404 on unsafe ordinary file paths.
  if (path !== META && path !== COMPAT && !path.startsWith(MODULE)) return null;
  if (url.length > 900 || /[%\\#\0]/.test(url) || url.includes("//"))
    return { error: 400 };
  if (extra.length) return { error: 400 };
  if (path === COMPAT) {
    if (typeof rawQuery !== "string") return { error: 400 };
    const query = new URLSearchParams(rawQuery);
    if ([...query.keys()].sort().join(",") !== "component,revision,state") return { error: 400 };
    const id = query.get("component"), state = query.get("state");
    const textRevision = query.get("revision");
    if (!ID.test(id ?? "") || !IDS.has(id) || state !== "current") return { error: 404 };
    if (!/^[1-9][0-9]{0,15}$/.test(textRevision ?? "")
      || !Number.isSafeInteger(Number(textRevision))) return { error: 400 };
    return { id, state, revision: Number(textRevision), kind: "compatibility" };
  }
  if (path === META) {
    if (typeof rawQuery !== "string") return { error: 400 };
    const query = new URLSearchParams(rawQuery);
    if ([...query.keys()].sort().join(",") !== "component,state") return { error: 400 };
    const id = query.get("component"), state = query.get("state");
    if (!ID.test(id ?? "") || !IDS.has(id)
      || (state !== "current" && !(state === "pending" && PENDING_IDS.has(id))))
      return { error: 404 };
    return { id, state, kind: "metadata" };
  }
  if (path.startsWith(MODULE)) {
    if (rawQuery !== undefined) return { error: 400 };
    const parts = path.slice(MODULE.length).split("/");
    if (parts.length < 7) return { error: 400 };
    const [id, state, version, sourceCommit, ...fileParts] = parts;
    if (!ID.test(id) || !IDS.has(id)
      || (state !== "current" && !(state === "pending" && PENDING_IDS.has(id))))
      return { error: 404 };
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

// The Go channel verifies release/2 signature, the sidecar digest and the
// canonical activation revision. This transport only checks the reported
// identity against the requested snapshot; it does not sign or grant anything.
function parseSignedCompatibility(output, request, trustSha256) {
  if (!Buffer.isBuffer(output) || output.length > MAX_COMPAT)
    throw Error("Signed component compatibility output exceeds bounds");
  const report = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output));
  const slot = report?.verifiedSlot;
  const descriptor = slot?.descriptor;
  if (report?.schema !== "ordax.activation-slot-compatibility-snapshot/1"
    || report.authority !== "none" || report.trustScope !== "caller-supplied-public-anchor"
    || report.trustSHA256 !== trustSha256
    || report.componentId !== request.id || report.target !== "current"
    || report.revision !== request.revision
    || slot?.schema !== "ordax.verified-slot-compatibility/1"
    || slot.authority !== "none"
    || slot.trustScope !== "caller-supplied-public-anchor"
    || slot.trustSHA256 !== trustSha256
    || slot.activationStatus !== "not-evaluated"
    || slot.componentId !== request.id
    || !SEMVER.test(slot.version ?? "") || !SHA.test(slot.sourceCommit ?? "")
    || descriptor?.schema !== "ordax.component-compatibility/1"
    || descriptor.componentId !== request.id
    || descriptor.componentVersion !== slot.version
    || descriptor.authority !== "none") {
    throw Error("Signed component compatibility identity mismatch");
  }
  return Object.freeze({
    schema: "ordax.native-verified-current-compatibility/1",
    componentId: request.id,
    state: "current",
    revision: request.revision,
    version: slot.version,
    sourceCommit: slot.sourceCommit,
    descriptor,
  });
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
      if (request.kind === "compatibility") {
        const output = await invoke(config.helper, [
          "inspect-activation-compatibility-v2",
          "--component", request.id, "--target", "current",
          "--expected-revision", String(request.revision),
          "--trust", config.trust, "--root", config.root,
        ], execFileImpl, MAX_COMPAT);
        const verified = parseSignedCompatibility(output, request, config.trustSha256);
        return respond(res, 200, JSON.stringify(verified));
      }
      if (request.kind === "metadata") {
        const output = await invoke(config.helper, [
          request.state === "pending" ? "resolve-pending" : "resolve-current",
          "--component", request.id,
          "--trust", config.trust, "--root", config.root,
        ], execFileImpl, MAX_META);
        const identity = parseFields(output, request.id, request.state, config.root);
        return respond(res, 200, JSON.stringify(identity));
      }
      // Exact immutable identity: the Go channel revalidates the signed slot
      // and activation state for every individual file read.
      const output = await invoke(config.helper, [
        "read-runtime-file", "--component", request.id, "--state", request.state,
        "--version", request.version, "--source-commit", request.sourceCommit,
        "--path", request.file, "--trust", config.trust, "--root", config.root,
      ], execFileImpl, MAX_MODULE);
      return respond(res, 200, output, request.mime);
    })().catch(() => respond(res, 409));
  };
}
