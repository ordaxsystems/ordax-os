import {
  BROWSER_PAGE_SELECTION_PORT_SCHEMA,
  assertBrowserPageSelectionPort,
  validateBrowserPageSelection,
} from "../../contracts/browser-page-selection.mjs";

const EVENT_NAME = "ordax-browser-host";
const HANDLER_NAME = "ordaxBrowser";
const CAPTURE_TIMEOUT_MS = 12000;
const TAB_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function createNativeBrowserPageSelection(windowRef = globalThis.window) {
  const bridge = windowRef?.webkit?.messageHandlers?.[HANDLER_NAME];
  if (!bridge || typeof bridge.postMessage !== "function") return null;
  let disposed = false;
  let ordinal = 0;
  const pending = new Map();

  const finish = (requestId, error, value = null) => {
    const item = pending.get(requestId);
    if (!item) return;
    pending.delete(requestId);
    windowRef.clearTimeout(item.timeout);
    if (error) item.reject(error);
    else item.resolve(value);
  };

  const onHostEvent = (event) => {
    const value = event?.detail;
    if (!value || value.type !== "page-selection.result") return;
    const item = pending.get(value.requestId);
    if (!item || item.tabId !== value.tabId) return;
    if (value.error) {
      finish(value.requestId, new Error("Selected page text is unavailable"));
      return;
    }
    try {
      const result = validateBrowserPageSelection(value.selection);
      if (result.tabId !== item.tabId) throw new TypeError("Selection tab identity mismatch");
      finish(value.requestId, null, result);
    } catch (error) {
      finish(value.requestId, error);
    }
  };
  windowRef.addEventListener(EVENT_NAME, onHostEvent);

  return assertBrowserPageSelectionPort(Object.freeze({
    schema: BROWSER_PAGE_SELECTION_PORT_SCHEMA,
    readSelection(tabId) {
      if (disposed) return Promise.reject(new Error("Page selection port is disposed"));
      if (typeof tabId !== "string" || !TAB_ID_RE.test(tabId)) {
        return Promise.reject(new TypeError("Page selection tab id is invalid"));
      }
      if (pending.size > 0) {
        return Promise.reject(new Error("A page selection request is already pending"));
      }
      const requestId = "selection-" + (++ordinal);
      return new Promise((resolve, reject) => {
        const timeout = windowRef.setTimeout(
          () => finish(requestId, new Error("Page selection request timed out")),
          CAPTURE_TIMEOUT_MS,
        );
        pending.set(requestId, { tabId, timeout, resolve, reject });
        try {
          bridge.postMessage(JSON.stringify({
            type: "page-selection.capture", requestId, tabId,
          }));
        } catch (error) {
          finish(requestId, error);
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      windowRef.removeEventListener(EVENT_NAME, onHostEvent);
      for (const requestId of [...pending.keys()]) {
        finish(requestId, new Error("Page selection port is disposed"));
      }
    },
  }));
}
