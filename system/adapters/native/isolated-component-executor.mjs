import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import {
  assertAppDataPort,
  validateAppDataDelete,
  validateAppDataKey,
  validateAppDataPut,
} from "../../contracts/app-data.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { validateWorkspaceTarget } from "../../contracts/workspace-store.mjs";
import { createSurfaceLocalizationSnapshot } from "../../services/i18n/surface.mjs";
import {
  createNativeComponentSlotAuthority,
  NativeComponentSlotAuthorityRevokedError,
} from "./component-slot-authority.mjs";
import { validateComponentRuntimeMetadata } from "../../contracts/component-runtime-metadata.mjs";

const EXECUTOR_SCHEMA = "ordax.native-isolated-component-executor/1";
const BRIDGE_SCHEMA = "ordax.native.isolated-component-bridge/1";
const PENDING_PROBE_SCHEMA = "ordax.native.isolated-component-probe/1";
const MAX_PENDING_CALLS = 64;
const MAX_SUBSCRIPTIONS = 16;
const COMPONENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const ENTRY_RE = /^[A-Za-z0-9._/-]+\.mjs$/;

function parseModuleIdentity(value, surfaceOrigin, allowedComponentIds, requiredState = "current") {
  let url;
  try { url = new URL(value); } catch { throw new TypeError("Installed module URL must be absolute"); }
  const match = /^\/__ordax\/native\/component-module\/([a-z][a-z0-9-]{0,63})\/(current|pending)\/([^/]+)\/([a-f0-9]{40})\/(.+)$/.exec(url.pathname);
  if (!match || url.origin !== surfaceOrigin || url.username || url.password || url.search || url.hash
    || !allowedComponentIds.has(match[1])
    || !VERSION_RE.test(match[3]) || !ENTRY_RE.test(match[5])
    || match[2] !== requiredState
    || match[5].split("/").some((part) => part === "" || part === "." || part === "..")
    || decodeURIComponent(url.pathname) !== url.pathname) {
    throw new TypeError(`Component module URL is outside the verified Native ${requiredState}-slot namespace`);
  }
  return Object.freeze({
    componentId: match[1], state: match[2], version: match[3],
    sourceCommit: match[4], entrypoint: match[5], moduleUrl: url.href,
    resourceRoot: `${url.origin}/__ordax/native/component-module/${match[1]}/${match[2]}/${match[3]}/${match[4]}/`,
  });
}

