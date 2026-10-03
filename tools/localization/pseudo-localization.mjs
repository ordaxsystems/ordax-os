import { LOCALIZATION_SCHEMA, assertLocalizationPort } from "../../system/contracts/localization.mjs";
import { createLocaleProfile } from "../../system/services/i18n/locale-profile.mjs";

export const PSEUDO_LOCALES = Object.freeze({
  expanded: Object.freeze({ locale: "en-XA", direction: "ltr" }),
  rtl: Object.freeze({ locale: "ar-XB", direction: "rtl" }),
});

const ACCENTS = Object.freeze({
  A: "Å", B: "Ɓ", C: "Ç", D: "Ð", E: "Ë", F: "Ƒ", G: "Ĝ", H: "Ħ", I: "Ï",
  J: "Ĵ", K: "Ķ", L: "Ŀ", M: "Ṁ", N: "Ñ", O: "Ö", P: "Þ", Q: "Ɋ", R: "Ŕ",
  S: "Š", T: "Ŧ", U: "Ü", V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ÿ", Z: "Ž",
  a: "å", b: "ƀ", c: "ç", d: "ð", e: "ë", f: "ƒ", g: "ĝ", h: "ħ", i: "ï",
  j: "ĵ", k: "ķ", l: "ŀ", m: "ṁ", n: "ñ", o: "ö", p: "þ", q: "ɋ", r: "ŕ",
  s: "š", t: "ŧ", u: "ü", v: "ṽ", w: "ŵ", x: "ẋ", y: "ÿ", z: "ž",
});

const PLACEHOLDER = /\{[A-Za-z][A-Za-z0-9]*\}/g;

function transformChunk(value) {
  let transformed = "";
  let letters = 0;
  for (const char of value) {
    if (/[A-Za-z]/.test(char)) letters += 1;
    transformed += ACCENTS[char] ?? char;
  }
  const padding = " ~".repeat(Math.max(2, Math.ceil(letters * 0.35)));
  return `${transformed}${padding}`;
}

export function pseudoLocalizeText(value, mode = "expanded") {
  if (!Object.hasOwn(PSEUDO_LOCALES, mode)) {
    throw new TypeError(`Unknown pseudo-locale mode: ${mode}`);
  }
  const input = String(value);
  let result = "";
  let cursor = 0;
  for (const match of input.matchAll(PLACEHOLDER)) {
    result += transformChunk(input.slice(cursor, match.index));
    result += match[0];
    cursor = match.index + match[0].length;
  }
  result += transformChunk(input.slice(cursor));

  if (mode === "rtl") {
    return `⟦${result}⟧`;
  }
  return `[!! ${result} !!]`;
}

export function createPseudoLocalization(baseLocalization, mode = "expanded") {
  const base = assertLocalizationPort(baseLocalization);
  const pseudo = PSEUDO_LOCALES[mode];
  if (!pseudo) throw new TypeError(`Unknown pseudo-locale mode: ${mode}`);

  const profile = createLocaleProfile(pseudo.locale);
  if (profile.direction !== pseudo.direction) {
    throw new TypeError(`Pseudo-locale direction contract mismatch for ${pseudo.locale}`);
  }

  const port = Object.freeze({
    schema: LOCALIZATION_SCHEMA,
    getLocale() {
      return profile.locale;
    },
    getProfile() {
      return profile;
    },
    translate(messageId, values = {}) {
      return pseudoLocalizeText(base.translate(messageId, values), mode);
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Localization listener must be a function");
      }
      listener(profile.locale);
      return () => {};
    },
  });

  return assertLocalizationPort(port);
}
