import { createNativeIntelligenceService } from "../../services/intelligence/native-service.mjs";

export const NATIVE_INTELLIGENCE_HOST_REQUEST_EVENT =
  "ordax-native-intelligence-request";
export const NATIVE_INTELLIGENCE_HOST_READY_TYPE =
  "intelligence.host.ready";
export const NATIVE_INTELLIGENCE_HOST_RESULT_TYPE =
  "intelligence.host.result";

const NONCE_RE = /^[A-Za-z0-9_-]{32,64}$/;
const HOST_REQUEST_KEYS = Object.freeze(["nonce", "request"]);

function exactKeys(value, expected) {
  return Object.keys(value).sort().join(",") === expected.join(",");
}

function validateHostRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, HOST_REQUEST_KEYS)) {
    throw new TypeError("Native Intelligence host request fields are incompatible");
  }
  if (typeof value.nonce !== "string" || NONCE_RE.test(value.nonce) === false) {
    throw new TypeError("Native Intelligence host nonce is invalid");
  }
  if (!value.request || typeof value.request !== "object" || Array.isArray(value.request)) {
    throw new TypeError("Native Intelligence host request envelope is invalid");
  }
  const requestId = value.request.requestId;
  if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 160) {
    throw new TypeError("Native Intelligence host request id is invalid");
  }
  return Object.freeze({
    nonce: value.nonce,
    requestId: requestId.trim(),
    request: value.request,
  });
}

function resolveBrowserBridge(windowRef) {
  const bridge = windowRef?.webkit?.messageHandlers?.ordaxBrowser;
  if (!bridge || typeof bridge.postMessage !== "function") {
    throw new Error("Native Intelligence privileged browser bridge is unavailable");
  }
  return bridge;
}

function postMessage(windowRef, payload) {
  resolveBrowserBridge(windowRef).postMessage(JSON.stringify(payload));
}

/**
 * Binds the already-composed Native Intelligence consumer service to the
 * privileged WebKit host bridge. The service stays in JavaScript, where the
 * canonical Identity, Space and Intelligence owners already exist. The Python
 * host transports bounded messages only and never becomes an Intelligence
 * runtime/provider/router/Memory owner.
 */
export function installNativeIntelligenceHostBridge({
  windowRef,
  intelligencePort,
  identitySessionPort,
  spaceSelectionPort,
} = {}) {
  if (!windowRef || typeof windowRef.addEventListener !== "function"
    || typeof windowRef.removeEventListener !== "function") {
    throw new TypeError("Native Intelligence host bridge requires a window-like event target");
  }

  const service = createNativeIntelligenceService({
    intelligencePort,
    identitySessionPort,
    spaceSelectionPort,
  });

  const onRequest = async (event) => {
    let envelope;
    try {
      envelope = validateHostRequest(event?.detail);
    } catch {
      // A malformed host event is not trustworthy enough to correlate a reply.
      return;
    }

    try {
      const response = await service.respond(envelope.request);
      postMessage(windowRef, {
        type: NATIVE_INTELLIGENCE_HOST_RESULT_TYPE,
        nonce: envelope.nonce,
        requestId: envelope.requestId,
        ok: true,
        response,
      });
    } catch {
      // The bridge deliberately does not claim whether model execution started.
      // Upstream transport must treat this as unknown outcome and must not retry
      // automatically until the canonical idempotency/receipt path is composed.
      postMessage(windowRef, {
        type: NATIVE_INTELLIGENCE_HOST_RESULT_TYPE,
        nonce: envelope.nonce,
        requestId: envelope.requestId,
        ok: false,
        outcome: "unknown",
        error: "unavailable",
      });
    }
  };

  windowRef.addEventListener(NATIVE_INTELLIGENCE_HOST_REQUEST_EVENT, onRequest);
  try {
    postMessage(windowRef, { type: NATIVE_INTELLIGENCE_HOST_READY_TYPE });
  } catch (error) {
    windowRef.removeEventListener(NATIVE_INTELLIGENCE_HOST_REQUEST_EVENT, onRequest);
    throw error;
  }

  return Object.freeze({
    dispose() {
      windowRef.removeEventListener(NATIVE_INTELLIGENCE_HOST_REQUEST_EVENT, onRequest);
    },
  });
}
