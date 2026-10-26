import { hasNativeHostBridge, postNativeHostMessage } from "./host-bridge.mjs";

// One browser protocol for Native and Desktop. The platform changes only the
// transport; the Electron fallback does not advertise privileged OS IPC.
const MAX_DESKTOP_COMMAND_CHARS = 12000;
function desktopBrowserBridge(windowRef) {
  if (windowRef?.location?.protocol !== "http:" ||
      windowRef.location.hostname !== "127.0.0.1") return null;
  const bridge = windowRef?.ordaxDesktopBrowser;
  return typeof bridge?.postMessage === "function" ? bridge : null;
}
// One authority for detecting the installed Electron transport. A browser
// bridge is not a Linux Native host; platform-specific OS ports must not be
// requested through this transport unless a Windows adapter owns them.
export function hasDesktopBrowserTransport(windowRef = globalThis.window) {
  return Boolean(desktopBrowserBridge(windowRef));
}
export function hasBrowserHostTransport(windowRef = globalThis.window) {
  return hasNativeHostBridge(windowRef) || hasDesktopBrowserTransport(windowRef);
}
export function postBrowserHostCommand(windowRef, payload) {
  if (hasNativeHostBridge(windowRef)) return postNativeHostMessage(windowRef, payload);
  const bridge = desktopBrowserBridge(windowRef);
  if (!bridge) throw new Error("OrdaX browser host transport unavailable");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("OrdaX browser host payload must be an object");
  }
  const serialized = JSON.stringify(payload);
  if (typeof serialized !== "string" || serialized.length > MAX_DESKTOP_COMMAND_CHARS) {
    throw new TypeError("OrdaX desktop browser command exceeds transport limit");
  }
  return bridge.postMessage(serialized) !== false;
}