function nonceFor(windowRef) {
  const bytes = new Uint8Array(18);
  if (typeof windowRef.crypto?.getRandomValues !== "function") {
    throw new TypeError("Native sandbox requires a cryptographically random nonce");
  }
  windowRef.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function htmlAttribute(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const FRAME_BOOTSTRAP = String.raw`(() => {
  "use strict";
  const bridgeSchema = "ordax.native.isolated-component-bridge/1";
  const expectedParentOrigin = __PARENT_ORIGIN__;
  const expectedNonce = __NONCE__;
  let host = null;
  let runtimeMount = null;
  let mounted = false;
  let shuttingDown = false;
  let localeSnapshot = null;
  let appTarget = null;
  let nextRequest = 0;
  const pending = new Map();
  const renderListeners = new Set();
  const localeListeners = new Set();

  const send = (payload) => host?.postMessage({ schema: bridgeSchema, ...payload });
  const call = (operation, args = []) => new Promise((resolve, reject) => {
    if (!host || pending.size >= 64) { reject(new Error("Native app bridge is unavailable")); return; }
    const id = ++nextRequest;
    pending.set(id, { resolve, reject });
    send({ type: "call", id, operation, args });
  });
  const assertLocale = (snapshot) => {
    if (!snapshot || snapshot.schema !== "ordax.localization/2"
      || typeof snapshot.locale !== "string" || !snapshot.messages
      || typeof snapshot.messages !== "object") throw new TypeError("Sandbox localization snapshot is invalid");
    localeSnapshot = snapshot;
  };
  const localization = Object.freeze({
    schema: "ordax.localization/2",
    getLocale() { return localeSnapshot.locale; },
    getProfile() { return localeSnapshot.profile; },
    translate(messageId, values = {}) {
      if (typeof messageId !== "string" || !messageId) throw new TypeError("Localization message id is invalid");
      const text = localeSnapshot.messages[messageId];
      if (typeof text !== "string") throw new TypeError("Unknown Surface localization message: " + messageId);
      if (!values || typeof values !== "object" || Array.isArray(values)) throw new TypeError("Localization values are invalid");
      return text.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key) => {
        const value = values[key];
        if (value === undefined || value === null) return match;
        if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Localization values must be finite");
        if (typeof value !== "string" && typeof value !== "number") throw new TypeError("Localization values must be text or finite numbers");
        const rendered = String(value);
        if (rendered.length > 4096) throw new RangeError("Localization value exceeds 4096 characters");
        return rendered;
      });
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Localization listener is invalid");
      localeListeners.add(listener);
      listener(localeSnapshot.locale);
      return () => localeListeners.delete(listener);
    },
  });
  let lifecycle = null;
  let nextSubscription = 0;
  const subscriptionIds = new WeakMap();
  const appData = (identity) => {
    if (!identity || typeof identity.appId !== "string") throw new TypeError("App Data binding is unavailable");
    const assertIdentity = (candidate) => {
      if (!candidate || candidate.appId !== identity.appId
        || candidate.publisherId !== identity.publisherId || candidate.ownerScope !== identity.ownerScope) {
        throw new TypeError("App Data cannot change its verified identity");
      }
    };
    return Object.freeze({
      schema: "ordax.app-data/1", identity,
      get: (candidate, key) => { assertIdentity(candidate); return call("appData.get", [key]); },
      list: (candidate) => { assertIdentity(candidate); return call("appData.list", []); },
      put: (candidate, command) => { assertIdentity(candidate); return call("appData.put", [command]); },
      delete: (candidate, command) => { assertIdentity(candidate); return call("appData.delete", [command]); },
    });
  };
  const onHostMessage = async (event) => {
    const data = event.data;
    if (!data || data.schema !== bridgeSchema || typeof data.type !== "string") return;
    if (data.type === "reply") {
      if (!Number.isSafeInteger(data.id) || !pending.has(data.id)) return;
      const request = pending.get(data.id);
      pending.delete(data.id);
      if (data.ok === true) request.resolve(data.value);
      else request.reject(new Error(typeof data.error === "string" ? data.error : "Native app request failed"));
    } else if (data.type === "render") {
      if (data.appTarget === null || typeof data.appTarget === "string") appTarget = data.appTarget;
      for (const listener of [...renderListeners]) { try { listener(); } catch {} }
    } else if (data.type === "localization.update") {
      try {
        assertLocale(data.snapshot);
        for (const listener of [...localeListeners]) { try { listener(localeSnapshot.locale); } catch {} }
      } catch (error) { send({ type: "runtime.error", message: String(error?.message || error) }); }
    } else if (data.type === "shutdown") {
      if (shuttingDown) return;
      shuttingDown = true;
      try {
        await runtimeMount?.destroy();
        runtimeMount = null;
        mounted = false;
        send({ type: "destroyed" });
      } catch (error) {
        send({ type: "destroyed", error: String(error?.message || error).slice(0, 1024) });
      }
    }
  };

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (host || event.source !== parent || event.origin !== expectedParentOrigin
      || !data || data.schema !== bridgeSchema || data.type !== "initialize"
      || data.nonce !== expectedNonce || event.ports.length !== 1) return;
    host = event.ports[0];
    host.addEventListener("message", onHostMessage);
    host.start?.();
    try {
      const identity = data.appDataIdentity;
      if (!identity || !data.localizationSnapshot) throw new TypeError("Verified app context is incomplete");
      assertLocale(data.localizationSnapshot);
      appTarget = data.appTarget ?? null;
      lifecycle = Object.freeze({
        schema: "ordax.surface-render-lifecycle/5",
        localization,
        getAppTarget() { return appTarget; },
        setAppTarget(_appId, target) {
          if (_appId !== data.componentId) throw new TypeError("An app can only change its own Surface target");
          if (target !== null && (typeof target !== "string" || target.length > 4096)) throw new TypeError("Surface target is invalid");
          appTarget = target;
          void call("surface.setAppTarget", [target]).catch(() => {});
          return appTarget;
        },
        subscribeRender(listener) {
          if (typeof listener !== "function" || renderListeners.size >= 16) throw new TypeError("Surface render subscription is invalid");
          renderListeners.add(listener);
          const subscriptionId = ++nextSubscription;
          subscriptionIds.set(listener, subscriptionId);
          void call("surface.subscribeRender", [subscriptionId]).catch(() => renderListeners.delete(listener));
          listener();
          return () => {
            renderListeners.delete(listener);
            const id = subscriptionIds.get(listener);
            subscriptionIds.delete(listener);
            if (id !== undefined) void call("surface.unsubscribeRender", [id]).catch(() => {});
          };
        },
      });
      const module = await import(data.moduleUrl);
      const runtime = module?.componentRuntime;
      if (!runtime || runtime.schema !== "ordax.component-runtime/1"
        || runtime.componentId !== data.componentId || runtime.version !== data.version
        || typeof runtime.mount !== "function") throw new TypeError("Sandbox component runtime identity mismatch");
      runtimeMount = await runtime.mount({
        root: document.getElementById("ordax-app-root"),
        surfaceLifecycle: lifecycle,
        appData: appData(identity),
      });
      if (!runtimeMount || typeof runtimeMount.destroy !== "function") throw new TypeError("Sandbox component mount is invalid");
      mounted = true;
      send({ type: "mounted", componentId: data.componentId, version: data.version });
      const reportSize = () => {
        const height = Math.max(320, Math.min(6000, Math.ceil(document.documentElement.scrollHeight)));
        send({ type: "resize", height });
      };
      if (typeof ResizeObserver === "function") {
        const resizeObserver = new ResizeObserver(reportSize);
        resizeObserver.observe(document.documentElement);
        window.addEventListener("pagehide", () => resizeObserver.disconnect(), { once: true });
      }
      requestAnimationFrame(reportSize);
    } catch (error) {
      send({ type: "failed", message: String(error?.message || error).slice(0, 1024) });
    }
  }, { once: false });

  window.addEventListener("pagehide", () => {
    if (!mounted) return;
    mounted = false;
    try { runtimeMount?.destroy(); } catch {}
    runtimeMount = null;
  }, { once: true });
})();`;

function createFrameDocument({ nonce, parentOrigin, resourceRoot }) {
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${resourceRoot}`,
    `style-src 'unsafe-inline' ${resourceRoot}`,
    `img-src data: blob: ${resourceRoot}`,
    `font-src data: ${resourceRoot}`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
  ].join("; ");
  const script = FRAME_BOOTSTRAP
    .replace("__PARENT_ORIGIN__", JSON.stringify(parentOrigin))
    .replace("__NONCE__", JSON.stringify(nonce));
  return "<!doctype html><html><head><meta charset=\"utf-8\">"
    + `<meta http-equiv="Content-Security-Policy" content="${htmlAttribute(policy)}">`
    + "<meta name=\"referrer\" content=\"no-referrer\"></head>"
    + "<body style=\"margin:0;min-height:100%;overflow:auto\">"
    + "<main id=\"ordax-app-root\"></main>"
    + `<script nonce="${nonce}" type="module">${script}</script>`
    + "</body></html>";
}

const PENDING_PROBE_BOOTSTRAP = String.raw`(() => {
  "use strict";
  const schema = "ordax.native.isolated-component-probe/1";
  const expectedParentOrigin = __PARENT_ORIGIN__;
  const expectedNonce = __NONCE__;
  let started = false;
  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (started || event.source !== parent || event.origin !== expectedParentOrigin
      || !data || data.schema !== schema || data.type !== "probe"
      || data.nonce !== expectedNonce || event.ports.length !== 1
      || Object.keys(data).sort().join(",")
        !== "componentId,entrypoint,moduleUrl,nonce,schema,sourceCommit,type,version"
      || typeof data.componentId !== "string" || typeof data.version !== "string"
      || typeof data.sourceCommit !== "string" || typeof data.entrypoint !== "string"
      || typeof data.moduleUrl !== "string") return;
    started = true;
    const port = event.ports[0];
    try {
      const expectedPath = "/__ordax/native/component-module/" + data.componentId
        + "/pending/" + data.version + "/" + data.sourceCommit + "/" + data.entrypoint;
      const moduleUrl = new URL(data.moduleUrl);
      if (moduleUrl.origin !== expectedParentOrigin || moduleUrl.pathname !== expectedPath
        || moduleUrl.search || moduleUrl.hash || moduleUrl.username || moduleUrl.password) {
        throw new TypeError("Pending component module identity is invalid");
      }
      const module = await import(moduleUrl.href);
      const runtime = module?.componentRuntime;
      if (!runtime || runtime.schema !== "ordax.component-runtime/1"
        || runtime.componentId !== data.componentId || runtime.version !== data.version
        || typeof runtime.mount !== "function") {
        throw new TypeError("Pending component runtime export identity is invalid");
      }
      port.postMessage({ schema, type: "validated", componentId: runtime.componentId, version: runtime.version });
    } catch (error) {
      port.postMessage({ schema, type: "failed", message: String(error?.message || error).slice(0, 1024) });
    }
  }, { once: false });
})();`;

function createPendingProbeFrameDocument({ nonce, parentOrigin, resourceRoot }) {
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${resourceRoot}`,
    `style-src 'unsafe-inline' ${resourceRoot}`,
    `img-src data: blob: ${resourceRoot}`,
    `font-src data: ${resourceRoot}`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
  ].join("; ");
  const script = PENDING_PROBE_BOOTSTRAP
    .replace("__PARENT_ORIGIN__", JSON.stringify(parentOrigin))
    .replace("__NONCE__", JSON.stringify(nonce));
  return "<!doctype html><html><head><meta charset=\"utf-8\">"
    + `<meta http-equiv=\"Content-Security-Policy\" content=\"${htmlAttribute(policy)}\">`
    + "<meta name=\"referrer\" content=\"no-referrer\"></head><body style=\"margin:0\">"
    + `<script nonce=\"${nonce}\" type=\"module\">${script}</script>`
    + "</body></html>";
}

