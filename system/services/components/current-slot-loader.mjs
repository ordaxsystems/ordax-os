import { validateComponentId } from "../../contracts/component-manifest.mjs";
import { assertComponentSlotSource } from "../../contracts/component-slot-source.mjs";
import { validateComponentRuntimeMetadata } from "../../contracts/component-runtime-metadata.mjs";
import { validateComponentRuntime, validateMountedComponent } from "../../contracts/component-runtime.mjs";
import { composeTrustedComponentContext } from "./runtime-loader.mjs";
import { assertAppDataPort } from "../../contracts/app-data.mjs";

const REQUEST_OPTIONS = Object.freeze({
  method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error",
});

function timeoutMs(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 30_000) {
    throw new TypeError("Current component timeout must be 100..30000 ms");
  }
  return value;
}

async function bounded(operation, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Current component ${label} timed out`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function canonicalMetadataUrl(source, componentId) {
  const url = new URL(source.metadataUrl(componentId, "current"));
  const keys = [...url.searchParams.keys()].sort();
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
    || url.username || url.password || url.hash
    || url.pathname !== "/__ordax/native/component-runtime"
    || keys.join(",") !== "component,state"
    || url.searchParams.get("component") !== componentId
    || url.searchParams.get("state") !== "current") {
    throw new TypeError("Current component metadata must use canonical Native loopback endpoint");
  }
  return url;
}

async function mountBounded(runtime, context, milliseconds, componentId) {
  let expired = false;
  let timer;
  const pending = Promise.resolve()
    .then(() => runtime.mount(context))
    .then((value) => {
      const mounted = validateMountedComponent(value, componentId);
      if (expired) {
        try { mounted.destroy(); } catch { /* app-owned cleanup is isolated */ }
        throw new Error("Current component mount completed after its deadline");
      }
      return mounted;
    });
  try {
    return await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error("Current component mount timed out"));
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readCurrent(source, componentId, fetchImpl, timeout) {
  const url = canonicalMetadataUrl(source, componentId);
  const response = await bounded(
    () => fetchImpl(url.href, REQUEST_OPTIONS),
    timeout,
    "metadata fetch",
  );
  if (!response || response.ok !== true || typeof response.json !== "function") {
    throw new Error("Current component metadata unavailable");
  }
  return validateComponentRuntimeMetadata(
    await bounded(() => response.json(), timeout, "metadata decode"),
    { componentId, state: "current" },
  );
}

function identityMatches(previous, next) {
  return ["componentId", "state", "source", "revision", "version", "sourceCommit", "entrypoint"]
    .every((field) => previous[field] === next[field]);
}

function verifiedModuleUrl(source, current) {
  const metadata = canonicalMetadataUrl(source, current.componentId);
  const url = new URL(source.runtimeUrl(current));
  const prefix = `/__ordax/native/component-module/${current.componentId}/current/${current.version}/`
    + `${current.sourceCommit}/`;
  if (url.origin !== metadata.origin || !["http:", "https:"].includes(url.protocol)
    || url.username || url.password || url.search || url.hash
    || url.pathname !== prefix + current.entrypoint) {
    throw new TypeError("Current module URL escaped immutable Native namespace");
  }
  return url.href;
}

// A caller supplies the shared Surface element, never a shared app mount point.
// Validate it before any fetch/import; only create the per-app mount node after
// slot identity and trusted host bindings have been verified.
function assertComponentMountParent(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(context))) {
    throw new TypeError("Current component context must be a plain object");
  }
  const hasOwnRoot = Object.prototype.hasOwnProperty.call(context, "root");
  if ("root" in context && !hasOwnRoot) {
    throw new TypeError("Current component mount parent cannot be inherited");
  }
  if (!hasOwnRoot) return;
  const descriptor = Object.getOwnPropertyDescriptor(context, "root");
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    throw new TypeError("Current component mount parent must be a data property");
  }
  const parent = descriptor.value;
  if (!parent || typeof parent !== "object" || parent.nodeType !== 1
    || typeof parent.append !== "function"
    || !parent.ownerDocument
    || typeof parent.ownerDocument.createElement !== "function") {
    throw new TypeError("Current component mount parent must be a Surface Element");
  }
}

function createComponentMountContext(context, componentId) {
  if (!Object.prototype.hasOwnProperty.call(context, "root")) {
    return { context, releaseRoot: null };
  }
  const parent = Object.getOwnPropertyDescriptor(context, "root").value;
  const root = parent.ownerDocument.createElement("div");
  if (!root || root.nodeType !== 1 || typeof root.append !== "function"
    || typeof root.remove !== "function" || !root.dataset || !root.style
    || !root.childNodes || root.childNodes.length !== 0) {
    try { root?.remove?.(); } catch { /* invalid DOM factory output is isolated */ }
    throw new TypeError("Current component mount root must be a fresh empty Element");
  }

  let released = false;
  const releaseRoot = () => {
    if (released) return;
    released = true;
    root.remove();
  };
  const mountContext = Object.freeze({ ...context, root });
  try {
    root.className = "ordax-native-installed-component-root";
    root.dataset.ordaxComponentRoot = componentId;
    // Preserve the existing Surface layout while limiting app selectors and
    // mount mutations to this component-owned subtree.
    root.style.display = "contents";
    parent.append(root);
    if (root.parentNode !== parent) {
      throw new TypeError("Current component mount root was not attached to its Surface");
    }
  } catch (error) {
    try { releaseRoot(); } catch { /* mount root teardown is best effort */ }
    throw error;
  }
  return { context: mountContext, releaseRoot };
}

/**
 * Consume an already verified Native 'current' slot. Never installs, promotes
 * or falls back to platform-owned app source. Absence is an optional-app state.
 */
export async function loadVerifiedCurrentComponentRuntime({
  componentId, source, fetchImpl, importModule,
  context = Object.freeze({}), timeout = 5_000, onError = null,
  expectedCurrent = null,
  requireTrustedAppData = false,
} = {}) {
  const id = validateComponentId(componentId);
  const slotSource = assertComponentSlotSource(source);
  const limit = timeoutMs(timeout);
  const expected = expectedCurrent === null ? null : validateComponentRuntimeMetadata(expectedCurrent, {
    componentId: id, state: "current",
  });
  if (typeof requireTrustedAppData !== "boolean") {
    throw new TypeError("Current component App Data requirement must be boolean");
  }
  if (typeof fetchImpl !== "function" || typeof importModule !== "function") {
    throw new TypeError("Current component requires fetch and import ports");
  }
  if (onError !== null && typeof onError !== "function") {
    throw new TypeError("Current component onError must be a function or null");
  }
  let mounted = null;
  let releaseMountRoot = null;
  try {
    assertComponentMountParent(context);
    // The privileged Native bootstrap is the only owner of App Data binding.
    // External apps cannot be read/imported when its expected binding is absent.
    const trustedBeforeImport = requireTrustedAppData
      ? await bounded(() => composeTrustedComponentContext(id, context), limit, "trusted context")
      : null;
    if (trustedBeforeImport !== null) {
      const appData = assertAppDataPort(trustedBeforeImport.appData);
      if (appData.identity.appId !== id) {
        throw new TypeError("Trusted App Data identity does not match the installed app");
      }
    }
    const current = await readCurrent(slotSource, id, fetchImpl, limit);
    if (current.source === "absent") return null;
    if (expected !== null && !identityMatches(expected, current)) {
      throw new Error("Current slot changed since verified discovery");
    }
    if (current.source !== "slot") {
      throw new TypeError("Bundled source cannot be used as an installed component slot");
    }
    const url = verifiedModuleUrl(slotSource, current);
    const imported = await bounded(() => importModule(url), limit, "import");
    const runtime = validateComponentRuntime(imported?.componentRuntime, {
      componentId: id, version: current.version,
    });
    if (!identityMatches(current, await readCurrent(slotSource, id, fetchImpl, limit))) {
      throw new Error("Current slot changed before mount");
    }
    const effectiveContext = trustedBeforeImport ?? await bounded(
      () => composeTrustedComponentContext(id, context), limit, "trusted context",
    );
    const mountContext = createComponentMountContext(effectiveContext, id);
    releaseMountRoot = mountContext.releaseRoot;
    mounted = await mountBounded(runtime, mountContext.context, limit, id);
    if (!identityMatches(current, await readCurrent(slotSource, id, fetchImpl, limit))) {
      throw new Error("Current slot changed during mount");
    }

    const runtimeMount = mounted;
    const releaseRoot = releaseMountRoot;
    let destroyed = false;
    mounted = null;
    releaseMountRoot = null;
    return Object.freeze({
      destroy() {
        if (destroyed) return;
        destroyed = true;
        try { runtimeMount.destroy(); } finally { releaseRoot?.(); }
      },
    });
  } catch (error) {
    try { mounted?.destroy(); } catch { /* component errors cannot crash Surface */ }
    try { releaseMountRoot?.(); } catch { /* mount root cleanup is isolated */ }
    onError?.(error);
    return null;
  }
}
