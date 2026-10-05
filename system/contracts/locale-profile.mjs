export const LOCALE_PROFILE_SCHEMA = "ordax.locale-profile/1";

const RTL_SCRIPTS = Object.freeze(new Set([
  "Adlm",
  "Arab",
  "Armi",
  "Avst",
  "Hebr",
  "Hatr",
  "Hung",
  "Lydi",
  "Mand",
  "Mend",
  "Narb",
  "Nkoo",
  "Phli",
  "Phlp",
  "Phnx",
  "Prti",
  "Rohg",
  "Samr",
  "Sarb",
  "Syrc",
  "Thaa",
  "Yezi",
]));

export function canonicalizeLocale(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new TypeError("Locale id must be a non-empty string");
  try {
    return Intl.getCanonicalLocales(raw)[0];
  } catch {
    throw new TypeError(`Invalid locale id: ${raw}`);
  }
}

export function createLocaleProfile(locale) {
  const id = canonicalizeLocale(locale);
  const parsed = new Intl.Locale(id);
  const maximized = parsed.maximize();
  const script = parsed.script ?? maximized.script ?? null;
  const region = parsed.region ?? maximized.region ?? null;
  const platformDirection = parsed.textInfo?.direction ?? maximized.textInfo?.direction ?? null;
  const direction = platformDirection === "rtl" || platformDirection === "ltr"
    ? platformDirection
    : script !== null && RTL_SCRIPTS.has(script) ? "rtl" : "ltr";

  return Object.freeze({
    schema: LOCALE_PROFILE_SCHEMA,
    locale: id,
    language: parsed.language,
    script,
    region,
    direction,
  });
}

export function localeDirection(locale) {
  return createLocaleProfile(locale).direction;
}

export function assertLocaleProfile(value) {
  if (!value || typeof value !== "object" || value.schema !== LOCALE_PROFILE_SCHEMA) {
    throw new TypeError("A compatible locale profile is required");
  }
  const expected = createLocaleProfile(value.locale);
  for (const field of ["language", "script", "region", "direction"]) {
    if (value[field] !== expected[field]) {
      throw new TypeError(`Locale profile ${field} mismatch for ${expected.locale}`);
    }
  }
  return value;
}
