export const INSTALLED_APPLICATION_SCHEMA = "ordax.installed-application/1";

const ID_RE = /^[a-z][a-z0-9-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const PLATFORM_IDS = new Set(["windows"]);
const SOURCE_KINDS = new Set(["local-file", "store", "managed"]);
const UPDATE_MODES = new Set(["vendor-managed", "ordax-managed", "manual", "unknown"]);
const RECORD_FIELDS = new Set([
  "schema",
  "id",
  "title",
  "description",
  "monogram",
  "origin",
  "launch",
  "lifecycle",
  "trust",
]);
const ORIGIN_FIELDS = new Set(["platform", "source", "payloadSha256", "publisher"]);
const LAUNCH_FIELDS = new Set(["kind", "profileId", "runtimeId", "entrypointId"]);
const LIFECYCLE_FIELDS = new Set(["installState", "uninstallable", "updateMode"]);
const TRUST_FIELDS = new Set(["nativeTrust", "runtimeGrantsTrust"]);

function assertExactFields(value, fields, label) {
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !fields.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`${label} contains incompatible fields: ${unknown.join(", ")}`);
  }
}

function boundedText(value, label, max, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function validateInstalledApplication(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Installed application must be an object");
  }
  assertExactFields(value, RECORD_FIELDS, "Installed application");
  if (value.schema !== INSTALLED_APPLICATION_SCHEMA) {
    throw new TypeError("Installed application schema is incompatible");
  }

  const id = assertId(value.id, "Installed application id");
  const title = boundedText(value.title, "Installed application title", 160);
  const description = boundedText(value.description, "Installed application description", 800, { optional: true });
  const monogram = boundedText(value.monogram, "Installed application monogram", 8);

  const origin = value.origin;
  if (!origin || typeof origin !== "object" || Array.isArray(origin)) {
    throw new TypeError("Installed application origin is invalid");
  }
  assertExactFields(origin, ORIGIN_FIELDS, "Installed application origin");
  if (!PLATFORM_IDS.has(origin.platform)) {
    throw new TypeError("Installed application platform is unsupported");
  }
  if (!SOURCE_KINDS.has(origin.source)) {
    throw new TypeError("Installed application source is invalid");
  }
  if (typeof origin.payloadSha256 !== "string" || !SHA256_RE.test(origin.payloadSha256)) {
    throw new TypeError("Installed application payload SHA-256 is invalid");
  }
  const publisher = boundedText(origin.publisher, "Installed application publisher", 240, { optional: true });

  const launch = value.launch;
  if (!launch || typeof launch !== "object" || Array.isArray(launch)) {
    throw new TypeError("Installed application launch binding is invalid");
  }
  assertExactFields(launch, LAUNCH_FIELDS, "Installed application launch binding");
  if (launch.kind !== "compatibility-profile") {
    throw new TypeError("Installed application launch kind is unsupported");
  }
  const profileId = assertId(launch.profileId, "Installed application profile id");
  const runtimeId = assertId(launch.runtimeId, "Installed application runtime id");
  const entrypointId = assertId(launch.entrypointId, "Installed application entrypoint id");

  const lifecycle = value.lifecycle;
  if (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle)) {
    throw new TypeError("Installed application lifecycle is invalid");
  }
  assertExactFields(lifecycle, LIFECYCLE_FIELDS, "Installed application lifecycle");
  if (lifecycle.installState !== "installed") {
    throw new TypeError("Only committed installed applications may enter the catalog");
  }
  if (lifecycle.uninstallable !== true) {
    throw new TypeError("Installed applications must support explicit uninstall lifecycle");
  }
  if (!UPDATE_MODES.has(lifecycle.updateMode)) {
    throw new TypeError("Installed application update mode is invalid");
  }

  const trust = value.trust;
  if (!trust || typeof trust !== "object" || Array.isArray(trust)) {
    throw new TypeError("Installed application trust metadata is invalid");
  }
  assertExactFields(trust, TRUST_FIELDS, "Installed application trust metadata");
  if (trust.nativeTrust !== false || trust.runtimeGrantsTrust !== false) {
    throw new TypeError("Foreign application or compatibility runtime cannot grant native trust");
  }

  return Object.freeze({
    schema: INSTALLED_APPLICATION_SCHEMA,
    id,
    title,
    description,
    monogram,
    origin: Object.freeze({
      platform: origin.platform,
      source: origin.source,
      payloadSha256: origin.payloadSha256,
      publisher,
    }),
    launch: Object.freeze({
      kind: "compatibility-profile",
      profileId,
      runtimeId,
      entrypointId,
    }),
    lifecycle: Object.freeze({
      installState: "installed",
      uninstallable: true,
      updateMode: lifecycle.updateMode,
    }),
    trust: Object.freeze({ nativeTrust: false, runtimeGrantsTrust: false }),
  });
}

export function toInstalledApplicationPresentation(value) {
  const app = validateInstalledApplication(value);
  return Object.freeze({
    id: app.id,
    title: app.title,
    description: app.description,
    monogram: app.monogram,
    sourceClass: "installed",
    platform: app.origin.platform,
    compatibilityManaged: true,
    detailDisclosure: "compatibility-runtime",
  });
}
