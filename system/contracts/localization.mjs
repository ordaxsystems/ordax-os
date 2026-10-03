export const LOCALIZATION_SCHEMA = "ordax.localization/1";

const RTL_SCRIPTS = new Set([
  "Adlm",
  "Arab",
  "Hebr",
  "Mand",
  "Nkoo",
  "Rohg",
  "Samr",
  "Syrc",
  "Thaa",
]);

// Languages whose default writing system is right-to-left when a script subtag
// is not explicit. An explicit script always wins (for example ku-Latn vs ku-Arab).
const DEFAULT_RTL_LANGUAGES = new Set([
  "ar",
  "ckb",
  "dv",
  "fa",
  "he",
  "ks",
  "nqo",
  "ps",
  "sd",
  "syr",
  "ug",
  "ur",
  "yi",
]);

function localeIdentity(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Locale must be a non-empty BCP 47-style identifier");
  }

  const subtags = value.trim().split("-");
  const language = subtags[0].toLowerCase();
  const explicitScript = subtags
    .slice(1)
    .find((subtag) => /^[A-Za-z]{4}$/.test(subtag));
  const script = explicitScript
    ? `${explicitScript[0].toUpperCase()}${explicitScript.slice(1).toLowerCase()}`
    : null;

  return Object.freeze({ language, script });
}

export function textDirectionForLocale(locale) {
  const identity = localeIdentity(locale);
  if (identity.script !== null) {
    return RTL_SCRIPTS.has(identity.script) ? "rtl" : "ltr";
  }
  return DEFAULT_RTL_LANGUAGES.has(identity.language) ? "rtl" : "ltr";
}

export function localizationDirection(port) {
  const localization = assertLocalizationPort(port);
  return textDirectionForLocale(localization.getLocale());
}

export function assertLocalizationPort(port) {
  if (!port || typeof port !== "object" || port.schema !== LOCALIZATION_SCHEMA) {
    throw new TypeError("A compatible localization port is required");
  }
  for (const method of ["getLocale", "translate", "subscribe"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Localization port must implement ${method}()`);
    }
  }
  const locale = port.getLocale();
  if (typeof locale !== "string" || !locale) {
    throw new TypeError("Localization port must expose a non-empty locale");
  }
  return port;
}
