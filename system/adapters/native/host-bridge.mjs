/**
 * Single page-to-host transport for the privileged Native Surface.
 * WebKit exposes its message handler only in the host's isolated script world;
 * this page-side adapter sends same-window messages, which the isolated listener
 * accepts only when MessageEvent.source is the top-level window itself.
 */
export const NATIVE_HOST_BRIDGE_READY_ATTRIBUTE = "data-ordax-native-host-bridge";
export const NATIVE_HOST_BRIDGE_READY_VALUE = "v1";
export const NATIVE_HOST_BRIDGE_MAX_MESSAGE_CHARS = 131072;

// This public DOM marker reports adapter availability; it never authorizes a
// component grant or substitutes for the host's independent message checks.
export function hasNativeHostBridge(windowRef = globalThis.window) {
  if (windowRef?.location?.protocol !== "http:" || windowRef.location.hostname !== "127.0.0.1") {
    return false;
  }
  return windowRef.document?.documentElement?.getAttribute?.(
    NATIVE_HOST_BRIDGE_READY_ATTRIBUTE,
  ) === NATIVE_HOST_BRIDGE_READY_VALUE;
}

export function postNativeHostMessage(windowRef, payload) {
  if (!hasNativeHostBridge(windowRef)) {
    throw new Error("Privileged OrdaX host bridge is unavailable");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Native host bridge payload must be an object");
  }
  const serialized = JSON.stringify(payload);
  if (typeof serialized !== "string" || serialized.length > NATIVE_HOST_BRIDGE_MAX_MESSAGE_CHARS) {
    throw new TypeError("Native host bridge payload exceeds its transport limit");
  }
  if (typeof windowRef.postMessage !== "function") {
    throw new TypeError("Native host message transport is unavailable");
  }

  // The destination is this Window itself. Opaque origins use `*`, while the
  // isolated receiver independently checks both event.source and event.origin.
  const origin = windowRef.location?.origin;
  const targetOrigin = typeof origin === "string" && origin !== "null" ? origin : "*";
  windowRef.postMessage(serialized, targetOrigin);
  return true;
}
