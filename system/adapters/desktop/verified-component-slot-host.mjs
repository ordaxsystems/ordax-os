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
// Pending MODULE bytes are restricted to canonical probation-capable apps.
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
const MAX_ACTIVE_VERIFIER_READS = 6;
const MAX_QUEUED_VERIFIER_READS = 64;
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
  if (source !== "SLOT" || fields.size !== 11
    || fields.get("RELEASE_MODE") !== "component-slot"
    || !["runtime", "none"].includes(fields.get("HEALTH_MODE"))
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

function parsePendingActivationStatus(output, id) {
  if (!Buffer.isBuffer(output) || output.length > MAX_META)
    throw Error("Pending activation status exceeds bounds");
  const state = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output));
  if (!state || Array.isArray(state)
    || state.$schema !== "prototype-ordax.runtime-component-activation-state/1"
    || state.component_id !== id
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !["unknown", "healthy", "failed"].includes(state.pending_health)) {
    throw Error("Noncanonical pending activation status");
  }
  if (state.pending === null) {
    if (state.pending_health !== "unknown")
      throw Error("Activation has health without a pending slot");
    return null;
  }
  if (!state.pending || Array.isArray(state.pending)
    || !SEMVER.test(state.pending.version ?? "")
    || !SHA.test(state.pending.source_commit ?? "")) {
    throw Error("Noncanonical pending component identity");
  }
  return {
    revision: state.revision, version: state.pending.version,
    sourceCommit: state.pending.source_commit, pendingHealth: state.pending_health,
  };
}

