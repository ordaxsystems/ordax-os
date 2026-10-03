export const LOCALIZATION_PACK_SCHEMA = "ordax.localization-pack/1";

const LOCALE_RE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/;
const COMPONENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const MESSAGE_ID_RE = /^[a-z][A-Za-z0-9.-]{0,159}$/;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function validateLocale(value) {
  if (typeof value !== "string" || !LOCALE_RE.test(value)) {
    throw new TypeError(`Invalid locale: ${String(value)}`);
  }
  return value;
}

function validateComponentId(value) {
  if (typeof value !== "string" || !COMPONENT_ID_RE.test(value)) {
    throw new TypeError(`Invalid localization component id: ${String(value)}`);
  }
  return value;
}

function validateVersion(value, label) {
  if (typeof value !== "string" || !SEMVER_RE.test(value)) {
    throw new TypeError(`${label} must be semantic version x.y.z`);
  }
  return value;
}

function validateMessageMap(messages) {
  if (!messages || typeof messages !== "object" || Array.isArray(messages)) {
    throw new TypeError("Localization pack messages must be an object");
  }
  const entries = Object.entries(messages);
  if (entries.length === 0) {
    throw new TypeError("Localization pack messages must not be empty");
  }
  for (const [messageId, value] of entries) {
    if (!MESSAGE_ID_RE.test(messageId)) {
      throw new TypeError(`Invalid localization message id: ${messageId}`);
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`Localization message ${messageId} must be non-empty text`);
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

export function defineLocalizationPack(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TypeError("Localization pack must be an object");
  }

  const componentId = validateComponentId(spec.componentId);
  const locale = validateLocale(spec.locale);
  const sourceLocale = validateLocale(spec.sourceLocale);
  const componentVersion = validateVersion(spec.componentVersion, "Localization componentVersion");
  const packVersion = validateVersion(spec.packVersion, "Localization packVersion");

  if (locale === sourceLocale && spec.kind === "external") {
    throw new TypeError("Source locale must not be installed as an external localization pack");
  }
  if (!new Set(["bundled", "external"]).has(spec.kind)) {
    throw new TypeError(`Unsupported localization pack kind: ${String(spec.kind)}`);
  }

  return Object.freeze({
    schema: LOCALIZATION_PACK_SCHEMA,
    componentId,
    componentVersion,
    packVersion,
    locale,
    sourceLocale,
    kind: spec.kind,
    messages: validateMessageMap(spec.messages),
  });
}

function placeholders(value) {
  return [...String(value).matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
    .map((match) => match[1])
    .sort();
}

export function validateLocalizationParity(sourcePack, translatedPack) {
  const source = defineLocalizationPack(sourcePack);
  const translated = defineLocalizationPack(translatedPack);

  if (source.componentId !== translated.componentId) {
    throw new TypeError("Localization packs belong to different components");
  }
  if (source.componentVersion !== translated.componentVersion) {
    throw new TypeError("Localization pack componentVersion mismatch");
  }
  if (source.sourceLocale !== translated.sourceLocale) {
    throw new TypeError("Localization pack sourceLocale mismatch");
  }

  const sourceIds = Object.keys(source.messages).sort();
  const translatedIds = Object.keys(translated.messages).sort();
  if (JSON.stringify(sourceIds) !== JSON.stringify(translatedIds)) {
    throw new TypeError("Localization message ids do not match source pack");
  }

  for (const messageId of sourceIds) {
    if (
      JSON.stringify(placeholders(source.messages[messageId]))
      !== JSON.stringify(placeholders(translated.messages[messageId]))
    ) {
      throw new TypeError(`Localization placeholders diverged for ${messageId}`);
    }
  }

  return true;
}

export function resolveComponentLocale({ requestedLocale, sourceLocale, availableLocales }) {
  const source = validateLocale(sourceLocale);
  const requested = validateLocale(requestedLocale);
  if (!Array.isArray(availableLocales) || availableLocales.length === 0) {
    throw new TypeError("availableLocales must be a non-empty array");
  }
  const available = new Set(availableLocales.map(validateLocale));
  if (!available.has(source)) {
    throw new TypeError("sourceLocale must be available");
  }
  if (available.has(requested)) return requested;

  const requestedLanguage = requested.split("-")[0];
  const languageMatch = [...available].find((locale) => locale.split("-")[0] === requestedLanguage);
  return languageMatch ?? source;
}
