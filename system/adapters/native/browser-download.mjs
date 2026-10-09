import {
  BROWSER_DOWNLOAD_PORT_SCHEMA,
  assertBrowserDownloadPort,
  validateBrowserDownloadEvent,
  validateBrowserDownloadId,
} from "../../contracts/browser-download.mjs";

const EVENT_NAME = "ordax-browser-host";

export function createNativeBrowserDownload(windowRef = globalThis.window) {
  const bridge = windowRef?.webkit?.messageHandlers?.ordaxBrowser;
  if (!bridge || typeof bridge.postMessage !== "function") return null;
  const listeners = new Set();
  let disposed = false;
  const post = (type, id) => {
    if (disposed) return false;
    validateBrowserDownloadId(id);
    bridge.postMessage(JSON.stringify({ type, id }));
    return true;
  };
  const onHostEvent = (event) => {
    if (disposed || event?.detail?.type !== "browser-download") return;
    let validated;
    try {
      validated = validateBrowserDownloadEvent(event.detail);
    } catch {
      return;
    }
    for (const listener of [...listeners]) listener(validated);
  };
  windowRef.addEventListener(EVENT_NAME, onHostEvent);
  return assertBrowserDownloadPort(Object.freeze({
    schema: BROWSER_DOWNLOAD_PORT_SCHEMA,
    approve: (id) => post("download.approve", id),
    cancel: (id) => post("download.cancel", id),
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Download listener required");
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      windowRef.removeEventListener(EVENT_NAME, onHostEvent);
    },
  }));
}
