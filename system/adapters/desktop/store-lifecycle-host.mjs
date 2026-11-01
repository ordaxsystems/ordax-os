// Windows Native Store removal transport. This adapter has no package installer,
// signing key, activation writer or App Data authority: Go owns the mutation.
// Install/update remain unavailable until the complete artifact/pending-health
// protocol is implemented; never acknowledge a request without Go readback.
import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { validateAppLifecyclePlan } from "../../contracts/app-lifecycle-plan.mjs";
import { APP_LIFECYCLE_REQUEST_RESULT_SCHEMA } from "../../contracts/app-lifecycle-request.mjs";
import { isExternalFirstPartyComponentId } from "../../services/apps/external-first-party-policy.mjs";
import { readDesktopPinnedComponentTrust } from "./pinned-component-trust.mjs";
import { withDesktopStoreCatalogWatermark } from "./verified-store-catalog-host.mjs";

const ENDPOINT = "/__ordax/native/store-lifecycle";
const MAX_BODY = 32 * 1024;
const MAX_GO_OUTPUT = 64 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const HOST = /^(?:127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/;
const RECEIPT_KEYS = new Set([
  "RUNTIME_COMPONENT_STATE_UNINSTALLED", "COMPONENT_ID", "REVISION",
  "CURRENT_PRESENT", "APP_DATA_TOUCHED", "SLOT_CACHE_PURGED",
]);

function decode(output) {
  if (!Buffer.isBuffer(output) || output.length > MAX_GO_OUTPUT) {
    throw Error("Canonical Go output exceeded bounds");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(output);
}

function executeGo(helper, args, execFileImpl) {
  return new Promise((resolve, reject) => {
    execFileImpl(helper, args, {
      encoding: "buffer", timeout: 30000, maxBuffer: MAX_GO_OUTPUT,
      windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" },
    }, (error, stdout) => {
      if (error) return reject(Error("Canonical Go lifecycle command failed"));
      try { resolve(decode(stdout)); } catch (cause) { reject(cause); }
    });
  });
}

function parseUninstallReceipt(stdout, plan) {
  const record = new Map();
  for (const line of stdout.trim().split("\n")) {
    const at = line.indexOf("=");
    if (at < 1) throw Error("Malformed Go uninstall receipt");
    const name = line.slice(0, at);
    if (record.has(name) || !RECEIPT_KEYS.has(name)) throw Error("Noncanonical Go uninstall receipt");
    record.set(name, line.slice(at + 1));
  }
  const expected = plan.expectedActivation.revision + 1;
  if (record.size !== RECEIPT_KEYS.size
    || record.get("RUNTIME_COMPONENT_STATE_UNINSTALLED") !== "YES"
    || record.get("COMPONENT_ID") !== plan.request.appId
    || record.get("REVISION") !== String(expected)
    || record.get("CURRENT_PRESENT") !== "NO"
    || record.get("APP_DATA_TOUCHED") !== "NO"
    || record.get("SLOT_CACHE_PURGED") !== "NO") {
    throw Error("Go uninstall receipt failed canonical comparison");
  }
  return expected;
}

function assertDurableUninstall(stdout, plan, revision) {
  const state = JSON.parse(stdout);
  const previous = plan.expectedActivation;
  if (!state || Array.isArray(state) || typeof state !== "object"
    || state.$schema !== "prototype-ordax.runtime-component-activation-state/1"
    || state.component_id !== plan.request.appId
    || state.revision !== revision || state.current !== null
    || state.previous !== null || state.pending !== null
    || state.rejected !== null || state.pending_health !== "unknown"
    || state.user_removed !== true
    || state.removed_identity?.version !== previous.version
    || state.removed_identity?.source_commit !== previous.sourceCommit) {
    throw Error("Go uninstall was not durably observed");
  }
}

function matchesCatalogCandidate(plan, catalog) {
  if (plan.candidate === null) return true; // Removal of unlisted installed apps is permitted.
  const entry = catalog.entries.find(item => item.appId === plan.request.appId);
  if (!entry || entry.version !== plan.candidate.version
    || entry.sourceCommit !== plan.candidate.sourceCommit) return false;
  return ["package", "release", "compatibility", "componentEnvelope"].every(role => {
    const expected = entry.artifacts[role], actual = plan.candidate.artifacts[role];
    return expected.name === actual.name && expected.sha256 === actual.sha256
      && expected.size === actual.size;
  });
}

async function readBody(req) {
  const length = req.headers["content-length"];
  if (length !== undefined
    && (!/^[0-9]+$/.test(length) || Number(length) > MAX_BODY)) {
    throw Error("Store lifecycle request too large");
  }
  const chunks = [];
  let lengthRead = 0;
  for await (const chunk of req) {
    lengthRead += chunk.length;
    if (lengthRead > MAX_BODY) throw Error("Store lifecycle request too large");
    chunks.push(chunk);
  }
  if (lengthRead === 0) throw Error("Missing Store lifecycle request");
  return JSON.parse(decode(Buffer.concat(chunks, lengthRead)));
}

export function createDesktopStoreLifecycleMiddleware({
  systemRoot, verifierRoot, userData, catalogReader,
  platform = process.platform, execFileImpl = execFile,
} = {}) {
  if (typeof systemRoot !== "string" || typeof verifierRoot !== "string"
    || typeof userData !== "string" || typeof catalogReader !== "function"
    || typeof execFileImpl !== "function") {
    throw TypeError("Windows Store lifecycle requires installed Native owners");
  }
  let queue = Promise.resolve();

  async function remove(plan) {
    if (platform !== "win32" || plan.request.operation !== "remove"
      || !isExternalFirstPartyComponentId(plan.request.appId)
      || plan.expectedActivation.source !== "slot") {
      throw Error("Store lifecycle operation is unavailable");
    }
    const pinned = readDesktopPinnedComponentTrust(systemRoot, verifierRoot);
    if (!pinned || !pinned.publicationAuthorized)
      throw Error("Store canonical trust is unavailable");
    // Local-only signed verification; never let an install/removal request
    // choose a URL or start network traffic inside a privileged mutation.
    const catalog = await catalogReader();
    if (catalog.state !== "ready" || catalog.sequence !== plan.catalogSequence
      || catalog.catalogSha256 !== plan.catalogSha256
      || catalog.source?.commit !== plan.catalogSourceCommit
      || !matchesCatalogCandidate(plan, catalog))
      throw Error("Lifecycle plan does not match signed local catalog");

    const slotRoot = join(userData, "Components");
    const slots = await lstat(slotRoot);
    if (!slots.isDirectory() || slots.isSymbolicLink())
      throw Error("Canonical component slot directory is unavailable");
    await withDesktopStoreCatalogWatermark(userData, async accepted => {
      if (accepted.sequence !== catalog.sequence
        || accepted.catalogSha256 !== catalog.catalogSha256)
        throw Error("Store catalog advanced before Go state mutation");
      const latest = readDesktopPinnedComponentTrust(systemRoot, verifierRoot);
      if (!latest || !latest.publicationAuthorized
        || latest.trustSha256 !== pinned.trustSha256
        || latest.helper !== pinned.helper || latest.trust !== pinned.trust)
        throw Error("Store trust changed before Go state mutation");
      const expected = plan.expectedActivation;
      const receipt = await executeGo(pinned.helper, [
        "uninstall-state", "--component", plan.request.appId,
        "--version", expected.version, "--source-commit", expected.sourceCommit,
        "--expected-revision", String(expected.revision),
        "--trust", pinned.trust, "--root", slotRoot,
      ], execFileImpl);
      const revision = parseUninstallReceipt(receipt, plan);
      const status = await executeGo(pinned.helper, [
        "status", "--component", plan.request.appId, "--root", slotRoot,
      ], execFileImpl);
      assertDurableUninstall(status, plan, revision);
    });
    return {
      schema: APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
      requestId: plan.request.requestId, appId: plan.request.appId,
      operation: "remove", source: plan.request.source,
      state: "accepted", reason: null, authority: "none",
    };
  }

  return function desktopStoreLifecycle(req, res, next) {
    if (req.url?.split("?")[0] !== ENDPOINT) return next();
    const reply = (status, body = { error: "Store lifecycle unavailable" }) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(body));
    };
    if (req.url !== ENDPOINT) return reply(400);
    if (req.method !== "POST") return reply(405);
    if (!LOOPBACK.has(req.socket?.remoteAddress)
      || typeof req.headers.host !== "string" || !HOST.test(req.headers.host)
      || req.headers.origin !== "http://" + req.headers.host)
      return reply(403);
    if (req.headers["content-type"] !== "application/json") return reply(415);
    const run = queue.then(async () => {
      let plan;
      try { plan = validateAppLifecyclePlan(await readBody(req)); }
      catch { return reply(400); }
      // This bridge intentionally does not turn an unsigned artifact into a
      // staged install: only the canonical Go uninstall is available here.
      if (plan.request.operation !== "remove") return reply(503);
      try { return reply(200, await remove(plan)); }
      catch { return reply(503); }
    }, () => reply(503));
    queue = run.then(() => {}, () => {});
    void run.catch(() => reply(503));
  };
}
