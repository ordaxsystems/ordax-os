import {
  BROWSER_PAGE_FIND_PORT_SCHEMA,
  assertBrowserPageFindPort,
  validatePageFindTabId,
  validatePageFindQuery,
  validatePageFindResult,
} from "../../contracts/browser-page-find.mjs";

const EVENT_NAME = "ordax-browser-host";
const HANDLER_NAME = "ordaxBrowser";

export function createNativeBrowserPageFind(windowRef = globalThis.window) {
  const bridge = windowRef?.webkit?.messageHandlers?.[HANDLER_NAME];
  if (!bridge || typeof bridge.postMessage !== "function") return null;
  const listeners = new Set();
  let disposed = false;
  const post = (type, tabId, query = null) => {
    if (disposed) return false;
    validatePageFindTabId(tabId);
    if (type === "page-find.search") validatePageFindQuery(query);
    bridge.postMessage(JSON.stringify(
      type === "page-find.search" ? { type, tabId, query } : { type, tabId }
    ));
    return true;
  };
  const onEvent = (event) => {
    if (disposed || event?.detail?.type !== "page-find.result") return;
    try {
      const result = validatePageFindResult(event.detail);
      for (const listener of [...listeners]) listener(result);
    } catch {
      // Reject forged or stale/malformed page feedback.
    }
  };
  windowRef.addEventListener(EVENT_NAME, onEvent);
  return assertBrowserPageFindPort(Object.freeze({
    schema: BROWSER_PAGE_FIND_PORT_SCHEMA,
    search: (tabId, query) => post("page-find.search", tabId, query),
    next: (tabId) => post("page-find.next", tabId),
    previous: (tabId) => post("page-find.previous", tabId),
    finish: (tabId) => post("page-find.finish", tabId),
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Find listener must be a function");
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      windowRef.removeEventListener(EVENT_NAME, onEvent);
    },
  }));
}
