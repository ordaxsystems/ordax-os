// Shared browser navigation policy. The native host is the final network boundary.
// This module converts user-entered text into a public URL or an explicit search.
export const BROWSER_SEARCH_PROVIDER = Object.freeze({
  id: "duckduckgo",
  origin: "https://duckduckgo.com/",
  queryParameter: "q",
});

export const MAX_BROWSER_ADDRESS_INPUT = 2048;
export const MAX_BROWSER_SEARCH_QUERY = 512;

const FORBIDDEN_CHARACTERS = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\\]/u;
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:/i;
const BARE_HOST = /^([^\s/?#@:]+(?:\.[^\s/?#@:]+)+)(?::([0-9]{1,5}))?([/?#][^\s]*)?$/u;

function browserUrl(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new TypeError("Invalid browser URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new TypeError("Browser navigation requires HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new TypeError("Browser URLs must not include credentials");
  }
  // Single-label/local names are never accepted as external navigation.
  // IP address and DNS network boundaries remain authoritative in the native host.
  if (!parsed.hostname.includes(".") && !parsed.hostname.includes(":")) {
    throw new TypeError("Browser navigation requires a public host");
  }
  return parsed.href;
}

function searchUrl(query) {
  if (!query || query.length > MAX_BROWSER_SEARCH_QUERY) {
    throw new TypeError("Browser search query is invalid");
  }
  const target = new URL(BROWSER_SEARCH_PROVIDER.origin);
  target.searchParams.set(BROWSER_SEARCH_PROVIDER.queryParameter, query);
  return target.href;
}

// Internal application targets must request a URL explicitly; they may never
// cause an implicit third-party search or silently reinterpret a rejected URI.
export function resolveBrowserNavigation(value, { allowSearch = true } = {}) {
  if (typeof value !== "string") throw new TypeError("Browser input must be text");
  const input = value.trim();
  if (!input) return null;
  if (input.length > MAX_BROWSER_ADDRESS_INPUT || FORBIDDEN_CHARACTERS.test(input)) {
    throw new TypeError("Browser input is invalid");
  }

  if (/^https?:\/\//i.test(input)) {
    if (/\s/u.test(input) || !/^https?:\/\/[^/?#\s]+/i.test(input)) {
      throw new TypeError("Browser URL is invalid");
    }
    return Object.freeze({ kind: "url", url: browserUrl(input) });
  }

  const bare = BARE_HOST.exec(input);
  if (bare) {
    const candidate = "https://" + input;
    return Object.freeze({ kind: "url", url: browserUrl(candidate) });
  }

  if (SCHEME_PREFIX.test(input) || input.startsWith("//") || !allowSearch) {
    throw new TypeError("Unsupported browser navigation target");
  }
  // Whitespace-delimited terms are a search, not a guessed hostname.
  const query = input.replace(/\s+/gu, " ");
  return Object.freeze({ kind: "search", query, url: searchUrl(query) });
}
