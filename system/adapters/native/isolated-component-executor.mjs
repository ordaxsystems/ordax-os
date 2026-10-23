import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import {
  assertAppDataPort,
  validateAppDataDelete,
  validateAppDataKey,
  validateAppDataPut,
} from "../../contracts/app-data.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { validateWorkspaceTarget } from "../../contracts/workspace-store.mjs";
import {
  assertAppActivationPort,
  validateAppActivation,
} from "../../contracts/app-activation.mjs";
import {
  assertDeviceLocalFileSpacePort,
  validateDocumentPreview,
  validateFileEntry,
  validateFileListing,
  validateFileSpacePath,
  validateImagePreview,
  validateMediaPreview,
  validateTextFile,
  validateTrashListing,
  MAX_FILE_IMPORT_BYTES,
} from "../../contracts/file-space.mjs";
import {
  assertProjectCatalogPort,
  validateProjectCatalogSnapshot,
  validateProjectFilePath,
  validateProjectId,
  validateProjectName,
  validateProjectPath,
} from "../../contracts/project-catalog.mjs";
import {
  assertRecentFilesPort,
  validateRecentFilePath,
  validateRecentFilesSnapshot,
} from "../../contracts/recent-files.mjs";
import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import {
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";
import {
  assertIntelligencePort,
  validateIntelligenceSnapshot,
  validateIntelligenceRequest,
  validateIntelligenceResponse,
} from "../../contracts/intelligence.mjs";
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
const PENDING_INTELLIGENCE_CLIENT_MOUNT_OPERATIONS = new Set([
  "surface.subscribeRender",
  "surface.unsubscribeRender",
  "identitySession.subscribe",
  "identitySession.unsubscribe",
  "spaceSelection.subscribe",
  "spaceSelection.unsubscribe",
  "intelligence.subscribe",
  "intelligence.unsubscribe",
]);
// The synthetic pending client can render an offline state but must never
// call the real model, observe real identity/Space, or mutate app data.
const PENDING_FILES_MOUNT_OPERATIONS = new Set([
  "surface.subscribeRender",
  "surface.unsubscribeRender",
  "fileSpace.list",
  "recentFiles.getSnapshot",
  "recentFiles.subscribe",
  "recentFiles.unsubscribe",
  "projects.getSnapshot",
  "projects.subscribe",
  "projects.unsubscribe",
  "appActivation.subscribe",
  "appActivation.unsubscribe",
]);
const denyPendingFilesMutation = () => {
  throw new TypeError("Pending Files probation has no user-data mutation authority");
};
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
  let fileSpace = null;
  let recentFiles = null;
  let projects = null;
  let appActivation = null;
  let identitySession = null;
  let spaceSelection = null;
  let intelligence = null;
  let nextRequest = 0;
  const pending = new Map();
  const renderListeners = new Set();
  const localeListeners = new Set();

  const send = (payload) => host?.postMessage({ schema: bridgeSchema, ...payload });
  const call = (operation, args = [], signal = null) => new Promise((resolve, reject) => {
    if (!host || pending.size >= 64) { reject(new Error("Native app bridge is unavailable")); return; }
    if (signal?.aborted) { reject(new Error("Native app request cancelled")); return; }
    const id = ++nextRequest;
    const finish = (callback, value) => {
      signal?.removeEventListener?.("abort", onAbort);
      callback(value);
    };
    const onAbort = () => {
      if (!pending.delete(id)) return;
      try { send({ type: "cancel", id }); } catch {}
      finish(reject, new Error("Native app request cancelled"));
    };
    pending.set(id, {
      resolve: (value) => finish(resolve, value),
      reject: (error) => finish(reject, error),
    });
    signal?.addEventListener?.("abort", onAbort, { once: true });
    try {
      send({ type: "call", id, operation, args });
    } catch (error) {
      pending.delete(id);
      finish(reject, error);
    }
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
  const createFileSpace = (scope) => Object.freeze({
    schema: "ordax.file-space/11",
    scope: Object.freeze({ schema: scope.schema, kind: scope.kind }),
    list: (path = "/") => call("fileSpace.list", [path]),
    createDirectory: (path, name) => call("fileSpace.createDirectory", [path, name]),
    readTextFile: (path) => call("fileSpace.readTextFile", [path]),
    readImagePreview: (path) => call("fileSpace.readImagePreview", [path]),
    readMediaPreview: (path) => call("fileSpace.readMediaPreview", [path]),
    readDocumentPreview: (path) => call("fileSpace.readDocumentPreview", [path]),
    copyFile: (sourcePath, name, destinationPath, newName) =>
      call("fileSpace.copyFile", [sourcePath, name, destinationPath, newName]),
    renameEntry: (path, name, newName) => call("fileSpace.renameEntry", [path, name, newName]),
    moveEntry: (sourcePath, name, destinationPath) =>
      call("fileSpace.moveEntry", [sourcePath, name, destinationPath]),
    trashEntry: (path, name) => call("fileSpace.trashEntry", [path, name]),
    listTrash: () => call("fileSpace.listTrash", []),
    restoreTrashEntry: (id) => call("fileSpace.restoreTrashEntry", [id]),
    exportFile: (path) => call("fileSpace.exportFile", [path]),
    importFile: (path, name, bytes) => call("fileSpace.importFile", [path, name, bytes]),
  });
  const createSnapshotPort = (service, schema, initialSnapshot, methods) => {
    let snapshot = initialSnapshot;
    let nextSubscriptionId = 0;
    const listeners = new Map();
    const port = {
      schema,
      getSnapshot() { return snapshot; },
      subscribe(listener) {
        if (typeof listener !== "function" || listeners.size >= 16) {
          throw new TypeError(service + " subscription is invalid");
        }
        const id = ++nextSubscriptionId;
        listeners.set(id, listener);
        const registration = call(service + ".subscribe", [id]);
        void registration.catch(() => listeners.delete(id));
        return () => {
          if (!listeners.delete(id)) return;
          void registration.then(() => call(service + ".unsubscribe", [id])).catch(() => {});
        };
      },
      applySnapshot(id, nextSnapshot) {
        snapshot = nextSnapshot;
        const listener = listeners.get(id);
        if (listener) { try { listener(snapshot); } catch {} }
      },
    };
    for (const method of methods) {
      port[method] = (...args) => call(service + "." + method, args).then((nextSnapshot) => {
        snapshot = nextSnapshot;
        return snapshot;
      });
    }
    return Object.freeze(port);
  };
  const createActivationPort = () => {
    let nextSubscriptionId = 0;
    const listeners = new Map();
    return Object.freeze({
      schema: "ordax.app-activation/1",
      publish: (value) => call("appActivation.publish", [value]),
      subscribe(listener) {
        if (typeof listener !== "function" || listeners.size >= 16) {
          throw new TypeError("App activation subscription is invalid");
        }
        const id = ++nextSubscriptionId;
        listeners.set(id, listener);
        const registration = call("appActivation.subscribe", [id]);
        void registration.catch(() => listeners.delete(id));
        return () => {
          if (!listeners.delete(id)) return;
          void registration.then(() => call("appActivation.unsubscribe", [id])).catch(() => {});
        };
      },
      applyActivation(id, activation) {
        const listener = listeners.get(id);
        if (listener) { try { listener(activation); } catch {} }
      },
    });
  };
  const fileServices = Object.freeze({
    identitySession: { apply(id, snapshot) { identitySession?.applySnapshot(id, snapshot); } },
    spaceSelection: { apply(id, snapshot) { spaceSelection?.applySnapshot(id, snapshot); } },
    intelligence: { apply(id, snapshot) { intelligence?.applySnapshot(id, snapshot); } },
    recentFiles: {
      apply(id, snapshot) { recentFiles?.applySnapshot(id, snapshot); },
    },
    projects: {
      apply(id, snapshot) { projects?.applySnapshot(id, snapshot); },
    },
    appActivation: {
      apply(id, activation) { appActivation?.applyActivation(id, activation); },
    },
  });
  const onHostMessage = async (event) => {
    const data = event.data;
    if (!data || data.schema !== bridgeSchema || typeof data.type !== "string") return;
    if (data.type === "reply") {
      if (!Number.isSafeInteger(data.id) || !pending.has(data.id)) return;
      const request = pending.get(data.id);
      pending.delete(data.id);
      if (data.ok === true) request.resolve(data.value);
      else request.reject(new Error(typeof data.error === "string" ? data.error : "Native app request failed"));
    } else if (data.type === "service.update") {
      if (typeof data.service !== "string" || !Number.isSafeInteger(data.subscriptionId)
        || data.subscriptionId < 1 || !Object.prototype.hasOwnProperty.call(fileServices, data.service)) return;
      fileServices[data.service]?.apply(data.subscriptionId, data.value);
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
      if (!data.localizationSnapshot
        || (identity === null
          ? data.pendingMount !== true
            || !["files", "assistant"].includes(data.componentId)
          : data.pendingMount === true
            || !identity || identity.appId !== data.componentId)) {
        throw new TypeError("Verified app context is incomplete");
      }
      assertLocale(data.localizationSnapshot);
      if (data.fileSpaceScope !== null && data.fileSpaceScope !== undefined) {
        if (data.fileSpaceScope.schema !== "ordax.file-space-scope/1"
          || data.fileSpaceScope.kind !== "device-local") {
          throw new TypeError("Native Files scope is invalid");
        }
        fileSpace = createFileSpace(data.fileSpaceScope);
        if (!data.recentFilesSnapshot || !data.projectCatalogSnapshot) {
          throw new TypeError("Verified Files context is incomplete");
        }
        recentFiles = createSnapshotPort("recentFiles", "ordax.recent-files/1",
          data.recentFilesSnapshot, ["recordOpened", "remove", "clear", "relocate"]);
        projects = createSnapshotPort("projects", "ordax.project-catalog/1",
          data.projectCatalogSnapshot, ["create", "rename", "recordOpened", "recordFileOpened",
            "clearLastFile", "relocateLastFilePath", "remove"]);
        appActivation = createActivationPort();
      }
      if (data.componentId === "assistant") {
        if (data.identitySessionSnapshot?.state === undefined
          || data.spaceSelectionSnapshot?.schema !== "ordax.space-selection/1"
          || data.intelligenceSnapshot?.schema !== "ordax.intelligence/1") {
          throw new TypeError("Intelligence client host snapshots are unavailable");
        }
        identitySession = createSnapshotPort(
          "identitySession", "ordax.identity-session/1", data.identitySessionSnapshot, [],
        );
        const selection = createSnapshotPort(
          "spaceSelection", "ordax.space-selection/1", data.spaceSelectionSnapshot, [],
        );
        const denySelectionMutation = () => {
          throw new TypeError("Intelligence client cannot select or clear the system Space");
        };
        spaceSelection = Object.freeze({
          schema: selection.schema,
          getSnapshot: selection.getSnapshot,
          subscribe: selection.subscribe,
          applySnapshot: selection.applySnapshot,
          select: denySelectionMutation,
          clear: denySelectionMutation,
        });
        const inference = createSnapshotPort(
          "intelligence", "ordax.intelligence/1", data.intelligenceSnapshot, [],
        );
        intelligence = Object.freeze({
          schema: inference.schema,
          getSnapshot: inference.getSnapshot,
          subscribe: inference.subscribe,
          applySnapshot: inference.applySnapshot,
          respond(request, options = {}) {
            if (options?.signal?.aborted) {
              return Promise.reject(new Error("Inference request was cancelled"));
            }
            return call("intelligence.respond", [request], options?.signal ?? null);
          },
        });
      } else if (data.identitySessionSnapshot !== null
        || data.spaceSelectionSnapshot !== null
        || data.intelligenceSnapshot !== null) {
        throw new TypeError("Only the verified Intelligence client may receive Intelligence ports");
      }
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
        ...(identity === null ? {} : { appData: appData(identity) }),
        ...(fileSpace === null ? {} : { fileSpace }),
        ...(recentFiles === null ? {} : { recentFiles }),
        ...(projects === null ? {} : { projects }),
        ...(appActivation === null ? {} : { appActivation }),
        ...(identitySession === null ? {} : { identitySessionPort: identitySession }),
        ...(spaceSelection === null ? {} : { spaceSelectionPort: spaceSelection }),
        ...(intelligence === null ? {} : { intelligence }),
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

function assertContext(context, componentId, {
  allowMissingAppData = false,
  syntheticIntelligenceClient = false,
} = {}) {
  if (!context || typeof context !== "object" || !context.root
    || !context.surfaceLifecycle) throw new TypeError("Isolated app mount requires its Surface root and lifecycle");
  const lifecycle = assertSurfaceRenderLifecycle(context.surfaceLifecycle);
  const appData = allowMissingAppData && context.appData == null
    ? null
    : assertAppDataPort(context.appData);
  if (appData !== null && appData.identity.appId !== componentId) {
    throw new TypeError("App Data identity does not match the isolated slot");
  }
  const hasFileSpace = Object.prototype.hasOwnProperty.call(context, "fileSpace");
  const hasRecentFiles = Object.prototype.hasOwnProperty.call(context, "recentFiles");
  const hasProjects = Object.prototype.hasOwnProperty.call(context, "projects");
  const hasAppActivation = Object.prototype.hasOwnProperty.call(context, "appActivation");
  if ((hasFileSpace || hasRecentFiles || hasProjects || hasAppActivation) && componentId !== "files") {
    throw new TypeError("Native File Space is available only to the verified Files slot");
  }
  const fileSpace = hasFileSpace ? assertDeviceLocalFileSpacePort(context.fileSpace) : null;
  const recentFiles = hasRecentFiles ? assertRecentFilesPort(context.recentFiles) : null;
  const projects = hasProjects ? assertProjectCatalogPort(context.projects) : null;
  const appActivation = hasAppActivation ? assertAppActivationPort(context.appActivation) : null;
  const auraPorts = ["identitySessionPort", "spaceSelectionPort", "intelligence"];
  const hasAnyAuraPort = auraPorts.some((key) => Object.prototype.hasOwnProperty.call(context, key));
  if (hasAnyAuraPort && componentId !== "assistant") {
    throw new TypeError("Intelligence host context belongs only to verified Aura slots");
  }
  if (componentId === "assistant" && !syntheticIntelligenceClient && !auraPorts.every((key) =>
    Object.prototype.hasOwnProperty.call(context, key))) {
    throw new TypeError("Intelligence client requires all trusted Identity, Space and Intelligence ports");
  }
  if (syntheticIntelligenceClient && hasAnyAuraPort) {
    throw new TypeError("Pending Intelligence client cannot receive host ports");
  }
  const identitySession = componentId === "assistant" && !syntheticIntelligenceClient
    ? assertIdentitySessionPort(context.identitySessionPort) : null;
  const spaceSelection = componentId === "assistant" && !syntheticIntelligenceClient
    ? assertSpaceSelectionPort(context.spaceSelectionPort) : null;
  const intelligence = componentId === "assistant" && !syntheticIntelligenceClient
    ? assertIntelligencePort(context.intelligence) : null;
  if (componentId === "files" && (fileSpace === null || recentFiles === null
    || projects === null || appActivation === null)) {
    throw new TypeError("Verified Files slot requires its complete device-local host context");
  }
  return Object.freeze({ lifecycle, appData, fileSpace, recentFiles, projects, appActivation, identitySession, spaceSelection, intelligence });
}

function createPendingIntelligenceClientContext(validated) {
  const subscribeWithoutState = () => () => {};
  const denyInference = () => Promise.reject(
    new TypeError("Pending Intelligence client cannot invoke inference"),
  );
  const identitySession = Object.freeze({
    schema: "ordax.identity-session/1",
    getSnapshot: () => Object.freeze({
      state: "unavailable", subjectId: null, displayName: null,
    }),
    subscribe: subscribeWithoutState,
  });
  const spaceSelection = Object.freeze({
    schema: "ordax.space-selection/1",
    getSnapshot: () => Object.freeze({
      schema: "ordax.space-selection/1", state: "unavailable",
      subjectId: null, selectedSpace: null,
    }),
    subscribe: subscribeWithoutState,
    select: () => { throw new TypeError("Pending Intelligence client cannot select Space"); },
    clear: () => { throw new TypeError("Pending Intelligence client cannot clear Space"); },
  });
  const intelligence = Object.freeze({
    schema: "ordax.intelligence/1",
    getSnapshot: () => Object.freeze({
      schema: "ordax.intelligence/1", state: "degraded",
      inferenceAvailable: false, engineId: null, modelId: null,
      authority: "none", toolExecution: false,
    }),
    subscribe: subscribeWithoutState,
    respond: denyInference,
  });
  return Object.freeze({
    ...validated, identitySession, spaceSelection, intelligence,
  });
}

function createPendingFilesReadOnlyContext(validated) {
  const recentFilesSnapshot = Object.freeze({ persistence: "session", entries: Object.freeze([]) });
  const projectCatalogSnapshot = Object.freeze({ persistence: "session", projects: Object.freeze([]) });
  const subscribeWithoutState = () => () => {};
  const fileSpace = Object.freeze({
    schema: validated.fileSpace.schema,
    scope: validated.fileSpace.scope,
    async list(path) {
      if (path !== "/") {
        throw new TypeError("Pending Files probation may inspect only the File Space root");
      }
      return Object.freeze({ path: "/", entries: Object.freeze([]) });
    },
  });
  const recentFiles = Object.freeze({
    schema: validated.recentFiles.schema,
    getSnapshot: () => recentFilesSnapshot,
    subscribe: subscribeWithoutState,
    recordOpened: denyPendingFilesMutation,
    remove: denyPendingFilesMutation,
    clear: denyPendingFilesMutation,
    relocate: denyPendingFilesMutation,
  });
  const projects = Object.freeze({
    schema: validated.projects.schema,
    getSnapshot: () => projectCatalogSnapshot,
    subscribe: subscribeWithoutState,
    create: denyPendingFilesMutation,
    rename: denyPendingFilesMutation,
    recordOpened: denyPendingFilesMutation,
    recordFileOpened: denyPendingFilesMutation,
    clearLastFile: denyPendingFilesMutation,
    relocateLastFilePath: denyPendingFilesMutation,
    remove: denyPendingFilesMutation,
  });
  const appActivation = Object.freeze({
    schema: validated.appActivation.schema,
    publish: denyPendingFilesMutation,
    subscribe: subscribeWithoutState,
  });
  return Object.freeze({ ...validated, fileSpace, recentFiles, projects, appActivation });
}

function makeBroker({ port, componentId, context, onRevoke, onInvalidated }) {
  const pending = new Set();
  const renderUnsubscribes = new Map();
  const recentFilesUnsubscribes = new Map();
  const projectUnsubscribes = new Map();
  const activationUnsubscribes = new Map();
  const identityUnsubscribes = new Map();
  const selectionUnsubscribes = new Map();
  const intelligenceUnsubscribes = new Map();
  const inferenceControllers = new Set();
  const inferenceByRequest = new Map();
  let scopeEpoch = 0;
  const onTrustedScopeChange = () => {
    scopeEpoch += 1;
    for (const controller of inferenceControllers) controller.abort();
  };
  const trustedScopeUnsubscribes = componentId === "assistant"
    ? [
        context.identitySession.subscribe(onTrustedScopeChange),
        context.spaceSelection.subscribe(onTrustedScopeChange),
      ]
    : [];
  const queuedUpdates = new Map();
  let revoked = false;
  let highestRequestId = 0;
  let drainedResolve;
  let updatePump = null;
  const drained = new Promise((resolve) => { drainedResolve = resolve; });
  const finishIfDrained = () => { if (revoked && pending.size === 0) drainedResolve(); };
  const beginRevocation = () => {
    if (!revoked) {
      revoked = true;
      try { onRevoke?.(); } catch { /* revocation must continue through cleanup */ }
      for (const unsubscribe of renderUnsubscribes.values()) { try { unsubscribe(); } catch {} }
      renderUnsubscribes.clear();
      for (const unsubscribe of recentFilesUnsubscribes.values()) { try { unsubscribe(); } catch {} }
      recentFilesUnsubscribes.clear();
      for (const unsubscribe of projectUnsubscribes.values()) { try { unsubscribe(); } catch {} }
      projectUnsubscribes.clear();
      for (const unsubscribe of activationUnsubscribes.values()) { try { unsubscribe(); } catch {} }
      activationUnsubscribes.clear();
      for (const unsubscribe of identityUnsubscribes.values()) { try { unsubscribe(); } catch {} }
      identityUnsubscribes.clear();
      for (const unsubscribe of selectionUnsubscribes.values()) { try { unsubscribe(); } catch {} }
      selectionUnsubscribes.clear();
      for (const unsubscribe of intelligenceUnsubscribes.values()) { try { unsubscribe(); } catch {} }
      intelligenceUnsubscribes.clear();
      for (const unsubscribe of trustedScopeUnsubscribes) { try { unsubscribe(); } catch {} }
      for (const controller of inferenceControllers) controller.abort();
      queuedUpdates.clear();
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
  const subscriptionCount = () => renderUnsubscribes.size + recentFilesUnsubscribes.size
    + projectUnsubscribes.size + activationUnsubscribes.size
    + identityUnsubscribes.size + selectionUnsubscribes.size + intelligenceUnsubscribes.size;
  const flushAuthorizedUpdates = () => {
    if (revoked || updatePump !== null || queuedUpdates.size === 0) return;
    let task;
    task = Promise.resolve().then(async () => {
      while (!revoked && queuedUpdates.size > 0) {
        const [key, update] = queuedUpdates.entries().next().value;
        queuedUpdates.delete(key);
        await context.authorizeOperation();
        if (revoked) return;
        const subscriptions = {
          recentFiles: recentFilesUnsubscribes,
          projects: projectUnsubscribes,
          appActivation: activationUnsubscribes,
          identitySession: identityUnsubscribes,
          spaceSelection: selectionUnsubscribes,
          intelligence: intelligenceUnsubscribes,
        }[update.service];
        if (!subscriptions.has(update.subscriptionId)) continue;
        send({ type: "service.update", ...update });
      }
    }).catch((error) => {
      if (error instanceof NativeComponentSlotAuthorityRevokedError) {
        void beginRevocation().then(() => {
          try { onInvalidated?.(); } catch { /* failed cleanup cannot restore authority */ }
        });
      }
    }).finally(() => {
      pending.delete(task);
      updatePump = null;
      finishIfDrained();
      flushAuthorizedUpdates();
    });
    pending.add(task);
    updatePump = task;
  };
  const queueAuthorizedUpdate = (service, subscriptionId, value) => {
    if (revoked) return;
    // Keep only the newest snapshot for each authorized subscription. A fast
    // producer cannot build an unbounded queue while the slot is being checked.
    const key = `${service}:${subscriptionId}`;
    queuedUpdates.set(key, { service, subscriptionId, value });
    flushAuthorizedUpdates();
  };
  const validateSubscription = (request, service, subscriptions) => {
    const [id] = request.args;
    if (request.args.length !== 1 || !Number.isSafeInteger(id) || id < 1
      || subscriptions.has(id) || subscriptionCount() >= MAX_SUBSCRIPTIONS) {
      throw new TypeError(`Native ${service} subscription request is invalid`);
    }
    return id;
  };
  const execute = async (request) => {
    if (revoked) throw new Error("Native app authority has been revoked");
    if (context.allowedOperations !== null
      && !context.allowedOperations.has(request.operation)) {
      throw new TypeError("Native pending Files mount operation is read-only");
    }
    await context.authorizeOperation();
    if (revoked) throw new Error("Native app authority has been revoked");
    const appData = context.appData;
    const fileSpace = context.fileSpace;
    const recentFiles = context.recentFiles;
    const projects = context.projects;
    const appActivation = context.appActivation;
    const identitySession = context.identitySession;
    const spaceSelection = context.spaceSelection;
    const intelligence = context.intelligence;
    const requireAuraService = (service) => {
      if (componentId !== "assistant"
        || identitySession === null || spaceSelection === null || intelligence === null) {
        throw new TypeError("Native " + service + " is unavailable to this signed app");
      }
    };
    const oneArgument = (label) => {
      if (request.args.length !== 1) throw new TypeError(`Native ${label} request is malformed`);
    };
    const fileName = (value, label) => {
      if (typeof value !== "string" || value.length > 255) throw new TypeError(`Native ${label} is invalid`);
      return validateFileEntry({ name: value, kind: "file", size: 0, modifiedAt: 0 }).name;
    };
    const listingAt = async (promise, requestedPath) => {
      const listing = validateFileListing(await promise);
      if (listing.path !== requestedPath) throw new TypeError("Native File Space returned a different logical path");
      return listing;
    };
    switch (request.operation) {
      case "identitySession.subscribe":
      case "spaceSelection.subscribe":
      case "intelligence.subscribe": {
        requireAuraService("subscription");
        const service = request.operation.split(".")[0];
        const binding = {
          identitySession: {
            port: identitySession, subscriptions: identityUnsubscribes,
            validate: validateIdentitySessionSnapshot,
          },
          spaceSelection: {
            port: spaceSelection, subscriptions: selectionUnsubscribes,
            validate: validateSpaceSelectionSnapshot,
          },
          intelligence: {
            port: intelligence, subscriptions: intelligenceUnsubscribes,
            validate: validateIntelligenceSnapshot,
          },
        }[service];
        const id = validateSubscription(request, service, binding.subscriptions);
        const unsubscribe = binding.port.subscribe(() => {
          if (service !== "intelligence") {
            for (const controller of inferenceControllers) controller.abort();
          }
          // Only owner-controlled snapshots are authoritative; event arguments
          // are notifications, not trusted replacements of a system snapshot.
          queueAuthorizedUpdate(service, id, binding.validate(binding.port.getSnapshot()));
        });
        binding.subscriptions.set(id, unsubscribe);
        return true;
      }
      case "identitySession.unsubscribe":
      case "spaceSelection.unsubscribe":
      case "intelligence.unsubscribe": {
        requireAuraService("unsubscribe");
        const service = request.operation.split(".")[0];
        if (request.args.length !== 1 || !Number.isSafeInteger(request.args[0])) {
          throw new TypeError("Aura subscription ID is malformed");
        }
        const subscriptions = {
          identitySession: identityUnsubscribes,
          spaceSelection: selectionUnsubscribes,
          intelligence: intelligenceUnsubscribes,
        }[service];
        const id = request.args[0];
        queuedUpdates.delete(service + ":" + id);
        const unsubscribe = subscriptions.get(id);
        if (unsubscribe) { subscriptions.delete(id); unsubscribe(); }
        return true;
      }
      case "intelligence.respond": {
        requireAuraService("inference");
        oneArgument("inference");
        if (inferenceControllers.size !== 0) {
          throw new TypeError("Intelligence client already has a pending inference request");
        }
        const requestPayload = validateIntelligenceRequest(request.args[0]);
        const state = validateIntelligenceSnapshot(intelligence.getSnapshot());
        if (state.state !== "ready" || state.authority !== "none" || state.toolExecution !== false) {
          throw new TypeError("Consultative Intelligence is unavailable");
        }
        const readScope = () => {
          const identity = validateIdentitySessionSnapshot(identitySession.getSnapshot());
          const space = validateSpaceSelectionSnapshot(spaceSelection.getSnapshot());
          if (identity.state === "signed-in" && space.state !== "unavailable"
            && space.subjectId !== identity.subjectId) {
            throw new TypeError("Intelligence client Identity/Space scope is incompatible");
          }
          return JSON.stringify([identity, space]);
        };
        const initialScope = readScope();
        const initialEpoch = scopeEpoch;
        const controller = new AbortController();
        inferenceControllers.add(controller);
        inferenceByRequest.set(request.id, controller);
        let timeout;
        let unsubscribeAbort;
        try {
          const aborted = new Promise((_, reject) => {
            const onAbort = () => reject(new Error("Intelligence client inference scope was revoked"));
            controller.signal.addEventListener("abort", onAbort, { once: true });
            unsubscribeAbort = () => controller.signal.removeEventListener("abort", onAbort);
          });
          const deadline = new Promise((_, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(new Error("Intelligence client inference exceeded the bounded host deadline"));
            }, 90_000);
          });
          const response = await Promise.race([
            intelligence.respond(requestPayload, { signal: controller.signal }),
            aborted,
            deadline,
          ]);
          await context.authorizeOperation();
          if (revoked || controller.signal.aborted || scopeEpoch !== initialEpoch || readScope() !== initialScope) {
            throw new Error("Inference belongs to a revoked Identity/Space or slot");
          }
          return validateIntelligenceResponse(response);
        } finally {
          controller.abort();
          inferenceControllers.delete(controller);
          inferenceByRequest.delete(request.id);
          if (timeout !== undefined) clearTimeout(timeout);
          unsubscribeAbort?.();
        }
      }
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
          || subscriptionId < 1 || subscriptionCount() >= MAX_SUBSCRIPTIONS
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
      case "fileSpace.list": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        oneArgument("File Space list");
        const path = validateFileSpacePath(request.args[0]);
        if (context.pendingReadOnlyMount && path !== "/") {
          throw new TypeError("Native pending Files mount may inspect only the File Space root");
        }
        return listingAt(fileSpace.list(path), path);
      }
      case "fileSpace.createDirectory": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        if (request.args.length !== 2) throw new TypeError("Native File Space create-directory request is malformed");
        const path = validateFileSpacePath(request.args[0]);
        return listingAt(fileSpace.createDirectory(path, fileName(request.args[1], "directory name")), path);
      }
      case "fileSpace.readTextFile": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        oneArgument("File Space text-read");
        const path = validateFileSpacePath(request.args[0]);
        const file = validateTextFile(await fileSpace.readTextFile(path));
        if (file.path !== path) throw new TypeError("Native File Space returned a different text path");
        return file;
      }
      case "fileSpace.readImagePreview": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        oneArgument("File Space image-preview");
        const path = validateFileSpacePath(request.args[0]);
        const preview = validateImagePreview(await fileSpace.readImagePreview(path));
        if (preview.path !== path) throw new TypeError("Native File Space returned a different image path");
        return preview;
      }
      case "fileSpace.readMediaPreview": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        oneArgument("File Space media-preview");
        const path = validateFileSpacePath(request.args[0]);
        const preview = validateMediaPreview(await fileSpace.readMediaPreview(path));
        if (preview.path !== path) throw new TypeError("Native File Space returned a different media path");
        return preview;
      }
      case "fileSpace.readDocumentPreview": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        oneArgument("File Space document-preview");
        const path = validateFileSpacePath(request.args[0]);
        const preview = validateDocumentPreview(await fileSpace.readDocumentPreview(path));
        if (preview.path !== path) throw new TypeError("Native File Space returned a different document path");
        return preview;
      }
      case "fileSpace.copyFile": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        if (request.args.length !== 4) throw new TypeError("Native File Space copy request is malformed");
        const [sourceValue, name, destinationValue, newName] = request.args;
        const source = validateFileSpacePath(sourceValue);
        const destination = validateFileSpacePath(destinationValue);
        return listingAt(fileSpace.copyFile(source, fileName(name, "copy name"), destination,
          newName === null ? null : fileName(newName, "copy destination name")), destination);
      }
      case "fileSpace.renameEntry": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        if (request.args.length !== 3) throw new TypeError("Native File Space rename request is malformed");
        const [pathValue, name, newName] = request.args;
        const path = validateFileSpacePath(pathValue);
        return listingAt(fileSpace.renameEntry(path, fileName(name, "rename name"),
          fileName(newName, "renamed entry name")), path);
      }
      case "fileSpace.moveEntry": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        if (request.args.length !== 3) throw new TypeError("Native File Space move request is malformed");
        const [sourceValue, name, destinationValue] = request.args;
        const source = validateFileSpacePath(sourceValue);
        const destination = validateFileSpacePath(destinationValue);
        return listingAt(fileSpace.moveEntry(source, fileName(name, "move name"), destination), destination);
      }
      case "fileSpace.trashEntry": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        if (request.args.length !== 2) throw new TypeError("Native File Space trash request is malformed");
        const [pathValue, name] = request.args;
        const path = validateFileSpacePath(pathValue);
        return listingAt(fileSpace.trashEntry(path, fileName(name, "trash name")), path);
      }
      case "fileSpace.listTrash": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        if (request.args.length !== 0) throw new TypeError("Native File Space trash-list request is malformed");
        return validateTrashListing(await fileSpace.listTrash());
      }
      case "fileSpace.restoreTrashEntry": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        oneArgument("File Space trash-restore");
        const id = request.args[0];
        if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) throw new TypeError("Native File Space trash id is invalid");
        return validateTrashListing(await fileSpace.restoreTrashEntry(id));
      }
      case "fileSpace.exportFile": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        oneArgument("File Space export");
        return fileSpace.exportFile(validateFileSpacePath(request.args[0]));
      }
      case "fileSpace.importFile": {
        if (fileSpace === null) throw new TypeError("Native File Space operation is unavailable");
        if (request.args.length !== 3) throw new TypeError("Native File Space import request is malformed");
        const [pathValue, name, bytes] = request.args;
        const path = validateFileSpacePath(pathValue);
        const payloadName = fileName(name, "import name");
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FILE_IMPORT_BYTES) {
          throw new TypeError("Native File Space import payload is invalid or too large");
        }
        return listingAt(fileSpace.importFile(path, payloadName, bytes), path);
      }
      case "recentFiles.getSnapshot": {
        if (recentFiles === null) throw new TypeError("Native recent-files operation is unavailable");
        if (request.args.length !== 0) throw new TypeError("Native recent-files snapshot request is malformed");
        return validateRecentFilesSnapshot(recentFiles.getSnapshot());
      }
      case "recentFiles.subscribe": {
        if (recentFiles === null) throw new TypeError("Native recent-files operation is unavailable");
        const id = validateSubscription(request, "recent-files", recentFilesUnsubscribes);
        const unsubscribe = recentFiles.subscribe((snapshot) => queueAuthorizedUpdate(
          "recentFiles", id, validateRecentFilesSnapshot(snapshot),
        ));
        recentFilesUnsubscribes.set(id, unsubscribe);
        return true;
      }
      case "recentFiles.unsubscribe": {
        if (request.args.length !== 1 || !Number.isSafeInteger(request.args[0])) {
          throw new TypeError("Native recent-files unsubscribe request is malformed");
        }
        queuedUpdates.delete(`recentFiles:${request.args[0]}`);
        const unsubscribe = recentFilesUnsubscribes.get(request.args[0]);
        if (unsubscribe) { recentFilesUnsubscribes.delete(request.args[0]); unsubscribe(); }
        return true;
      }
      case "recentFiles.recordOpened":
      case "recentFiles.remove": {
        if (recentFiles === null) throw new TypeError("Native recent-files operation is unavailable");
        oneArgument("recent-files mutation");
        const path = validateRecentFilePath(request.args[0]);
        const snapshot = request.operation === "recentFiles.recordOpened"
          ? await recentFiles.recordOpened(path)
          : await recentFiles.remove(path);
        return validateRecentFilesSnapshot(snapshot);
      }
      case "recentFiles.clear": {
        if (recentFiles === null) throw new TypeError("Native recent-files operation is unavailable");
        if (request.args.length !== 0) throw new TypeError("Native recent-files clear request is malformed");
        return validateRecentFilesSnapshot(await recentFiles.clear());
      }
      case "recentFiles.relocate": {
        if (recentFiles === null) throw new TypeError("Native recent-files operation is unavailable");
        if (request.args.length !== 2) throw new TypeError("Native recent-files relocation request is malformed");
        return validateRecentFilesSnapshot(await recentFiles.relocate(
          validateRecentFilePath(request.args[0]), validateRecentFilePath(request.args[1]),
        ));
      }
      case "projects.getSnapshot": {
        if (projects === null) throw new TypeError("Native project-catalog operation is unavailable");
        if (request.args.length !== 0) throw new TypeError("Native project-catalog snapshot request is malformed");
        return validateProjectCatalogSnapshot(projects.getSnapshot());
      }
      case "projects.subscribe": {
        if (projects === null) throw new TypeError("Native project-catalog operation is unavailable");
        const id = validateSubscription(request, "project-catalog", projectUnsubscribes);
        const unsubscribe = projects.subscribe((snapshot) => queueAuthorizedUpdate(
          "projects", id, validateProjectCatalogSnapshot(snapshot),
        ));
        projectUnsubscribes.set(id, unsubscribe);
        return true;
      }
      case "projects.unsubscribe": {
        if (request.args.length !== 1 || !Number.isSafeInteger(request.args[0])) {
          throw new TypeError("Native project-catalog unsubscribe request is malformed");
        }
        queuedUpdates.delete(`projects:${request.args[0]}`);
        const unsubscribe = projectUnsubscribes.get(request.args[0]);
        if (unsubscribe) { projectUnsubscribes.delete(request.args[0]); unsubscribe(); }
        return true;
      }
      case "projects.create": {
        if (projects === null) throw new TypeError("Native project-catalog operation is unavailable");
        if (request.args.length !== 1 || !request.args[0] || typeof request.args[0] !== "object"
          || Array.isArray(request.args[0]) || Object.keys(request.args[0]).sort().join(",") !== "name,path") {
          throw new TypeError("Native project creation request is malformed");
        }
        const input = Object.freeze({
          name: validateProjectName(request.args[0].name),
          path: validateProjectPath(request.args[0].path),
        });
        return validateProjectCatalogSnapshot(await projects.create(input));
      }
      case "projects.rename": {
        if (projects === null) throw new TypeError("Native project-catalog operation is unavailable");
        if (request.args.length !== 2) throw new TypeError("Native project rename request is malformed");
        return validateProjectCatalogSnapshot(await projects.rename(
          validateProjectId(request.args[0]), validateProjectName(request.args[1]),
        ));
      }
      case "projects.recordOpened": {
        if (projects === null) throw new TypeError("Native project-catalog operation is unavailable");
        oneArgument("project record-opened");
        return validateProjectCatalogSnapshot(await projects.recordOpened(validateProjectId(request.args[0])));
      }
      case "projects.recordFileOpened": {
        if (projects === null) throw new TypeError("Native project-catalog operation is unavailable");
        if (request.args.length !== 2) throw new TypeError("Native project file-opened request is malformed");
        const projectId = validateProjectId(request.args[0]);
        const project = validateProjectCatalogSnapshot(projects.getSnapshot()).projects
          .find((entry) => entry.id === projectId);
        if (!project) throw new TypeError("Native project is not registered");
        const path = validateProjectFilePath(project.path, request.args[1]);
        return validateProjectCatalogSnapshot(await projects.recordFileOpened(projectId, path));
      }
      case "projects.clearLastFile": {
        if (projects === null) throw new TypeError("Native project-catalog operation is unavailable");
        oneArgument("project clear-last-file");
        return validateProjectCatalogSnapshot(await projects.clearLastFile(validateProjectId(request.args[0])));
      }
      case "projects.relocateLastFilePath": {
        if (projects === null) throw new TypeError("Native project-catalog operation is unavailable");
        if (request.args.length !== 2) throw new TypeError("Native project relocation request is malformed");
        return validateProjectCatalogSnapshot(await projects.relocateLastFilePath(
          validateFileSpacePath(request.args[0]), validateFileSpacePath(request.args[1]),
        ));
      }
      case "projects.remove": {
        if (projects === null) throw new TypeError("Native project-catalog operation is unavailable");
        oneArgument("project remove");
        return validateProjectCatalogSnapshot(await projects.remove(validateProjectId(request.args[0])));
      }
      case "appActivation.publish": {
        if (appActivation === null) throw new TypeError("Native app-activation operation is unavailable");
        oneArgument("app activation");
        const activation = validateAppActivation(request.args[0]);
        if (activation.appId !== componentId
          || (activation.target !== null && validateFileSpacePath(activation.target) !== activation.target)) {
          throw new TypeError("Native Files may publish only its own device-local target");
        }
        return validateAppActivation(await appActivation.publish(activation));
      }
      case "appActivation.subscribe": {
        if (appActivation === null) throw new TypeError("Native app-activation operation is unavailable");
        const id = validateSubscription(request, "app-activation", activationUnsubscribes);
        const unsubscribe = appActivation.subscribe((value) => {
          const activation = validateAppActivation(value);
          if (activation.appId === componentId) {
            queueAuthorizedUpdate("appActivation", id, activation);
          }
        });
        activationUnsubscribes.set(id, unsubscribe);
        return true;
      }
      case "appActivation.unsubscribe": {
        if (request.args.length !== 1 || !Number.isSafeInteger(request.args[0])) {
          throw new TypeError("Native app-activation unsubscribe request is malformed");
        }
        queuedUpdates.delete(`appActivation:${request.args[0]}`);
        const unsubscribe = activationUnsubscribes.get(request.args[0]);
        if (unsubscribe) { activationUnsubscribes.delete(request.args[0]); unsubscribe(); }
        return true;
      }
      default: throw new TypeError("Native app bridge operation is not authorized");
    }
  };
  port.addEventListener("message", (event) => {
    const request = event.data;
    if (revoked || !request || request.schema !== BRIDGE_SCHEMA) return;
    if (request.type === "runtime.error") return;
    if (request.type === "cancel") {
      if (Object.keys(request).sort().join(",") === "id,schema,type"
        && Number.isSafeInteger(request.id) && request.id > 0) {
        inferenceByRequest.get(request.id)?.abort();
      }
      return;
    }
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
  windowRef, identity, context, timeoutMs, expectedCurrent, expectedPending, slotAuthority,
}) {
  const pending = expectedPending !== undefined && expectedPending !== null;
  const expected = pending ? expectedPending : expectedCurrent;
  if (!expected || expected.componentId !== identity.componentId
    || expected.state !== (pending ? "pending" : "current") || expected.source !== "slot"
    || expected.version !== identity.version
    || expected.sourceCommit !== identity.sourceCommit
    || expected.entrypoint !== identity.entrypoint
    || (pending && (!["files", "assistant"].includes(identity.componentId)
      || expected.pendingHealth !== "unknown"))) {
    throw new TypeError(pending
      ? "Native pending mount requires its exact unknown-health supported slot identity"
      : "Native isolated app requires its exact verified current-slot identity");
  }
  const verifiedContext = assertContext(
    context,
    identity.componentId,
    {
      allowMissingAppData: pending,
      syntheticIntelligenceClient: pending && identity.componentId === "assistant",
    },
  );
  const mountContext = !pending ? verifiedContext
    : identity.componentId === "assistant"
      ? createPendingIntelligenceClientContext(verifiedContext)
      : createPendingFilesReadOnlyContext(verifiedContext);
  const { lifecycle, appData, fileSpace, recentFiles, projects, appActivation, identitySession, spaceSelection, intelligence } = mountContext;
  const authorizeSlot = () => pending
    ? slotAuthority.assertPending(expected)
    : slotAuthority.assertCurrent(expected);
  await authorizeSlot();
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
      fileSpace,
      recentFiles,
      projects,
      appActivation,
      identitySession,
      spaceSelection,
      intelligence,
      allowedOperations: !pending ? null
        : identity.componentId === "assistant"
          ? PENDING_INTELLIGENCE_CLIENT_MOUNT_OPERATIONS
          : PENDING_FILES_MOUNT_OPERATIONS,
      pendingReadOnlyMount: pending,
      authorizeOperation: authorizeSlot,
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
  const appTarget = pending ? null : validateWorkspaceTarget(
    lifecycle.getAppTarget(identity.componentId),
  );
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
        pendingMount: pending,
        moduleUrl: identity.moduleUrl, appDataIdentity: appData?.identity ?? null,
        fileSpaceScope: fileSpace?.scope ?? null,
        recentFilesSnapshot: recentFiles === null ? null
          : validateRecentFilesSnapshot(recentFiles.getSnapshot()),
        projectCatalogSnapshot: projects === null ? null
          : validateProjectCatalogSnapshot(projects.getSnapshot()),
        identitySessionSnapshot: identitySession === null ? null
          : validateIdentitySessionSnapshot(identitySession.getSnapshot()),
        spaceSelectionSnapshot: spaceSelection === null ? null
          : validateSpaceSelectionSnapshot(spaceSelection.getSnapshot()),
        intelligenceSnapshot: intelligence === null ? null
          : validateIntelligenceSnapshot(intelligence.getSnapshot()),
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
  try {
    await authorizeSlot();
  } catch (error) {
    try { await destroy(); } catch { /* slot replacement still fails closed */ }
    throw error;
  }
  return Object.freeze({ destroy });
}

