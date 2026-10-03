export const LOCALE_PROFILE_SCHEMA = "ordax.locale-profile/1";

const RTL_SCRIPTS = Object.freeze(new Set([
  "Adlm",
  "Arab",
  "Hebr",
  "Mand",
  "Mend",
  "Nkoo",
  "Rohg",
  "Samr",
  "Syrc",
  "Thaa",
]));

const RTL_DEFAULT_LANGUAGES = Object.freeze(new Set([
  "ar",
  "dv",
  "fa",
  "he",
  "ps",
  "sd",
  "ug",
  "ur",
  "yi",
]));

function normalizeLocaleId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new TypeError("Locale id must be a non-empty string");
  try {
    return Intl.getCanonicalLocales(raw)[0];
  } catch {
    throw new TypeError(`Invalid locale id: ${raw}`);
  }
}

function explicitScript(locale) {
  return locale.split("-").find((part, index) => index > 0 && /^[A-Z][a-z]{3}$/.test(part)) ?? null;
}

export function localeDirection(locale) {
  const id = normalizeLocaleId(locale);
  const script = explicitScript(id);
  if (script) return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  const language = id.split("-", 1)[0];
  return RTL_DEFAULT_LANGUAGES.has(language) ? "rtl" : "ltr";
}

export function createLocaleProfile(locale) {
  const id = normalizeLocaleId(locale);
  return Object.freeze({
    schema: LOCALE_PROFILE_SCHEMA,
    locale: id,
    direction: localeDirection(id),
  });
}

export function assertLocaleProfile(value) {
  if (!value || typeof value !== "object" || value.schema !== LOCALE_PROFILE_SCHEMA) {
    throw new TypeError("A compatible locale profile is required");
  }
  const expected = createLocaleProfile(value.locale);
  if (value.direction !== expected.direction) {
    throw new TypeError(`Locale direction mismatch for ${expected.locale}`);
  }
  return value;
}
