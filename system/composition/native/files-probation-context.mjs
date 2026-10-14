import { assertComponentMountParent } from "../../services/components/runtime-mount.mjs";
import { installComponentProbationContextProvider } from "../../services/components/probation-context.mjs";
import { createNativeFilesTrustedContextProvider } from "./files-trusted-context.mjs";

export const NATIVE_FILES_PROBATION_CONTEXT_SCHEMA =
  "ordax.native-files-probation-context/1";

function normalizeError(error, fallback) {
  if (error instanceof Error) return error;
  return new Error(fallback);
}

function createHiddenProbationHost(root) {
  assertComponentMountParent({ root }, { label: "Files probation host" });
  const host = root.ownerDocument.createElement("div");
  if (
    !host
    || host.nodeType !== 1
    || typeof host.append !== "function"
    || typeof host.remove !== "function"
    || !host.dataset
    || !host.style
  ) {
    try { host?.remove?.(); } catch { /* invalid DOM factory output is isolated */ }
    throw new TypeError("Files probation host must be a removable Surface Element");
  }
  host.className = "ordax-native-component-probation-host";
  host.dataset.ordaxComponentProbationHost = "files";
  host.hidden = true;
  host.style.display = "none";
  root.append(host);
  if (host.parentNode !== root) {
    try { host.remove(); } catch { /* failed attachment cleanup is best effort */ }
    throw new TypeError("Files probation host was not attached to its Surface");
  }
  return host;
}

export function createNativeFilesProbationContextBootstrap({
  installProvider = installComponentProbationContextProvider,
} = {}) {
  if (typeof installProvider !== "function") {
    throw new TypeError("Files probation context requires a provider installer");
  }
  let resolveReady;
  let state = "pending";
  let terminalError = null;
  let host = null;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const provider = async (componentId) => {
    if (componentId !== "files") return null;
    const outcome = await ready;
    if (terminalError !== null) throw terminalError;
    if (!outcome?.context) {
      throw normalizeError(outcome?.error, "Files probation context is unavailable");
    }
    return outcome.context;
  };

  installProvider(provider);

  const bind = ({
    root,
    fileSpace = null,
    recentFiles = null,
    projects = null,
    appActivation = null,
  } = {}) => {
    if (state !== "pending") {
      throw new Error("Files probation context can only be bound once");
    }
    try {
      host = createHiddenProbationHost(root);
      const trustedProvider = createNativeFilesTrustedContextProvider({
        fileSpace,
        recentFiles,
        projects,
        appActivation,
      });
      const context = Object.freeze({
        ...trustedProvider("files"),
        root: host,
      });
      state = "bound";
      resolveReady(Object.freeze({ context }));
      return context;
    } catch (error) {
      try { host?.remove?.(); } catch { /* failed binding cleanup is best effort */ }
      host = null;
      terminalError = normalizeError(error, "Files probation context binding failed");
      state = "failed";
      resolveReady(Object.freeze({ error: terminalError }));
      throw terminalError;
    }
  };

  const fail = (error) => {
    if (state === "destroyed") return;
    terminalError = normalizeError(error, "Files probation context failed");
    if (state === "pending") {
      resolveReady(Object.freeze({ error: terminalError }));
    }
    state = "failed";
  };

  const destroy = () => {
    if (state === "destroyed") return;
    if (state === "pending") {
      fail(new Error("Files probation context was destroyed before binding"));
    }
    terminalError ??= new Error("Files probation context is destroyed");
    state = "destroyed";
    try { host?.remove?.(); } finally { host = null; }
  };

  return Object.freeze({
    schema: NATIVE_FILES_PROBATION_CONTEXT_SCHEMA,
    bind,
    fail,
    destroy,
  });
}
