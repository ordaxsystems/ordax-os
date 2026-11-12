import { assertComponentMountParent } from "../../services/components/runtime-mount.mjs";
import { installComponentProbationContextProvider } from "../../services/components/probation-context.mjs";
import { validateComponentId } from "../../contracts/component-manifest.mjs";
import { systemComponentProbationProbeMode } from "../../services/components/probation-orchestrator.mjs";

export const NATIVE_COMPONENT_PENDING_HOST_SCHEMA =
  "ordax.native-component-pending-host/1";

function normalizeError(error, fallback) {
  if (error instanceof Error) return error;
  return new Error(fallback);
}

function createHiddenProbationHost(root, targetId) {
  assertComponentMountParent({ root }, { label: "Component probation host" });
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
    throw new TypeError("Component probation host must be a removable Surface Element");
  }
  host.className = "ordax-native-component-probation-host";
  host.dataset.ordaxComponentProbationHost = targetId;
  host.hidden = true;
  host.style.display = "none";
  root.append(host);
  if (host.parentNode !== root) {
    try { host.remove(); } catch { /* failed attachment cleanup is best effort */ }
    throw new TypeError("Component probation host was not attached to its Surface");
  }
  return host;
}

export function createNativePendingComponentHostBootstrap({
  componentId, createPorts,
  installProvider = installComponentProbationContextProvider,
} = {}) {
  const targetId = validateComponentId(componentId);
  if (systemComponentProbationProbeMode(targetId) !== "mount-contract") {
    throw new TypeError("Component probation requires mount-contract mode");
  }
  if (typeof createPorts !== "function") {
    throw new TypeError("Component probation requires typed host-port validation");
  }
  if (typeof installProvider !== "function") {
    throw new TypeError("Component probation context requires a provider installer");
  }
  let resolveReady;
  let state = "pending";
  let terminalError = null;
  let host = null;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const provider = async (requestedId) => {
    if (requestedId !== targetId) return null;
    const outcome = await ready;
    if (terminalError !== null) throw terminalError;
    if (!outcome?.context || !outcome?.root) {
      throw normalizeError(outcome?.error, "Component probation context is unavailable");
    }
    host ??= createHiddenProbationHost(outcome.root, targetId);
    return Object.freeze({ ...outcome.context, root: host });
  };

  installProvider(provider);

  const bind = ({ root, ports } = {}) => {
    if (state !== "pending") {
      throw new Error("Component probation context can only be bound once");
    }
    try {
      assertComponentMountParent({ root }, { label: "Component probation host" });
      // Pending probation and verified current installation are separate
      // lifecycle states. The probation loader verifies pending provenance;
      // port validation must not assume (or forge) a current installed slot.
      const context = createPorts(ports);
      state = "bound";
      resolveReady(Object.freeze({ context, root }));
      return context;
    } catch (error) {
      terminalError = normalizeError(error, "Component probation context binding failed");
      state = "failed";
      resolveReady(Object.freeze({ error: terminalError }));
      throw terminalError;
    }
  };

  const fail = (error) => {
    if (state === "destroyed") return;
    terminalError = normalizeError(error, "Component probation context failed");
    if (state === "pending") {
      resolveReady(Object.freeze({ error: terminalError }));
    }
    state = "failed";
  };

  const destroy = () => {
    if (state === "destroyed") return;
    if (state === "pending") {
      fail(new Error("Component probation context was destroyed before binding"));
    }
    terminalError ??= new Error("Component probation context is destroyed");
    state = "destroyed";
    try { host?.remove?.(); } finally { host = null; }
  };

  return Object.freeze({
    schema: NATIVE_COMPONENT_PENDING_HOST_SCHEMA,
    bind,
    fail,
    destroy,
  });
}
