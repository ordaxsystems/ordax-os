import { createNativeBoundAppDataPort } from "../../adapters/native/bound-app-data.mjs";
import { installTrustedComponentContextProvider } from "../../services/components/runtime-loader.mjs";

const BOOTSTRAP_SCHEMA = "ordax.native-app-data-composition-bootstrap/1";
const BOOTSTRAP_EVENT = "ordax-native-app-data-bootstrap";
const BOOTSTRAP_REQUEST = "app-data.bootstrap.request";
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 5000;

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

export function createTrustedNativeAppDataContextBootstrap({
  windowRef = globalThis,
  timeoutMs = DEFAULT_BOOTSTRAP_TIMEOUT_MS,
} = {}) {
  const boundedTimeout = validateTimeout(timeoutMs);
  if (!windowRef || typeof windowRef.addEventListener !== "function") {
    throw new TypeError("Native App Data bootstrap requires an event-capable window");
  }
  const bridge = windowRef.webkit?.messageHandlers?.ordaxBrowser;
  if (!bridge || typeof bridge.postMessage !== "function") {
    throw new TypeError("Native App Data bootstrap requires the privileged OrdaX browser bridge");
  }

  let settled = false;
  const ready = new Promise((resolve, reject) => {
    const timer = windowRef.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Native App Data bootstrap timed out"));
    }, boundedTimeout);

    windowRef.addEventListener(
      BOOTSTRAP_EVENT,
      (event) => {
        if (settled) return;
        try {
          const detail = event?.detail;
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
                windowRef,
                endpoint: binding.endpoint,
                identity,
              }),
            );
          }
          windowRef.clearTimeout(timer);
          settled = true;
          resolve(ports);
        } catch (error) {
          windowRef.clearTimeout(timer);
          settled = true;
          reject(error);
        }
      },
      { once: true },
    );
  });

  installTrustedComponentContextProvider(async (componentId) => {
    const ports = await ready;
    const appData = ports.get(componentId) ?? null;
    return appData === null ? null : Object.freeze({ appData });
  });

  bridge.postMessage(JSON.stringify({ type: BOOTSTRAP_REQUEST }));
  return Object.freeze({ schema: BOOTSTRAP_SCHEMA });
}

createTrustedNativeAppDataContextBootstrap();