function assertContext(context, componentId) {
  if (!context || typeof context !== "object" || !context.root
    || !context.surfaceLifecycle) throw new TypeError("Isolated app mount requires its Surface root and lifecycle");
  if (Object.prototype.hasOwnProperty.call(context, "fileSpace")) {
    throw new TypeError("File Space cannot cross the Native isolated-app bridge before per-Space host authorization exists");
  }
  const lifecycle = assertSurfaceRenderLifecycle(context.surfaceLifecycle);
  const appData = assertAppDataPort(context.appData);
  if (appData.identity.appId !== componentId) throw new TypeError("App Data identity does not match the isolated slot");
  return Object.freeze({ lifecycle, appData });
}

function makeBroker({ port, componentId, context, onRevoke, onInvalidated }) {
  const pending = new Set();
  const renderUnsubscribes = new Map();
  let revoked = false;
  let highestRequestId = 0;
  let drainedResolve;
  const drained = new Promise((resolve) => { drainedResolve = resolve; });
  const finishIfDrained = () => { if (revoked && pending.size === 0) drainedResolve(); };
  const beginRevocation = () => {
    if (!revoked) {
      revoked = true;
      try { onRevoke?.(); } catch { /* revocation must continue through cleanup */ }
      for (const unsubscribe of renderUnsubscribes.values()) { try { unsubscribe(); } catch {} }
      renderUnsubscribes.clear();
    }
    finishIfDrained();
    return drained;
  };
  const send = (payload) => {
    if (revoked) return false;
    try { port.postMessage({ schema: BRIDGE_SCHEMA, ...payload }); return true; } catch { return false; }
  };
  const reply = (id, ok, value) => send(ok
    ? { type: "reply", id, ok: true, value }
    : { type: "reply", id, ok: false, error: String(value?.message || value || "Native app request failed").slice(0, 1024) });
  const execute = async (request) => {
    if (revoked) throw new Error("Native app authority has been revoked");
    await context.authorizeOperation();
    const appData = context.appData;
    switch (request.operation) {
      case "appData.get":
        if (request.args.length !== 1) throw new TypeError("App Data get request is malformed");
        return appData.get(appData.identity, validateAppDataKey(request.args[0]));
      case "appData.list":
        if (request.args.length !== 0) throw new TypeError("App Data list request is malformed");
        return appData.list(appData.identity);
      case "appData.put":
        if (request.args.length !== 1) throw new TypeError("App Data put request is malformed");
        return appData.put(appData.identity, validateAppDataPut(request.args[0]));
      case "appData.delete":
        if (request.args.length !== 1) throw new TypeError("App Data delete request is malformed");
        return appData.delete(appData.identity, validateAppDataDelete(request.args[0]));
      case "surface.setAppTarget": {
        if (request.args.length !== 1) throw new TypeError("Surface target request is malformed");
        const target = validateWorkspaceTarget(request.args[0]);
        return context.lifecycle.setAppTarget(componentId, target);
      }
      case "surface.subscribeRender": {
        const [subscriptionId] = request.args;
        if (request.args.length !== 1 || !Number.isSafeInteger(subscriptionId)
          || subscriptionId < 1 || renderUnsubscribes.size >= MAX_SUBSCRIPTIONS
          || renderUnsubscribes.has(subscriptionId)) throw new TypeError("Surface subscription request is invalid");
        const unsubscribe = context.lifecycle.subscribeRender(() => {
          send({ type: "render", appTarget: context.lifecycle.getAppTarget(componentId) });
        });
        renderUnsubscribes.set(subscriptionId, unsubscribe);
        return true;
      }
      case "surface.unsubscribeRender": {
        const [subscriptionId] = request.args;
        if (request.args.length !== 1 || !Number.isSafeInteger(subscriptionId)) throw new TypeError("Surface unsubscribe request is malformed");
        const unsubscribe = renderUnsubscribes.get(subscriptionId);
        if (unsubscribe) { renderUnsubscribes.delete(subscriptionId); unsubscribe(); }
        return true;
      }
      default: throw new TypeError("Native app bridge operation is not authorized");
    }
  };
  port.addEventListener("message", (event) => {
    const request = event.data;
    if (revoked || !request || request.schema !== BRIDGE_SCHEMA) return;
    if (request.type === "runtime.error") return;
    const exactKeys = ["args", "id", "operation", "schema", "type"];
    if (request.type !== "call" || Object.keys(request).sort().join(",") !== exactKeys.join(",")
      || !Number.isSafeInteger(request.id) || request.id <= highestRequestId
      || typeof request.operation !== "string" || !Array.isArray(request.args)
      || pending.size >= MAX_PENDING_CALLS) {
      if (Number.isSafeInteger(request.id) && request.id > 0) reply(request.id, false, "Invalid or excess app request");
      return;
    }
    highestRequestId = request.id;
    const task = Promise.resolve().then(() => execute(request))
      .then((value) => reply(request.id, true, value), (error) => {
        // Send the operation failure before closing the private MessagePort.
        // The exact-slot check is repeated for every request; a stale/missing
        // slot then revokes future requests and tears down this frame.
        reply(request.id, false, error);
        if (error instanceof NativeComponentSlotAuthorityRevokedError) {
          void beginRevocation().then(() => {
            try { onInvalidated?.(); } catch { /* failed cleanup cannot restore authority */ }
          });
        }
      })
      .finally(() => { pending.delete(task); finishIfDrained(); });
    pending.add(task);
  });
  port.start?.();
  return Object.freeze({
    get revoked() { return revoked; },
    revoke: beginRevocation,
    close() { try { port.close?.(); } catch {} },
  });
}

