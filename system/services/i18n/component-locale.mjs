import { validateLocale } from "../../contracts/localization-pack.mjs";

function normalizeLocalization(localization) {
  if (!localization || typeof localization !== "object" || Array.isArray(localization)) {
    throw new TypeError("Component localization metadata must be an object");
  }
  const sourceLocale = validateLocale(localization.sourceLocale);
  if (!Array.isArray(localization.bundledLocales) || localization.bundledLocales.length === 0) {
    throw new TypeError("Component localization must declare bundledLocales");
  }
  const bundledLocales = localization.bundledLocales.map(validateLocale);
  const optionalLocales = (localization.optionalLocales ?? []).map(validateLocale);
  if (new Set(bundledLocales).size !== bundledLocales.length) {
    throw new TypeError("Component bundledLocales must be unique");
  }
  if (new Set(optionalLocales).size !== optionalLocales.length) {
    throw new TypeError("Component optionalLocales must be unique");
  }
  if (!bundledLocales.includes(sourceLocale)) {
    throw new TypeError("Component bundledLocales must contain sourceLocale");
  }
  if (optionalLocales.some((locale) => bundledLocales.includes(locale))) {
    throw new TypeError("Component optionalLocales must not duplicate bundledLocales");
  }
  const allowAppOverride = localization.allowAppOverride ?? true;
  if (typeof allowAppOverride !== "boolean") {
    throw new TypeError("Component allowAppOverride must be boolean");
  }
  return Object.freeze({
    sourceLocale,
    bundledLocales: Object.freeze([...bundledLocales]),
    optionalLocales: Object.freeze([...optionalLocales]),
    allowAppOverride,
  });
}

export function availableComponentLocales(localization, installedOptionalLocales = []) {
  const manifest = normalizeLocalization(localization);
  if (!Array.isArray(installedOptionalLocales)) {
    throw new TypeError("installedOptionalLocales must be an array");
  }
  const installed = new Set(installedOptionalLocales.map(validateLocale));
  const activeOptionalLocales = manifest.optionalLocales.filter((locale) => installed.has(locale));
  return Object.freeze([...manifest.bundledLocales, ...activeOptionalLocales]);
}

function findCompatibleLocale(requestedLocale, availableLocales) {
  const requested = validateLocale(requestedLocale);
  if (availableLocales.includes(requested)) {
    return requested;
  }
  const requestedLanguage = requested.split("-")[0];
  return availableLocales.find((locale) => locale.split("-")[0] === requestedLanguage) ?? null;
}

export function resolveComponentLocale({
  localization,
  systemLocale,
  appLocale = null,
  installedOptionalLocales = [],
}) {
  const manifest = normalizeLocalization(localization);
  const availableLocales = availableComponentLocales(manifest, installedOptionalLocales);
  const normalizedSystemLocale = validateLocale(systemLocale);

  if (appLocale !== null && manifest.allowAppOverride) {
    const normalizedAppLocale = validateLocale(appLocale);
    const appMatch = findCompatibleLocale(normalizedAppLocale, availableLocales);
    if (appMatch !== null) {
      return Object.freeze({
        locale: appMatch,
        requestedLocale: normalizedAppLocale,
        source: "app-override",
        degraded: appMatch !== normalizedAppLocale,
        availableLocales,
      });
    }

    const systemMatch = findCompatibleLocale(normalizedSystemLocale, availableLocales);
    if (systemMatch !== null) {
      return Object.freeze({
        locale: systemMatch,
        requestedLocale: normalizedAppLocale,
        source: "system-fallback-after-unavailable-app-override",
        degraded: true,
        availableLocales,
      });
    }

    return Object.freeze({
      locale: manifest.sourceLocale,
      requestedLocale: normalizedAppLocale,
      source: "source-fallback",
      degraded: true,
      availableLocales,
    });
  }

  const systemMatch = findCompatibleLocale(normalizedSystemLocale, availableLocales);
  if (systemMatch !== null) {
    return Object.freeze({
      locale: systemMatch,
      requestedLocale: normalizedSystemLocale,
      source: "system",
      degraded: systemMatch !== normalizedSystemLocale,
      availableLocales,
    });
  }

  return Object.freeze({
    locale: manifest.sourceLocale,
    requestedLocale: normalizedSystemLocale,
    source: "source-fallback",
    degraded: true,
    availableLocales,
  });
}
