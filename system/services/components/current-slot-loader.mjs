import { validateComponentId } from "../../contracts/component-manifest.mjs";
import { assertComponentSlotSource } from "../../contracts/component-slot-source.mjs";
import { validateComponentRuntimeMetadata } from "../../contracts/component-runtime-metadata.mjs";
import { validateComponentRuntime, validateMountedComponent } from "../../contracts/component-runtime.mjs";

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

/**
 * Consume an already verified Native 'current' slot. Never installs, promotes
 * or falls back to platform-owned app source. Absence is an optional-app state.
 */
export async function loadVerifiedCurrentComponentRuntime({
  componentId, source, fetchImpl, importModule,
  context = Object.freeze({}), timeout = 5_000, onError = null,
} = {}) {
  const id = validateComponentId(componentId);
  const slotSource = assertComponentSlotSource(source);
  const limit = timeoutMs(timeout);
  if (typeof fetchImpl !== "function" || typeof importModule !== "function") {
    throw new TypeError("Current component requires fetch and import ports");
  }
  if (onError !== null && typeof onError !== "function") {
    throw new TypeError("Current component onError must be a function or null");
  }
  let mounted = null;
  try {
    const current = await readCurrent(slotSource, id, fetchImpl, limit);
    if (current.source === "absent") return null;
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
    mounted = validateMountedComponent(
      await bounded(() => runtime.mount(context), limit, "mount"), id,
    );
    if (!identityMatches(current, await readCurrent(slotSource, id, fetchImpl, limit))) {
      throw new Error("Current slot changed during mount");
    }
    return mounted;
  } catch (error) {
    try { mounted?.destroy(); } catch { /* component errors cannot crash Surface */ }
    onError?.(error);
    return null;
  }
}