/**
 * Create the sole Native ESM importer for signed component slots. Source code
 * runs in an opaque-origin sandboxed iframe; the parent exposes narrow App
 * Data and Surface lifecycle RPC brokers. Only the verified Files slot may
 * receive the fixed device-local File Space through its bounded RPC broker.
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
 * Create the pending-slot probe used by Native component probation. Candidate
 * bytes are first imported in an opaque-origin frame with no host bridge and
 * exact pending metadata checks. Only explicitly mountable Files or the
 * Intelligence client then gets a second opaque frame with synthetic data
 * and a read-only allowlist;
 * neither path activates, promotes or exposes the pending slot to the Surface.
 */
export function createNativeIsolatedPendingComponentModuleImporter({
  windowRef = globalThis.window,
  allowedComponentIds,
  mountableComponentIds = [],
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
    || !Array.isArray(mountableComponentIds)
    || mountableComponentIds.some((id) =>
      !["files", "assistant"].includes(id) || !allowedComponentIds.includes(id))
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
        mount(context) {
          if (!mountableComponentIds.includes(identity.componentId)) {
            throw new TypeError("Import-contract probation cannot mount or activate a pending component");
          }
          return mountIsolatedRuntime({
            windowRef,
            identity,
            context,
            timeoutMs,
            expectedPending: expected,
            slotAuthority,
          });
        },
      }),
    });
  };
}

export const NATIVE_ISOLATED_COMPONENT_PROBE_SCHEMA = PENDING_PROBE_SCHEMA;