async function mountIsolatedRuntime({
  windowRef, identity, context, timeoutMs, expectedCurrent, slotAuthority,
}) {
  const { lifecycle, appData } = assertContext(context, identity.componentId);
  if (!expectedCurrent || expectedCurrent.componentId !== identity.componentId
    || expectedCurrent.state !== "current" || expectedCurrent.source !== "slot"
    || expectedCurrent.version !== identity.version
    || expectedCurrent.sourceCommit !== identity.sourceCommit
    || expectedCurrent.entrypoint !== identity.entrypoint) {
    throw new TypeError("Native isolated app requires its exact verified current-slot identity");
  }
  const root = context.root;
  const documentObject = root.ownerDocument;
  if (!documentObject || typeof documentObject.createElement !== "function") {
    throw new TypeError("Native isolated app requires a DOM-backed root");
  }
  if (typeof windowRef.MessageChannel !== "function") throw new TypeError("Native isolated app requires MessageChannel");
  const nonce = nonceFor(windowRef);
  const frame = documentObject.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("title", `OrdaX ${identity.componentId}`);
  frame.setAttribute("aria-label", `OrdaX ${identity.componentId}`);
  frame.style.display = "block";
  frame.style.width = "100%";
  frame.style.height = "100%";
  frame.style.minHeight = "320px";
  frame.style.border = "0";
  frame.style.background = "transparent";
  frame.srcdoc = createFrameDocument({ nonce, parentOrigin: windowRef.location.origin, resourceRoot: identity.resourceRoot });
  const channel = new windowRef.MessageChannel();
  let invalidateMount = null;
  const broker = makeBroker({
    port: channel.port1,
    componentId: identity.componentId,
    context: {
      lifecycle,
      appData,
      authorizeOperation: () => slotAuthority.assertCurrent(expectedCurrent),
    },
    onInvalidated() { invalidateMount?.(); },
  });
  let loaded = false;
  let ready = false;
  let destroyed = false;
  let readyResolve;
  let readyReject;
  const readyPromise = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  let shutdownResolve;
  const shutdownPromise = new Promise((resolve) => { shutdownResolve = resolve; });
  const timer = windowRef.setTimeout(() => readyReject(new Error("Native isolated app mount timed out")), timeoutMs);
  const localizationSnapshot = createSurfaceLocalizationSnapshot(lifecycle.localization);
  const appTarget = validateWorkspaceTarget(lifecycle.getAppTarget(identity.componentId));
  const unsubscribeLocale = lifecycle.localization.subscribe(() => {
    if (destroyed || !loaded) return;
    try {
      channel.port1.postMessage({
        schema: BRIDGE_SCHEMA, type: "localization.update",
        snapshot: createSurfaceLocalizationSnapshot(lifecycle.localization),
      });
    } catch { /* the frame may be closing during revocation */ }
  });
  const sendInitialization = () => {
    if (loaded || destroyed) return;
    loaded = true;
    try {
      frame.contentWindow.postMessage({
        schema: BRIDGE_SCHEMA, type: "initialize", nonce,
        componentId: identity.componentId, version: identity.version,
        moduleUrl: identity.moduleUrl, appDataIdentity: appData.identity,
        localizationSnapshot, appTarget,
      }, "*", [channel.port2]);
    } catch (error) { readyReject(error); }
  };
  const onFrameLoad = () => sendInitialization();
  frame.addEventListener("load", onFrameLoad, { once: true });
  channel.port1.addEventListener("message", (event) => {
    const value = event.data;
    if (!value || value.schema !== BRIDGE_SCHEMA) return;
    if (value.type === "destroyed") { shutdownResolve(); return; }
    if (destroyed) return;
    if (value.type === "resize") {
      if (Number.isSafeInteger(value.height) && value.height >= 320 && value.height <= 6000) {
        frame.style.height = `${value.height}px`;
      }
      return;
    }
    if (value.type === "mounted") {
      if (value.componentId !== identity.componentId || value.version !== identity.version) {
        readyReject(new TypeError("Native sandbox mount receipt identity mismatch"));
      } else { ready = true; readyResolve(); }
    } else if (value.type === "failed") {
      readyReject(new Error(typeof value.message === "string" ? value.message : "Native isolated app failed to mount"));
    }
  });
  root.append(frame);
  if (frame.parentNode !== root) {
    windowRef.clearTimeout(timer);
    unsubscribeLocale();
    await broker.revoke();
    broker.close();
    frame.remove();
    throw new TypeError("Native isolated app frame was not attached to its owned root");
  }
  let destroyPromise = null;
  const destroy = () => {
    if (destroyPromise) return destroyPromise;
    destroyed = true;
    unsubscribeLocale();
    const drained = broker.revoke();
    destroyPromise = (async () => {
      try { channel.port1.postMessage({ schema: BRIDGE_SCHEMA, type: "shutdown" }); } catch { /* frame may already be gone */ }
      await drained;
      let shutdownTimer;
      await Promise.race([
        shutdownPromise,
        new Promise((resolve) => { shutdownTimer = windowRef.setTimeout(resolve, 1_000); }),
      ]);
      if (shutdownTimer !== undefined) windowRef.clearTimeout(shutdownTimer);
      try { frame.contentWindow?.stop?.(); } catch { /* isolated frame shutdown is best effort */ }
      frame.remove();
      broker.close();
    })();
    return destroyPromise;
  };
  invalidateMount = () => { void destroy().catch(() => {}); };
  try {
    await readyPromise;
  } catch (error) {
    destroyed = true;
    windowRef.clearTimeout(timer);
    unsubscribeLocale();
    await broker.revoke();
    broker.close();
    frame.remove();
    throw error;
  }
  windowRef.clearTimeout(timer);
  return Object.freeze({ destroy });
}

