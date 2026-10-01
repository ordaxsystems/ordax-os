export const NETWORK_MESSAGE_CONTENT_SCHEMA =
  "prototype-ordax.network-message-content/1";

export const NETWORK_MESSAGE_MAX_CHARACTERS = 4000;

const UNSAFE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const HTTP_CANDIDATE = /https?:\/\/[^\s<>"'`]+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:]+$/u;

function codePointLength(value) {
  return Array.from(value).length;
}

export function assertNetworkMessagePlainText(value) {
  if (typeof value !== "string") {
    throw new TypeError("Network message body must be text");
  }
  if (codePointLength(value) < 1 || codePointLength(value) > NETWORK_MESSAGE_MAX_CHARACTERS) {
    throw new TypeError("Network message body is outside the accepted bounds");
  }
  if (UNSAFE_CONTROL.test(value)) {
    throw new TypeError("Network message body contains an unsafe control character");
  }
  return value;
}

function safeHttpUrl(candidate) {
  if (candidate.length > 2048) return null;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname || parsed.username || parsed.password) return null;
  return parsed.href;
}

export function segmentNetworkMessagePlainText(value) {
  const text = assertNetworkMessagePlainText(value);
  const segments = [];
  let cursor = 0;

  for (const match of text.matchAll(HTTP_CANDIDATE)) {
    const index = match.index ?? 0;
    const raw = match[0];
    const label = raw.replace(TRAILING_PUNCTUATION, "");
    const trailing = raw.slice(label.length);
    const href = safeHttpUrl(label);

    if (!href) continue;

    if (index > cursor) {
      segments.push(Object.freeze({ type: "text", text: text.slice(cursor, index) }));
    }
    segments.push(Object.freeze({ type: "link", text: label, href }));
    if (trailing) {
      segments.push(Object.freeze({ type: "text", text: trailing }));
    }
    cursor = index + raw.length;
  }

  if (cursor < text.length) {
    segments.push(Object.freeze({ type: "text", text: text.slice(cursor) }));
  }
  if (segments.length === 0) {
    segments.push(Object.freeze({ type: "text", text }));
  }

  return Object.freeze(segments);
}
