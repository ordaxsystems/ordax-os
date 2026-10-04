import { createNativeBoundAppDataPort } from "../../adapters/native/bound-app-data.mjs";
import { installTrustedComponentContextProvider } from "../../services/components/runtime-loader.mjs";

const BOOTSTRAP_SCHEMA = "ordax.native-app-data-composition-bootstrap/1";
const BOOTSTRAP_REQUEST = "app-data.bootstrap.request";
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 5000;

let bootstrapWindow = null;
let bootstrapResolve = null;
let bootstrapReject = null;
let bootstrapTimer = null;
let bootstrapSettled = false;

function validateTimeout(value) {
  if (!Number.isInteger(value) || value < 100 || value > 30000) {
    throw new TypeError("Native App Data bootstrap timeout is invalid");
  }
  return value;
}

function validateBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Native App Data bootstrap binding must be an object");
  }
  const keys = Object.keys(value).sort();
  const expected = ["appId", "endpoint", "ownerScope", "publisherId"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError("Native App Data bootstrap binding fields are invalid");
  }
  return Object.freeze({
    appId: value.appId,
    endpoint: value.endpoint,
    ownerScope: value.ownerScope,
    publisherId: value.publisherId,
  });
}

function failBootstrap(error) {
  if (bootstrapSettled) return;
  bootstrapSettled = true;
  if (bootstrapTimer !== null) bootstrapWindow.clearTimeout(bootstrapTimer);
  bootstrapTimer = null;
  bootstrapReject(error);
}

export function acceptTrustedNativeAppDataBootstrap(detail) {
  if (bootstrapWindow === null || bootstrapResolve === null || bootstrapReject === null) {
    throw new Error("Native App Data bootstrap is not initialized");
  }
  if (bootstrapSettled) {
    throw new Error("Native App Data bootstrap was already consumed");
  }
  try {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
      throw new TypeError("Native App Data bootstrap payload is invalid");
    }
    if (detail.schema !== BOOTSTRAP_SCHEMA || !Array.isArray(detail.bindings)) {
      throw new TypeError("Native App Data bootstrap schema is invalid");
    }
    const ports = new Map();
    for (const raw of detail.bindings) {
      const binding = validateBinding(raw);
      if (ports.has(binding.appId)) {
        throw new TypeError(`Native App Data bootstrap app is duplicated: ${binding.appId}`);
      }
      const identity = Object.freeze({
        publisherId: binding.publisherId,
        appId: binding.appId,
        ownerScope: binding.ownerScope,
      });
      ports.set(
        binding.appId,
        createNativeBoundAppDataPort({
          windowRef: bootstrapWindow,
          endpoint: binding.endpoint,
          identity,
        }),
      );
    }
    bootstrapSettled = true;
    if (bootstrapTimer !== null) bootstrapWindow.clearTimeout(bootstrapTimer);
    bootstrapTimer = null;
    bootstrapResolve(ports);
  } catch (error) {
    failBootstrap(error);
    throw error;
  }
}

export function createTrustedNativeAppDataContextBootstrap({
  windowRef = globalThis,
  timeoutMs = DEFAULT_BOOTSTRAP_TIMEOUT_MS,
} = {}) {
  const boundedTimeout = validateTimeout(timeoutMs);
  if (bootstrapWindow !== null) {
    throw new Error("Native App Data bootstrap is already initialized");
  }
  if (!windowRef || typeof windowRef.setTimeout !== "function" || typeof windowRef.clearTimeout !== "function") {
    throw new TypeError("Native App Data bootstrap requires a timer-capable privileged window");
  }
  const bridge = windowRef.webkit?.messageHandlers?.ordaxBrowser;
  if (!bridge || typeof bridge.postMessage !== "function") {
    throw new TypeError("Native App Data bootstrap requires the privileged OrdaX browser bridge");
  }

  bootstrapWindow = windowRef;
  const ready = new Promise((resolve, reject) => {
    bootstrapResolve = resolve;
    bootstrapReject = reject;
    bootstrapTimer = windowRef.setTimeout(() => {
      failBootstrap(new Error("Native App Data bootstrap timed out"));
    }, boundedTimeout);
  });

  installTrustedComponentContextProvider(async (componentId) => {
    const ports = await ready;
    const appData = ports.get(componentId) ?? null;
    return appData === null ? null : Object.freeze({ appData });
  });

  // The request carries no identity. The privileged Python host answers by
  // directly importing this module and calling acceptTrustedNativeAppDataBootstrap().
  // Opaque endpoints therefore never travel through DOM events or global state.
  bridge.postMessage(JSON.stringify({ type: BOOTSTRAP_REQUEST }));
  return Object.freeze({ schema: BOOTSTRAP_SCHEMA });
}

createTrustedNativeAppDataContextBootstrap();
