import {
  canonicalizeLocale,
  defineComponentLocalization,
} from "../../contracts/localization-pack.mjs";

function localeLookup(requestedLocale, availableLocales) {
  if (!requestedLocale) return null;
  const requested = canonicalizeLocale(requestedLocale);
  const available = new Set(availableLocales.map(canonicalizeLocale));
  let candidate = requested;
  while (candidate) {
    if (available.has(candidate)) return candidate;
    const boundary = candidate.lastIndexOf("-");
    if (boundary < 0) break;
    candidate = candidate.slice(0, boundary);
  }
  return null;
}

export function availableComponentLocales(manifest, installedOptionalLocales = []) {
  const localization = defineComponentLocalization(manifest);
  const installed = new Set(installedOptionalLocales.map(canonicalizeLocale));
  const optional = localization.optionalLocales.filter((locale) => installed.has(locale));
  return Object.freeze([...localization.bundledLocales, ...optional]);
}

export function resolveComponentLocale({
  manifest,
  systemLocale,
  appLocale = null,
  installedOptionalLocales = [],
}) {
  const localization = defineComponentLocalization(manifest);
  const availableLocales = availableComponentLocales(localization, installedOptionalLocales);
  const canonicalSystemLocale = canonicalizeLocale(systemLocale);

  if (appLocale && localization.allowAppOverride) {
    const canonicalAppLocale = canonicalizeLocale(appLocale);
    const appMatch = localeLookup(canonicalAppLocale, availableLocales);
    if (appMatch) {
      return Object.freeze({
        locale: appMatch,
        requestedLocale: canonicalAppLocale,
        source: "app-override",
        degraded: false,
        availableLocales,
      });
    }

    const systemMatch = localeLookup(canonicalSystemLocale, availableLocales);
    if (systemMatch) {
      return Object.freeze({
        locale: systemMatch,
        requestedLocale: canonicalAppLocale,
        source: "system-fallback-after-unavailable-app-override",
        degraded: true,
        availableLocales,
      });
    }
  }

  const systemMatch = localeLookup(canonicalSystemLocale, availableLocales);
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