/**
 * Create the sole Native ESM importer for signed component slots. Source code
 * runs in an opaque-origin sandboxed iframe; the parent exposes only a narrow
 * App Data and Surface lifecycle RPC broker. File Space is deliberately not
 * included until its operation-level per-Space broker and drain gate exist.
 */
export function createNativeIsolatedComponentModuleImporter({
  windowRef = globalThis.window,
  allowedComponentIds,
  currentSlotSource,
  fetchImpl = windowRef?.fetch?.bind(windowRef),
  timeoutMs = 8_000,
  currentSlotTimeoutMs = 5_000,
} = {}) {
  let surfaceUrl;
  try { surfaceUrl = new URL(windowRef?.location?.origin); } catch { surfaceUrl = null; }
  if (!windowRef?.document || !surfaceUrl || surfaceUrl.protocol !== "http:"
    || surfaceUrl.hostname !== "127.0.0.1" || !surfaceUrl.port
    || surfaceUrl.username || surfaceUrl.password || surfaceUrl.pathname !== "/"
    || surfaceUrl.search || surfaceUrl.hash
    || !Array.isArray(allowedComponentIds) || allowedComponentIds.length === 0
    || allowedComponentIds.some((id) => typeof id !== "string" || !COMPONENT_ID_RE.test(id))
    || !currentSlotSource || typeof fetchImpl !== "function"
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000
    || !Number.isSafeInteger(currentSlotTimeoutMs) || currentSlotTimeoutMs < 100 || currentSlotTimeoutMs > 30_000) {
    throw new TypeError("Native isolated component executor configuration is invalid");
  }
  const surfaceOrigin = windowRef.location.origin;
  const allowed = new Set(allowedComponentIds);
  const slotAuthority = createNativeComponentSlotAuthority({
    source: currentSlotSource,
    fetchImpl,
    timeoutMs: currentSlotTimeoutMs,
  });
  return async function importVerifiedNativeComponent(urlValue, currentValue) {
    const identity = parseModuleIdentity(urlValue, surfaceOrigin, allowed);
    const expectedCurrent = validateComponentRuntimeMetadata(currentValue, {
      componentId: identity.componentId,
      state: "current",
    });
    if (expectedCurrent.source !== "slot"
      || expectedCurrent.version !== identity.version
      || expectedCurrent.sourceCommit !== identity.sourceCommit
      || expectedCurrent.entrypoint !== identity.entrypoint) {
      throw new TypeError("Native isolated app URL differs from its verified current-slot identity");
    }
    return Object.freeze({
      componentRuntime: Object.freeze({
        schema: COMPONENT_RUNTIME_SCHEMA,
        componentId: identity.componentId,
        version: identity.version,
        mount(context) {
          return mountIsolatedRuntime({
            windowRef, identity, context, timeoutMs, expectedCurrent, slotAuthority,
          });
        },
      }),
    });
  };
}

