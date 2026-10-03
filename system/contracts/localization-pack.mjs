export const COMPONENT_LOCALIZATION_SCHEMA = "ordax.component-localization/1";
export const LOCALIZATION_PACK_SCHEMA = "ordax.localization-pack/1";

const TARGET_KINDS = new Set(["app", "surface", "creator", "public-site"]);
const TARGET_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function text(value, label, max = 220) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

export function canonicalizeLocale(value) {
  const raw = text(value, "Locale", 48);
  try {
    const values = Intl.getCanonicalLocales(raw);
    if (values.length !== 1 || values[0].length > 48) {
      throw new TypeError("Locale must resolve to one canonical locale");
    }
    return values[0];
  } catch {
    throw new TypeError(`Invalid locale: ${raw}`);
  }
}

function localeList(values, label) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${label} must be an array`);
  }
  const result = values.map(canonicalizeLocale);
  if (new Set(result).size !== result.length) {
    throw new TypeError(`${label} must contain unique locales`);
  }
  return Object.freeze(result);
}

function targetId(value) {
  if (typeof value !== "string" || !TARGET_ID_RE.test(value)) {
    throw new TypeError("Localization target id is invalid");
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

export function defineComponentLocalization(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TypeError("Component localization definition must be an object");
  }

  const sourceLocale = canonicalizeLocale(spec.sourceLocale);
  const bundledLocales = localeList(spec.bundledLocales, "Bundled locales");
  const optionalLocales = localeList(spec.optionalLocales ?? [], "Optional locales");
  if (!bundledLocales.includes(sourceLocale)) {
    throw new TypeError("Bundled locales must include the source locale");
  }
  if (optionalLocales.some((locale) => bundledLocales.includes(locale))) {
    throw new TypeError("Optional locales must not duplicate bundled locales");
  }
  if (typeof spec.allowAppOverride !== "boolean") {
    throw new TypeError("allowAppOverride must be boolean");
  }

  return Object.freeze({
    schema: COMPONENT_LOCALIZATION_SCHEMA,
    targetId: targetId(spec.targetId),
    sourceLocale,
    bundledLocales,
    optionalLocales,
    allowAppOverride: spec.allowAppOverride,
    selectionPolicy: "inherit-system-with-explicit-app-override",
    fallbackPolicy: "locale-lookup-then-system-then-source",
    packPolicy: "signed-resource-pack",
  });
}

export function defineLocalizationPack(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TypeError("Localization pack must be an object");
  }
  for (const forbidden of ["capabilities", "requestedCapabilities", "permissions", "entrypoint", "executable"]) {
    if (forbidden in spec) {
      throw new TypeError(`Localization packs cannot declare ${forbidden}`);
    }
  }
  if (!TARGET_KINDS.has(spec.targetKind)) {
    throw new TypeError(`Unsupported localization target kind: ${String(spec.targetKind)}`);
  }
  if (typeof spec.version !== "string" || !SEMVER_RE.test(spec.version)) {
    throw new TypeError("Localization pack version must be semantic version x.y.z");
  }
  if (!Number.isInteger(spec.size) || spec.size <= 0) {
    throw new TypeError("Localization pack size must be a positive integer");
  }

  return Object.freeze({
    schema: LOCALIZATION_PACK_SCHEMA,
    targetKind: spec.targetKind,
    targetId: targetId(spec.targetId),
    locale: canonicalizeLocale(spec.locale),
    version: spec.version,
    messageContractSha256: sha256(spec.messageContractSha256, "Message contract hash"),
    contentSha256: sha256(spec.contentSha256, "Content hash"),
    size: spec.size,
    publisher: text(spec.publisher, "Localization pack publisher"),
    signature: text(spec.signature, "Localization pack signature", 8192),
  });
}

export function localizationPackMatchesComponent(pack, componentLocalization, messageContractSha256) {
  const validatedPack = defineLocalizationPack(pack);
  const localization = defineComponentLocalization(componentLocalization);
  const contractHash = sha256(messageContractSha256, "Message contract hash");
  return (
    validatedPack.targetKind === "app"
    && validatedPack.targetId === localization.targetId
    && localization.optionalLocales.includes(validatedPack.locale)
    && validatedPack.messageContractSha256 === contractHash
  );
}
