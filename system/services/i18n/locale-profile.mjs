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

  const parts = raw.split("-").filter(Boolean);
  if (parts.length === 0 || !/^[A-Za-z]{2,8}$/.test(parts[0])) {
    throw new TypeError(`Invalid locale id: ${raw}`);
  }

  const normalized = [parts[0].toLowerCase()];
  for (const part of parts.slice(1)) {
    if (/^[A-Za-z]{4}$/.test(part)) {
      normalized.push(part[0].toUpperCase() + part.slice(1).toLowerCase());
    } else if (/^(?:[A-Za-z]{2}|\d{3})$/.test(part)) {
      normalized.push(part.toUpperCase());
    } else if (/^[A-Za-z0-9]{1,8}$/.test(part)) {
      normalized.push(part.toLowerCase());
    } else {
      throw new TypeError(`Invalid locale subtag: ${part}`);
    }
  }
  return normalized.join("-");
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
