export const LOCALIZATION_PACK_SCHEMA = "prototype-ordax.localization-pack/1";
export const COMPONENT_LOCALIZATION_SCHEMA = "prototype-ordax.component-localization/1";
export const LOCALIZATION_PACK_RELEASE_SCHEMA = "prototype-ordax.localization-pack-release/1";

const LOCALE_RE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/;
const COMPONENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const MESSAGE_ID_RE = /^[a-z][A-Za-z0-9.-]{0,159}$/;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const PACK_KINDS = new Set(["bundled", "external"]);
const PACK_POLICIES = new Set(["bundled-only", "component-scoped"]);
const TARGET_KINDS = new Set(["app", "surface", "creator", "public-site"]);
const FORBIDDEN_RELEASE_AUTHORITY_FIELDS = Object.freeze([
  "capabilities",
  "requestedCapabilities",
  "permissions",
  "entrypoint",
  "executable",
]);

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

function validateSha256(value, label) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function validateBoundedText(value, label, maxLength = 8192) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be bounded non-empty text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(`${label} must be bounded non-empty text`);
  }
  return normalized;
}

function validateLocaleList(values, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    throw new TypeError(`${label} must be ${allowEmpty ? "an array" : "a non-empty array"}`);
  }
  const locales = values.map(validateLocale);
  if (new Set(locales).size !== locales.length) {
    throw new TypeError(`${label} must contain unique locales`);
  }
  return Object.freeze([...locales]);
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

export function defineComponentLocalization(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TypeError("Component localization metadata must be an object");
  }

  const targetId = validateComponentId(spec.targetId);
  const sourceLocale = validateLocale(spec.sourceLocale);
  const bundledLocales = validateLocaleList(
    spec.bundledLocales,
    "Bundled locales",
    { allowEmpty: false },
  );
  const optionalLocales = validateLocaleList(
    spec.optionalLocales ?? [],
    "Optional locales",
  );
  if (!bundledLocales.includes(sourceLocale)) {
    throw new TypeError("Bundled locales must include the source locale");
  }
  if (optionalLocales.some((locale) => bundledLocales.includes(locale))) {
    throw new TypeError("Optional locales must not duplicate bundled locales");
  }

  const allowAppOverride = spec.allowAppOverride ?? true;
  if (typeof allowAppOverride !== "boolean") {
    throw new TypeError("allowAppOverride must be boolean");
  }
  const packPolicy = spec.packPolicy ?? "component-scoped";
  if (!PACK_POLICIES.has(packPolicy)) {
    throw new TypeError(`Unsupported localization pack policy: ${String(packPolicy)}`);
  }
  if (packPolicy === "bundled-only" && optionalLocales.length > 0) {
    throw new TypeError("Bundled-only localization cannot declare optional locales");
  }

  return Object.freeze({
    schema: COMPONENT_LOCALIZATION_SCHEMA,
    targetId,
    sourceLocale,
    bundledLocales,
    optionalLocales,
    allowAppOverride,
    packPolicy,
    selectionPolicy: "app-override-then-system-then-source",
    fallbackPolicy: "whole-catalog-no-partial-mix",
  });
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
  if (!PACK_KINDS.has(spec.kind)) {
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

export function defineLocalizationPackRelease(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TypeError("Localization pack release descriptor must be an object");
  }
  for (const field of FORBIDDEN_RELEASE_AUTHORITY_FIELDS) {
    if (field in spec) {
      throw new TypeError(`Localization pack releases cannot declare ${field}`);
    }
  }
  if (!TARGET_KINDS.has(spec.targetKind)) {
    throw new TypeError(`Unsupported localization target kind: ${String(spec.targetKind)}`);
  }
  if (!Number.isSafeInteger(spec.size) || spec.size <= 0) {
    throw new TypeError("Localization pack release size must be a positive safe integer");
  }

  return Object.freeze({
    schema: LOCALIZATION_PACK_RELEASE_SCHEMA,
    targetKind: spec.targetKind,
    targetId: validateComponentId(spec.targetId),
    componentVersion: validateVersion(spec.componentVersion, "Localization release componentVersion"),
    locale: validateLocale(spec.locale),
    packVersion: validateVersion(spec.packVersion, "Localization release packVersion"),
    messageContractSha256: validateSha256(spec.messageContractSha256, "Message contract hash"),
    contentSha256: validateSha256(spec.contentSha256, "Content hash"),
    size: spec.size,
    publisher: validateBoundedText(spec.publisher, "Localization publisher", 220),
    signature: validateBoundedText(spec.signature, "Localization release signature"),
  });
}

export function localizationPackReleaseMatchesComponent(
  release,
  componentLocalization,
  { componentVersion, messageContractSha256 },
) {
  const descriptor = defineLocalizationPackRelease(release);
  if (
    !componentLocalization
    || typeof componentLocalization !== "object"
    || Array.isArray(componentLocalization)
    || !Object.hasOwn(componentLocalization, "packPolicy")
  ) {
    throw new TypeError("Component localization packPolicy is required for release matching");
  }
  const localization = defineComponentLocalization(componentLocalization);
  const expectedVersion = validateVersion(componentVersion, "Localization componentVersion");
  const expectedMessageContract = validateSha256(messageContractSha256, "Message contract hash");
  if (localization.packPolicy !== "component-scoped") {
    return false;
  }
  return (
    descriptor.targetKind === "app"
    && descriptor.targetId === localization.targetId
    && descriptor.componentVersion === expectedVersion
    && localization.optionalLocales.includes(descriptor.locale)
    && descriptor.messageContractSha256 === expectedMessageContract
  );
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
