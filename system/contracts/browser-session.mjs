export const BROWSER_SESSION_SCHEMA = "ordax.browser-session/1";

export const BROWSER_UNAVAILABLE_REASONS = Object.freeze({
  HOST_UNAVAILABLE: "host-unavailable",
  WEB_EMBEDDING_DISABLED: "web-embedding-disabled",
  NATIVE_ENGINE_UNAVAILABLE: "native-engine-unavailable",
});

const TAB_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const REASON_CODE_SET = new Set(Object.values(BROWSER_UNAVAILABLE_REASONS));
const MAX_TABS = 16;

function freezeTab(tab) {
  if (!tab || typeof tab !== "object" || !TAB_ID_RE.test(tab.id ?? "")) {
    throw new TypeError("Browser tab is invalid");
  }
  for (const field of ["url", "title"]) {
    if (typeof tab[field] !== "string") throw new TypeError(`Browser tab ${field} is invalid`);
  }
  for (const field of ["loading", "canGoBack", "canGoForward"]) {
    if (typeof tab[field] !== "boolean") throw new TypeError(`Browser tab ${field} is invalid`);
  }
  return Object.freeze({
    id: tab.id,
    url: tab.url,
    title: tab.title,
    loading: tab.loading,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
  });
}

export function validateBrowserSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || typeof snapshot.supported !== "boolean") {
    throw new TypeError("Browser snapshot is invalid");
  }
  if (!Array.isArray(snapshot.tabs) || snapshot.tabs.length > MAX_TABS) {
    throw new TypeError("Browser snapshot tabs are invalid");
  }
  const tabs = snapshot.tabs.map(freezeTab);
  const ids = new Set(tabs.map((tab) => tab.id));
  if (ids.size !== tabs.length) throw new TypeError("Browser tab ids must be unique");
  if (snapshot.activeTabId !== null && !ids.has(snapshot.activeTabId)) {
    throw new TypeError("Browser active tab is invalid");
  }
  if (typeof snapshot.reason !== "string") throw new TypeError("Browser reason is invalid");
  const reasonCode = snapshot.reasonCode ?? null;
  if (reasonCode !== null && !REASON_CODE_SET.has(reasonCode)) {
    throw new TypeError("Browser reason code is invalid");
  }
  if (snapshot.supported && reasonCode !== null) {
    throw new TypeError("Supported browser snapshots cannot expose an unavailable reason code");
  }
  return Object.freeze({
    supported: snapshot.supported,
    reason: snapshot.reason,
    reasonCode,
    activeTabId: snapshot.activeTabId,
    tabs: Object.freeze(tabs),
  });
}

export function assertBrowserSessionPort(value) {
  const methods = [
    "getSnapshot",
    "subscribe",
    "subscribeShortcuts",
    "openTab",
    "closeTab",
    "activateTab",
    "navigate",
    "goBack",
    "goForward",
    "reload",
    "setViewport",
    "dispose",
  ];
  if (!value || value.schema !== BROWSER_SESSION_SCHEMA || methods.some((method) => typeof value[method] !== "function")) {
    throw new TypeError("A compatible browser session port is required");
  }
  validateBrowserSnapshot(value.getSnapshot());
  return value;
}

export function createUnavailableBrowserSession(
  reasonCode = BROWSER_UNAVAILABLE_REASONS.HOST_UNAVAILABLE,
) {
  if (!REASON_CODE_SET.has(reasonCode)) {
    throw new TypeError("Browser unavailable reason code is invalid");
  }
  const snapshot = validateBrowserSnapshot({
    supported: false,
    // Human-readable unavailable copy belongs to the localized Surface presentation.
    reason: "",
    reasonCode,
    activeTabId: null,
    tabs: [],
  });
  const noop = () => false;
  return Object.freeze({
    schema: BROWSER_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Browser listener must be a function");
      return () => {};
    },
    subscribeShortcuts(listener) {
      if (typeof listener !== "function") throw new TypeError("Browser shortcut listener must be a function");
      return () => {};
    },
    openTab: noop,
    closeTab: noop,
    activateTab: noop,
    navigate: noop,
    goBack: noop,
    goForward: noop,
    reload: noop,
    setViewport: noop,
    dispose() {},
  });
}
