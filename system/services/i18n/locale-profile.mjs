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

export function canonicalizeLocale(locale) {
  if (typeof locale !== "string" || locale.trim() === "") {
    throw new TypeError("Locale must be a non-empty BCP 47 language tag");
  }
  try {
    return Intl.getCanonicalLocales(locale.trim())[0];
  } catch {
    throw new TypeError(`Invalid BCP 47 locale: ${String(locale)}`);
  }
}

export function describeLocale(locale) {
  const canonical = canonicalizeLocale(locale);
  const parsed = new Intl.Locale(canonical);
  const maximized = parsed.maximize();
  const script = parsed.script ?? maximized.script ?? null;
  const intlDirection = parsed.textInfo?.direction ?? maximized.textInfo?.direction ?? null;
  const direction = intlDirection === "rtl" || intlDirection === "ltr"
    ? intlDirection
    : script !== null && RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  return Object.freeze({
    locale: canonical,
    language: parsed.language,
    script,
    region: parsed.region ?? null,
    direction,
  });
}