export const NATIVE_ISOLATED_COMPONENT_EXECUTOR_SCHEMA = EXECUTOR_SCHEMA;

/**
 * Create the import-only pending-slot probe used by Native component probation.
 * The candidate runs in an opaque-origin iframe with no host bridge; the probe
 * validates exact pending metadata both before and after importing the signed
 * module, then destroys the frame. Its returned mount function is deliberately
 * unusable: this path proves the import contract, never candidate activation.
 */
export function createNativeIsolatedPendingComponentModuleImporter({
  windowRef = globalThis.window,
  allowedComponentIds,
  componentSlotSource,
  fetchImpl = windowRef?.fetch?.bind(windowRef),
  timeoutMs = 8_000,
  slotAuthorityTimeoutMs = 5_000,
} = {}) {
  let surfaceUrl;
  try { surfaceUrl = new URL(windowRef?.location?.origin); } catch { surfaceUrl = null; }
  const documentObject = windowRef?.document;
  const frameParent = documentObject?.documentElement ?? documentObject?.body;
  if (!windowRef || !frameParent || typeof frameParent.append !== "function"
    || typeof windowRef.MessageChannel !== "function"
    || surfaceUrl?.protocol !== "http:" || surfaceUrl.hostname !== "127.0.0.1" || !surfaceUrl.port
    || surfaceUrl.username || surfaceUrl.password || surfaceUrl.pathname !== "/"
    || surfaceUrl.search || surfaceUrl.hash
    || !Array.isArray(allowedComponentIds) || allowedComponentIds.length === 0
    || allowedComponentIds.some((id) => typeof id !== "string" || !COMPONENT_ID_RE.test(id))
    || !componentSlotSource || typeof fetchImpl !== "function"
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000
    || !Number.isSafeInteger(slotAuthorityTimeoutMs) || slotAuthorityTimeoutMs < 100 || slotAuthorityTimeoutMs > 30_000) {
    throw new TypeError("Native isolated pending-component probe configuration is invalid");
  }

  const surfaceOrigin = windowRef.location.origin;
  const allowed = new Set(allowedComponentIds);
  const slotAuthority = createNativeComponentSlotAuthority({
    source: componentSlotSource,
    fetchImpl,
    timeoutMs: slotAuthorityTimeoutMs,
  });

  return async function importVerifiedPendingNativeComponent(urlValue, resolutionValue) {
    const identity = parseModuleIdentity(urlValue, surfaceOrigin, allowed, "pending");
    const expected = validateComponentRuntimeMetadata(resolutionValue, {
      componentId: identity.componentId,
      state: "pending",
    });
    if (expected.source !== "slot" || expected.pendingHealth !== "unknown"
      || expected.version !== identity.version
      || expected.sourceCommit !== identity.sourceCommit
      || expected.entrypoint !== identity.entrypoint) {
      throw new TypeError("Native pending module URL differs from its unknown-health slot identity");
    }
    await slotAuthority.assertPending(expected);

    const nonce = nonceFor(windowRef);
    const frame = documentObject.createElement("iframe");
    if (!frame || typeof frame.setAttribute !== "function" || typeof frame.addEventListener !== "function"
      || typeof frame.remove !== "function") {
      throw new TypeError("Native pending probe requires a removable sandbox iframe");
    }
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("title", `OrdaX ${identity.componentId} pending component probe`);
    frame.setAttribute("aria-hidden", "true");
    frame.hidden = true;
    frame.style.display = "none";
    frame.srcdoc = createPendingProbeFrameDocument({
      nonce,
      parentOrigin: surfaceOrigin,
      resourceRoot: identity.resourceRoot,
    });

    const channel = new windowRef.MessageChannel();
    let timer;
    let settled = false;
    let frameLoaded = false;
    let finishReady;
    const ready = new Promise((resolve, reject) => {
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        error ? reject(error) : resolve(true);
      };
      finishReady = finish;
      timer = windowRef.setTimeout(() => {
        finish(new Error("Native pending component import probe timed out"));
      }, timeoutMs);
      channel.port1.addEventListener("message", (event) => {
        const value = event.data;
        if (!value || value.schema !== PENDING_PROBE_SCHEMA || typeof value.type !== "string") return;
        if (value.type === "validated") {
          if (Object.keys(value).sort().join(",") !== "componentId,schema,type,version"
            || value.componentId !== identity.componentId || value.version !== identity.version) {
            finish(new TypeError("Native pending component probe receipt identity mismatch"));
          } else finish();
        } else if (value.type === "failed") {
          if (Object.keys(value).sort().join(",") !== "message,schema,type"
            || typeof value.message !== "string") {
            finish(new TypeError("Native pending component probe failure receipt is malformed"));
          } else finish(new Error(value.message.slice(0, 1024)));
        }
      });
      channel.port1.start?.();
    });
    const sendProbe = () => {
      if (frameLoaded || settled) return;
      frameLoaded = true;
      try {
        frame.contentWindow.postMessage({
          schema: PENDING_PROBE_SCHEMA,
          type: "probe",
          nonce,
          componentId: identity.componentId,
          version: identity.version,
          sourceCommit: identity.sourceCommit,
          entrypoint: identity.entrypoint,
          moduleUrl: identity.moduleUrl,
        }, "*", [channel.port2]);
      } catch (error) {
        finishReady(new Error(String(error?.message || error).slice(0, 1024)));
      }
    };
    frame.addEventListener("load", sendProbe, { once: true });
    try {
      frameParent.append(frame);
      if (frame.parentNode !== frameParent) {
        throw new TypeError("Native pending probe frame was not attached to the Surface document");
      }
      await ready;
      await slotAuthority.assertPending(expected);
    } finally {
      windowRef.clearTimeout(timer);
      try { frame.contentWindow?.stop?.(); } catch { /* probe teardown remains best effort */ }
      try { frame.remove(); } finally {
        try { channel.port1.close?.(); } catch { /* closed frame cannot retain a usable port */ }
        try { channel.port2.close?.(); } catch { /* transferred port may already be closed */ }
      }
    }

    return Object.freeze({
      componentRuntime: Object.freeze({
        schema: COMPONENT_RUNTIME_SCHEMA,
        componentId: identity.componentId,
        version: identity.version,
        mount() {
          throw new TypeError("Import-contract probation cannot mount or activate a pending component");
        },
      }),
    });
  };
}

export const NATIVE_ISOLATED_COMPONENT_PROBE_SCHEMA = PENDING_PROBE_SCHEMA;
