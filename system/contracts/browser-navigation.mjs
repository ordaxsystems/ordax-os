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

// Fast-fail obviously private/local destinations before the Surface asks the
// Native browser host to navigate. This is an early UX/security boundary; the
// Native host still owns the authoritative network policy and DNS resolution.
function rejectKnownLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/\\.$/, "").replace(/^\\[|\\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")
      || host.endsWith(".local") || host.endsWith(".home.arpa")
      || (!host.includes(".") && !host.includes(":"))) {
    throw new TypeError("Local browser hosts are not allowed");
  }
  // URL() normalizes decimal/hex/octal legacy IPv4 forms and Unicode dots.
  // Reject common non-global IPv4 ranges without doing a network request.
  if (/^(?:\\d{1,3}\\.){3}\\d{1,3}$/.test(host)) {
    const [a, b, c] = host.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2)))
        || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
        || (a === 203 && b === 0 && c === 113)) {
      throw new TypeError("Non-public browser IP addresses are not allowed");
    }
  }
  // This is a conservative early reject, not a complete IPv6 range classifier.
  if (host === "::" || host === "::1" || /^f[cd][0-9a-f]*:/i.test(host)
      || /^fe[89ab][0-9a-f]*:/i.test(host)) {
    throw new TypeError("Non-public browser IP addresses are not allowed");
  }
}

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
  // Reject obvious local/private targets early. The Native host remains the
  // mandatory final boundary for all URL forms and resolved network addresses.
  rejectKnownLocalHost(parsed.hostname);
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
