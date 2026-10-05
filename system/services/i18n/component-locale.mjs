import {
  defineComponentLocalization,
  validateLocale,
} from "../../contracts/localization-pack.mjs";

function lookupAvailableLocale(requestedLocale, availableLocales) {
  const requested = validateLocale(requestedLocale);
  if (availableLocales.includes(requested)) return requested;

  const language = requested.split("-")[0];
  return availableLocales.find((locale) => locale.split("-")[0] === language) ?? null;
}

export function availableComponentLocales(manifest, installedOptionalLocales = []) {
  const localization = defineComponentLocalization(manifest);
  if (!Array.isArray(installedOptionalLocales)) {
    throw new TypeError("installedOptionalLocales must be an array");
  }
  const installed = new Set(installedOptionalLocales.map(validateLocale));
  const optional = localization.optionalLocales.filter((locale) => installed.has(locale));
  return Object.freeze([...localization.bundledLocales, ...optional]);
}

export function resolveComponentLocaleSelection({
  manifest,
  systemLocale,
  appLocale = null,
  installedOptionalLocales = [],
}) {
  const localization = defineComponentLocalization(manifest);
  const availableLocales = availableComponentLocales(
    localization,
    installedOptionalLocales,
  );
  const canonicalSystemLocale = validateLocale(systemLocale);

  if (appLocale !== null && appLocale !== undefined && localization.allowAppOverride) {
    const canonicalAppLocale = validateLocale(appLocale);
    const appMatch = lookupAvailableLocale(canonicalAppLocale, availableLocales);
    if (appMatch) {
      return Object.freeze({
        locale: appMatch,
        requestedLocale: canonicalAppLocale,
        source: "app-override",
        degraded: false,
        availableLocales,
      });
    }

    const systemMatch = lookupAvailableLocale(canonicalSystemLocale, availableLocales);
    if (systemMatch) {
      return Object.freeze({
        locale: systemMatch,
        requestedLocale: canonicalAppLocale,
        source: "system-fallback-after-unavailable-app-override",
        degraded: true,
        availableLocales,
      });
    }

    return Object.freeze({
      locale: localization.sourceLocale,
      requestedLocale: canonicalAppLocale,
      source: "source-fallback-after-unavailable-app-override",
      degraded: true,
      availableLocales,
    });
  }

  const systemMatch = lookupAvailableLocale(canonicalSystemLocale, availableLocales);
  if (systemMatch) {
    return Object.freeze({
      locale: systemMatch,
      requestedLocale: canonicalSystemLocale,
      source: "system",
      degraded: false,
      availableLocales,
    });
  }

  return Object.freeze({
    locale: localization.sourceLocale,
    requestedLocale: canonicalSystemLocale,
    source: "source-fallback",
    degraded: true,
    availableLocales,
  });
}
