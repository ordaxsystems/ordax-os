import { assertLocalizationPort } from "../../contracts/localization.mjs";

export function syncDocumentLocaleProfile(documentElement, localization) {
  if (!documentElement || typeof documentElement !== "object") {
    throw new TypeError("A document element is required");
  }
  const localizer = assertLocalizationPort(localization);
  const profile = localizer.getProfile();
  documentElement.lang = profile.locale;
  documentElement.dir = profile.direction;
  return profile;
}
