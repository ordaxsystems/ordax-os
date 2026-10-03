import { canonicalizeLocale, describeLocale } from "./locale-profile.mjs";

export const LOCALIZATION_QA_PSEUDO_LOCALES = Object.freeze({
  "en-XA": Object.freeze({
    locale: "en-XA",
    mode: "expanded",
    minimumExpansionRatio: 0.3,
  }),
  "ar-XB": Object.freeze({
    locale: "ar-XB",
    mode: "rtl",
    minimumExpansionRatio: 0.3,
  }),
});

const ACCENTS = Object.freeze({
  A: "Å", B: "Ɓ", C: "Ç", D: "Ð", E: "Ë", F: "Ƒ", G: "Ğ", H: "Ħ", I: "Ï",
  J: "Ĵ", K: "Ķ", L: "Ŀ", M: "M", N: "Ñ", O: "Ö", P: "Þ", Q: "Q", R: "Ŕ",
  S: "Š", T: "Ţ", U: "Ü", V: "V", W: "Ŵ", X: "Ẋ", Y: "Ÿ", Z: "Ž",
  a: "å", b: "ƀ", c: "ç", d: "ð", e: "ë", f: "ƒ", g: "ğ", h: "ħ", i: "ï",
  j: "ĵ", k: "ķ", l: "ŀ", m: "m", n: "ñ", o: "ö", p: "þ", q: "q", r: "ŕ",
  s: "š", t: "ţ", u: "ü", v: "v", w: "ŵ", x: "ẋ", y: "ÿ", z: "ž",
});

const PLACEHOLDER_RE = /(\{[A-Za-z][A-Za-z0-9]*\})/g;

export function isLocalizationQaPseudoLocale(locale) {
  try {
    const canonical = canonicalizeLocale(locale);
    return Object.prototype.hasOwnProperty.call(LOCALIZATION_QA_PSEUDO_LOCALES, canonical);
  } catch {
    return false;
  }
}

function transformSegment(segment) {
  return Array.from(segment, character => ACCENTS[character] ?? character).join("");
}

export function pseudoLocalize(message, locale = "en-XA") {
  if (typeof message !== "string") {
    throw new TypeError("Pseudo-localization input must be a string");
  }
  const canonical = canonicalizeLocale(locale);
  const descriptor = LOCALIZATION_QA_PSEUDO_LOCALES[canonical];
  if (!descriptor) {
    throw new TypeError(`Unsupported localization QA pseudo-locale: ${canonical}`);
  }

  const tokens = message.split(PLACEHOLDER_RE);
  const transformed = tokens
    .map(token => /^\{[A-Za-z][A-Za-z0-9]*\}$/.test(token) ? token : transformSegment(token))
    .join("");

  const visibleLength = tokens
    .filter(token => !/^\{[A-Za-z][A-Za-z0-9]*\}$/.test(token))
    .join("")
    .replace(/\s+/g, "")
    .length;
  const paddingLength = Math.max(2, Math.ceil(visibleLength * descriptor.minimumExpansionRatio));
  const padded = `⟦${transformed}${"·".repeat(paddingLength)}⟧`;

  return describeLocale(canonical).direction === "rtl"
    ? `\u2067${padded}\u2069`
    : padded;
}
