import { defineComponentManifest } from "../contracts/component-manifest.mjs";
import { validateLocale } from "../contracts/localization-pack.mjs";

const APP_ID_RE = /^[a-z][a-z0-9-]*$/;
const PANEL_KINDS = new Set([
  "static",
  "capability",
  "capabilities",
  "connectivity",
  "preference-choice",
  "extension",
]);
const PACK_POLICIES = new Set(["bundled-only", "component-scoped"]);

function freezeCapabilities(appId, label, values) {
  if (!Array.isArray(values)) {
    throw new TypeError(`First-party app ${appId} has invalid ${label} capabilities`);
  }
  const capabilities = [...values];
  if (
    capabilities.some((capabilityId) => typeof capabilityId !== "string" || !capabilityId)
    || new Set(capabilities).size !== capabilities.length
  ) {
    throw new TypeError(`First-party app ${appId} has invalid ${label} capabilities`);
  }
  return Object.freeze(capabilities);
}

function freezeLocaleList(appId, label, values) {
  if (!Array.isArray(values)) {
    throw new TypeError(`First-party app ${appId} must declare ${label}`);
  }
  const locales = values.map(validateLocale);
  if (new Set(locales).size !== locales.length) {
    const displayLabel = label === "bundledLocales" ? "bundled locales" : "optional locales";
    throw new TypeError(`First-party app ${appId} has duplicate ${displayLabel}`);
  }
  return Object.freeze(locales);
}

function freezeLocalization(appId, localization) {
  if (!localization || typeof localization !== "object" || Array.isArray(localization)) {
    throw new TypeError(`First-party app ${appId} is missing localization metadata`);
  }
  const sourceLocale = validateLocale(localization.sourceLocale);
  const bundledLocales = freezeLocaleList(appId, "bundledLocales", localization.bundledLocales);
  if (bundledLocales.length === 0) {
    throw new TypeError(`First-party app ${appId} must declare bundledLocales`);
  }
  if (!bundledLocales.includes(sourceLocale)) {
    throw new TypeError(`First-party app ${appId} must bundle its source locale`);
  }

  const optionalLocales = freezeLocaleList(
    appId,
    "optionalLocales",
    localization.optionalLocales ?? [],
  );
  if (optionalLocales.some((locale) => bundledLocales.includes(locale))) {
    throw new TypeError(`First-party app ${appId} optional locales must not duplicate bundled locales`);
  }

  const packPolicy = localization.packPolicy ?? "component-scoped";
  if (!PACK_POLICIES.has(packPolicy)) {
    throw new TypeError(`First-party app ${appId} has unsupported localization pack policy`);
  }
  const allowAppOverride = localization.allowAppOverride ?? true;
  if (typeof allowAppOverride !== "boolean") {
    throw new TypeError(`First-party app ${appId} allowAppOverride must be boolean`);
  }
  if (packPolicy === "bundled-only" && optionalLocales.length > 0) {
    throw new TypeError(`First-party app ${appId} bundled-only localization cannot declare optional locales`);
  }

  return Object.freeze({
    sourceLocale,
    bundledLocales,
    optionalLocales,
    allowAppOverride,
    packPolicy,
  });
}

function freezeChoiceOptions(appId, panel) {
  if (!panel.preferenceId || !Array.isArray(panel.options) || panel.options.length === 0) {
    throw new TypeError(`First-party app ${appId} preference panel is invalid`);
  }
  const values = new Set();
  return Object.freeze(
    panel.options.map((option) => {
      if (!option || typeof option.value !== "string" || !option.value || !option.label) {
        throw new TypeError(`First-party app ${appId} preference option is invalid`);
      }
      if (values.has(option.value)) {
        throw new TypeError(`First-party app ${appId} preference option values must be unique`);
      }
      values.add(option.value);
      return Object.freeze({ value: option.value, label: option.label });
    })
  );
}

function freezePanel(appId, panel) {
  if (!panel || typeof panel !== "object") {
    throw new TypeError(`First-party app ${appId} has an invalid panel`);
  }
  if (!PANEL_KINDS.has(panel.kind)) {
    throw new TypeError(`First-party app ${appId} has an unsupported panel kind: ${String(panel.kind)}`);
  }
  if (!panel.label || !panel.title) {
    throw new TypeError(`First-party app ${appId} panel is missing display metadata`);
  }
  if (panel.kind === "capability" && !panel.capabilityId) {
    throw new TypeError(`First-party app ${appId} capability panel is missing capabilityId`);
  }
  if (
    panel.kind === "extension" &&
    (typeof panel.extensionId !== "string" || !APP_ID_RE.test(panel.extensionId))
  ) {
    throw new TypeError(`First-party app ${appId} extension panel is missing a valid extensionId`);
  }
  const frozen = { ...panel };
  if (panel.kind === "preference-choice") {
    frozen.options = freezeChoiceOptions(appId, panel);
  }
  return Object.freeze(frozen);
}

export function defineFirstPartyApp(spec) {
  if (!spec || typeof spec !== "object") {
    throw new TypeError("First-party app definition must be an object");
  }
  if (!APP_ID_RE.test(spec.id ?? "")) {
    throw new TypeError(`Invalid first-party app id: ${String(spec.id)}`);
  }
  if (!spec.title || !spec.description || !spec.monogram) {
    throw new TypeError(`First-party app ${spec.id} is missing display metadata`);
  }
  if (!Array.isArray(spec.requiredCapabilities) || !Array.isArray(spec.panels)) {
    throw new TypeError(`First-party app ${spec.id} has an invalid contract`);
  }
  const requiredCapabilities = freezeCapabilities(
    spec.id,
    "required",
    spec.requiredCapabilities,
  );
  const optionalCapabilities = freezeCapabilities(
    spec.id,
    "optional",
    spec.optionalCapabilities ?? [],
  );
  const localization = freezeLocalization(spec.id, spec.localization);
  const requiredSet = new Set(requiredCapabilities);
  if (optionalCapabilities.some((capabilityId) => requiredSet.has(capabilityId))) {
    throw new TypeError(
      `First-party app ${spec.id} cannot require and optionally consume the same capability`,
    );
  }
  if (!spec.component || typeof spec.component !== "object" || Array.isArray(spec.component)) {
    throw new TypeError(`First-party app ${spec.id} is missing component identity`);
  }
  const component = defineComponentManifest(spec.component);
  if (
    component.id !== spec.id
    || component.title !== spec.title
    || component.kind !== "app"
  ) {
    throw new TypeError(
      `First-party app ${spec.id} component identity must match its app owner`,
    );
  }

  return Object.freeze({
    id: spec.id,
    title: spec.title,
    description: spec.description,
    monogram: spec.monogram,
    singleton: spec.singleton !== false,
    component,
    localization,
    requiredCapabilities,
    optionalCapabilities,
    panels: Object.freeze(spec.panels.map((panel) => freezePanel(spec.id, panel))),
  });
}

export function isAppAvailable(app, capabilityIds) {
  if (!app) return false;
  const available = new Set(capabilityIds);
  return app.requiredCapabilities.every((capabilityId) => available.has(capabilityId));
}
