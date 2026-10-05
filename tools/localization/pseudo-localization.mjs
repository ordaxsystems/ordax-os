import { LOCALIZATION_SCHEMA, assertLocalizationPort } from "../../system/contracts/localization.mjs";
import { createLocaleProfile } from "../../system/contracts/locale-profile.mjs";

export const PSEUDO_LOCALES = Object.freeze({
  expanded: Object.freeze({ locale: "en-XA", direction: "ltr", minimumExpansionRatio: 0.35 }),
  rtl: Object.freeze({ locale: "ar-XB", direction: "rtl", minimumExpansionRatio: 0.35 }),
});

const ACCENTS = Object.freeze({
  A: "Å", B: "Ɓ", C: "Ç", D: "Ð", E: "Ë", F: "Ƒ", G: "Ĝ", H: "Ħ", I: "Ï",
  J: "Ĵ", K: "Ķ", L: "Ŀ", M: "Ṁ", N: "Ñ", O: "Ö", P: "Þ", Q: "Ɋ", R: "Ŕ",
  S: "Š", T: "Ŧ", U: "Ü", V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ÿ", Z: "Ž",
  a: "å", b: "ƀ", c: "ç", d: "ð", e: "ë", f: "ƒ", g: "ĝ", h: "ħ", i: "ï",
  j: "ĵ", k: "ķ", l: "ŀ", m: "ṁ", n: "ñ", o: "ö", p: "þ", q: "ɋ", r: "ŕ",
  s: "š", t: "ŧ", u: "ü", v: "ṽ", w: "ŵ", x: "ẋ", y: "ÿ", z: "ž",
});

function transformSegment(value) {
  return Array.from(value, character => ACCENTS[character] ?? character).join("");
}

function interpolate(value, variables = {}) {
  return value.replace(/{([A-Za-z][A-Za-z0-9]*)}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(variables, name)
      && variables[name] !== undefined
      && variables[name] !== null
      ? String(variables[name])
      : match
  ));
}

export function pseudoLocalizeText(value, mode = "expanded") {
  const descriptor = PSEUDO_LOCALES[mode];
  if (!descriptor) {
    throw new TypeError(`Unknown pseudo-locale mode: ${mode}`);
  }

  const input = String(value);
  const tokens = input.split(/({[A-Za-z][A-Za-z0-9]*})/g);
  let visibleLength = 0;
  const transformed = tokens.map(token => {
    if (/^{[A-Za-z][A-Za-z0-9]*}$/.test(token)) return token;
    visibleLength += token.replace(/\s+/g, "").length;
    return transformSegment(token);
  }).join("");

  const padding = "·".repeat(Math.max(2, Math.ceil(visibleLength * descriptor.minimumExpansionRatio)));
  const framed = `⟦${transformed}${padding}⟧`;
  return mode === "rtl" ? `\u2067${framed}\u2069` : framed;
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
      const sourceWithPlaceholders = base.translate(messageId);
      return interpolate(pseudoLocalizeText(sourceWithPlaceholders, mode), values);
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
