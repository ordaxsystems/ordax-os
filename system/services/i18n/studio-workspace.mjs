import { assertLocalizationPort } from "../../contracts/localization.mjs";
import {
  STUDIO_WORKSPACE_ENGLISH_MESSAGES,
  STUDIO_WORKSPACE_SOURCE_MESSAGES,
} from "./catalog/studio-workspace.mjs";

function catalogFor(locale) {
  return locale === "en-US"
    ? STUDIO_WORKSPACE_ENGLISH_MESSAGES
    : STUDIO_WORKSPACE_SOURCE_MESSAGES;
}

export function translateStudioWorkspaceMessage(localization, messageId) {
  const localizer = assertLocalizationPort(localization);
  const catalog = catalogFor(localizer.getLocale());
  if (!Object.hasOwn(catalog, messageId)) {
    throw new TypeError(`Unknown Studio workspace localization message: ${messageId}`);
  }
  return catalog[messageId];
}
