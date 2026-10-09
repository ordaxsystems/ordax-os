export const BROWSER_PAGE_FIND_PORT_SCHEMA = "ordax.browser-page-find-port/1";
export const MAX_BROWSER_PAGE_FIND_CHARS = 256;
const TAB_ID = /^[a-z][a-z0-9-]{0,63}$/;
const FIND_STATES = new Set(["found", "not-found"]);

export function validatePageFindQuery(value) {
  if (typeof value !== "string" || value.length > MAX_BROWSER_PAGE_FIND_CHARS ||
      /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError("Page find query is invalid");
  }
  return value;
}

export function validatePageFindTabId(value) {
  if (typeof value !== "string" || !TAB_ID.test(value)) {
    throw new TypeError("Page find tab id is invalid");
  }
  return value;
}

export function validatePageFindResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.type !== "page-find.result" || !FIND_STATES.has(value.state) ||
      Object.keys(value).sort().join(",") !== "count,query,state,tabId,type") {
    throw new TypeError("Page find result is invalid");
  }
  const tabId = validatePageFindTabId(value.tabId);
  const query = validatePageFindQuery(value.query);
  if (!query || !Number.isSafeInteger(value.count) || value.count < 0 || value.count > 1000) {
    throw new TypeError("Page find result count is invalid");
  }
  return Object.freeze({ tabId, query, state: value.state, count: value.count });
}

export function assertBrowserPageFindPort(port) {
  if (!port || port.schema !== BROWSER_PAGE_FIND_PORT_SCHEMA ||
      ["search", "next", "previous", "finish", "subscribe", "dispose"].some(
        name => typeof port[name] !== "function"
      )) {
    throw new TypeError("Compatible Browser Page Find port is required");
  }
  return port;
}
