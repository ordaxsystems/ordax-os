import { validateLocale } from "./localization-pack.mjs";

export const LOCALIZATION_PACK_DELIVERY_SCHEMA = "prototype-ordax.localization-pack-delivery/1";

const COMPONENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const PACK_POLICIES = new Set(["bundled-only", "component-scoped"]);
const FORBIDDEN_AUTHORITY_FIELDS = Object.freeze([
  "capabilities",
  "requestedCapabilities",
  "permissions",
  "entrypoint",
  "executable",
]);

function boundedText(value, label, max = 256) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function componentId(value) {
  if (typeof value !== "string" || !COMPONENT_ID_RE.test(value)) {
    throw new TypeError("Localization delivery componentId is invalid");
  }
  return value;
}

function version(value, label) {
  if (typeof value !== "string" || !SEMVER_RE.test(value)) {
    throw new TypeError(`${label} must be semantic version x.y.z`);
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

export function defineLocalizationPackDelivery(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TypeError("Localization pack delivery must be an object");
  }
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    if (field in spec) {
      throw new TypeError(`Localization pack delivery cannot declare ${field}`);
    }
  }
  if (!Number.isSafeInteger(spec.size) || spec.size <= 0) {
    throw new TypeError("Localization pack delivery size must be a positive safe integer");
  }

  return Object.freeze({
    schema: LOCALIZATION_PACK_DELIVERY_SCHEMA,
    componentId: componentId(spec.componentId),
    componentVersion: version(spec.componentVersion, "Localization componentVersion"),
    packVersion: version(spec.packVersion, "Localization packVersion"),
    locale: validateLocale(spec.locale),
    messageContractSha256: sha256(spec.messageContractSha256, "Localization message contract hash"),
    contentSha256: sha256(spec.contentSha256, "Localization content hash"),
    size: spec.size,
    publisher: boundedText(spec.publisher, "Localization publisher"),
    signature: boundedText(spec.signature, "Localization signature", 8192),
  });
}

export function localizationDeliveryMatchesComponent(
  delivery,
  localization,
  { componentId: expectedComponentId, componentVersion, messageContractSha256 },
) {
  const value = defineLocalizationPackDelivery(delivery);
  if (!localization || typeof localization !== "object" || Array.isArray(localization)) {
    throw new TypeError("Component localization metadata must be an object");
  }
  const packPolicy = localization.packPolicy ?? "component-scoped";
  if (!PACK_POLICIES.has(packPolicy)) {
    throw new TypeError("Component localization packPolicy is invalid");
  }
  if (packPolicy !== "component-scoped") {
    return false;
  }
  const optionalLocales = Array.isArray(localization.optionalLocales)
    ? localization.optionalLocales.map(validateLocale)
    : [];
  const expectedHash = sha256(messageContractSha256, "Expected message contract hash");
  return (
    value.componentId === componentId(expectedComponentId)
    && value.componentVersion === version(componentVersion, "Expected componentVersion")
    && optionalLocales.includes(value.locale)
    && value.messageContractSha256 === expectedHash
  );
}
