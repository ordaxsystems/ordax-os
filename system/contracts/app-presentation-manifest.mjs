import { validateComponentId, validateComponentVersion } from "./component-manifest.mjs";
import { validateLocale } from "./localization-pack.mjs";

export const APP_PRESENTATION_MANIFEST_SCHEMA = "ordax.app-presentation-manifest/1";

const MONOGRAM_RE = /^[A-Z0-9]{1,8}$/;
const MANIFEST_FIELDS = ["schema", "appId", "appVersion", "authority", "sourceLocale", "description", "monogram", "singleton", "translations"];
const TRANSLATION_FIELDS = ["title", "description"];

function assertExactFields(value, fields, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

function text(value, label, max) {
  if (typeof value !== "string" || value.length === 0 || value.length > max
      || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function validateAppPresentationManifest(value, expected = {}) {
  assertExactFields(value, MANIFEST_FIELDS, "App presentation manifest");
  if (value.schema !== APP_PRESENTATION_MANIFEST_SCHEMA) {
    throw new TypeError("App presentation schema is incompatible");
  }
  const appId = validateComponentId(value.appId);
  const appVersion = validateComponentVersion(value.appVersion);
  if (expected.appId !== undefined && expected.appId !== appId) {
    throw new TypeError("App presentation app identity drifted");
  }
  if (expected.appVersion !== undefined && expected.appVersion !== appVersion) {
    throw new TypeError("App presentation app version drifted");
  }
  if (value.authority !== "none") {
    throw new TypeError("App presentation cannot grant authority");
  }
  const sourceLocale = validateLocale(value.sourceLocale);
  const description = text(value.description, "App presentation description", 320);
  if (typeof value.monogram !== "string" || !MONOGRAM_RE.test(value.monogram)) {
    throw new TypeError("App presentation monogram is invalid");
  }
  if (typeof value.singleton !== "boolean") {
    throw new TypeError("App presentation singleton is invalid");
  }
  if (!value.translations || Object.getPrototypeOf(value.translations) !== Object.prototype
      || Object.keys(value.translations).length > 40) {
    throw new TypeError("App presentation translations are invalid");
  }
  const translations = Object.create(null);
  for (const [locale, copy] of Object.entries(value.translations)) {
    validateLocale(locale);
    if (locale === sourceLocale) {
      throw new TypeError("App presentation translation locale is invalid");
    }
    assertExactFields(copy, TRANSLATION_FIELDS, "App presentation translation");
    translations[locale] = Object.freeze({
      title: text(copy.title, "App presentation translated title", 160),
      description: text(copy.description, "App presentation translated description", 320),
    });
  }
  return Object.freeze({
    schema: APP_PRESENTATION_MANIFEST_SCHEMA,
    appId,
    appVersion,
    authority: "none",
    sourceLocale,
    description,
    monogram: value.monogram,
    singleton: value.singleton,
    translations: Object.freeze(translations),
  });
}