function parseSignedPendingResolution(output, id, slotRoot, expected) {
  if (!Buffer.isBuffer(output) || output.length > MAX_META)
    throw Error("Pending Go verification output exceeds bounds");
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(output);
  const fields = new Map();
  for (const line of raw.trimEnd().split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1) throw Error("Malformed pending Go verification output");
    const key = line.slice(0, eq);
    if (!/^[A-Z][A-Z_]*$/.test(key) || fields.has(key))
      throw Error("Duplicate pending Go verification field");
    fields.set(key, line.slice(eq + 1));
  }
  const path = fields.get("ENTRYPOINT") ?? "";
  if (fields.size !== 12
    || fields.get("RELEASE_MODE") !== "component-slot"
    || fields.get("HEALTH_MODE") !== "runtime"
    || fields.get("RUNTIME_COMPONENT_PENDING_RESOLVED") !== "YES"
    || fields.get("COMPONENT_ID") !== id
    || fields.get("RUNTIME_SERVED_FROM_SLOT") !== "NO"
    || fields.get("SOURCE") !== "SLOT"
    || fields.get("REVISION") !== String(expected.revision)
    || fields.get("PENDING_VERSION") !== expected.version
    || fields.get("PENDING_SOURCE_COMMIT") !== expected.sourceCommit
    || fields.get("PENDING_HEALTH") !== expected.pendingHealth
    || !within(slotRoot, fields.get("SLOT") ?? "")
    || !path.startsWith("system/apps/" + id + "/")
    || !path.split("/").every(part => SEGMENT.test(part) && part !== "." && part !== "..")) {
    throw Error("Signed pending slot differs from Go activation generation");
  }
  return {
    componentId: id, state: "pending", source: "slot",
    revision: expected.revision, version: expected.version,
    sourceCommit: expected.sourceCommit, entrypoint: path,
    pendingHealth: expected.pendingHealth,
  };
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
      || !["current", "pending"].includes(state)) return { error: 404 };
    return { id, state, kind: state === "pending" ? "pending-metadata" : "metadata" };
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
  // Every valid file read launches a Go verifier. Bound both parallel
  // processes and queued requests so a burst of module imports cannot exhaust
  // Windows Desktop resources or delay the rest of the Surface indefinitely.
  // Never cache verified bytes or bypass the Go signed-slot reader.
  const readQueue = [];
  let activeReads = 0;
  const runNextRead = () => {
    while (activeReads < MAX_ACTIVE_VERIFIER_READS && readQueue.length) {
      const next = readQueue.shift();
      next.res.removeListener("close", next.onDisconnect);
      if (next.res.destroyed) continue;
      activeReads++;
      void Promise.resolve().then(next.run)
        .catch(() => respond(next.res, 409))
        .finally(() => {
          activeReads--;
          runNextRead();
        });
    }
  };
  const enqueueRead = (res, run) => {
    if (readQueue.length >= MAX_QUEUED_VERIFIER_READS) {
      return respond(res, 503);
    }
    const entry = {
      res, run,
      onDisconnect() {
        if (res.writableEnded) return;
        const index = readQueue.indexOf(entry);
        if (index >= 0) readQueue.splice(index, 1);
      },
    };
    res.once("close", entry.onDisconnect);
    readQueue.push(entry);
    runNextRead();
  };
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
    // A loopback peer alone is not an origin proof: DNS rebinding can reach a
    // local server with an attacker-controlled Host. Browser subresources may
    // omit Origin, so independently reject explicit cross-site Fetch Metadata.
    // The installed Surface and Vite Native host both use 127.0.0.1 or ::1.
    const port = req.socket?.localPort;
    const host = req.headers.host;
    if (!Number.isInteger(port) || port < 1 || port > 65535
      || host !== "127.0.0.1:" + port && host !== "[::1]:" + port
      || req.headers.origin !== undefined
        && req.headers.origin !== "http://" + host
      || req.headers["sec-fetch-site"] !== undefined
        && !["same-origin", "none"].includes(req.headers["sec-fetch-site"])) {
      return respond(res, 403);
    }
    // No Windows signed-slot release is operational until a canonical anchor,
    // verified helper executable and installed slot tree all exist together.
    const config = platform === "win32" ? trustedConfiguration(systemRoot, verifierRoot, userData) : null;
    if (!config) return respond(res, 404);
    return enqueueRead(res, async () => {
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
      if (request.kind === "pending-metadata") {
        // A 204 is a real Go state observation of no pending candidate, not
        // proof of an installed app. Present pending metadata only after a
        // second signed-slot verification matches the observed exact revision.
        const status = parsePendingActivationStatus(await invoke(config.helper, [
          "status", "--component", request.id, "--root", config.root,
        ], execFileImpl, MAX_META), request.id);
        if (status === null) return respond(res, 204);
        const pending = parseSignedPendingResolution(await invoke(config.helper, [
          "resolve-pending", "--component", request.id,
          "--trust", config.trust, "--root", config.root,
        ], execFileImpl, MAX_META), request.id, config.root, status);
        return respond(res, 200, JSON.stringify(pending));
      }
      if (request.kind === "metadata") {
        const output = await invoke(config.helper, [
          "resolve-current", "--component", request.id,
          "--trust", config.trust, "--root", config.root,
        ], execFileImpl, MAX_META);
        const identity = parseFields(output, request.id, request.state, config.root);
        return respond(res, 200, JSON.stringify(identity));
      }
      // A pending probation read must be tied to the exact UNKNOWN-health
      // activation generation, independently of the Go file-read signature.
      // The installed Go channel revalidates the slot for every file read;
      // never cache verified bytes or fabricate a successful health decision.
      if (request.state === "pending") {
        const status = parsePendingActivationStatus(await invoke(config.helper, [
          "status", "--component", request.id, "--root", config.root,
        ], execFileImpl, MAX_META), request.id);
        if (!status || status.pendingHealth !== "unknown"
          || status.version !== request.version
          || status.sourceCommit !== request.sourceCommit) return respond(res, 409);
        parseSignedPendingResolution(await invoke(config.helper, [
          "resolve-pending", "--component", request.id,
          "--trust", config.trust, "--root", config.root,
        ], execFileImpl, MAX_META), request.id, config.root, status);
      }
      const output = await invoke(config.helper, [
        "read-runtime-file", "--component", request.id, "--state", request.state,
        "--version", request.version, "--source-commit", request.sourceCommit,
        "--path", request.file, "--trust", config.trust, "--root", config.root,
      ], execFileImpl, MAX_MODULE);
      return respond(res, 200, output, request.mime);
    });
  };
}
