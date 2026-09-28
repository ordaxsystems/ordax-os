export const PROFILE_DISTRIBUTION_SCHEMA = "ordax.profile-distribution/1";
export const PROFILE_PROVISIONING_SCHEMA = "ordax.profile-provisioning/1";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;
const COMPONENT_ID_PATTERN = /^[a-z][a-z0-9._-]{1,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DELIVERY_MODES = new Set(["bundled", "on-demand"]);
const COMPONENT_KINDS = new Set([
  "app",
  "knowledge-pack",
  "skill-pack",
  "model-pack",
  "connector",
]);
const AVAILABILITY = new Set(["available", "planned"]);

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function boundedText(value, label, max = 240) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value.includes("\0")) {
    throw new TypeError(`${label} must be bounded text`);
  }
  return value;
}

function slugValue(value, label) {
  const slug = boundedText(value, label, 80);
  if (!SLUG_PATTERN.test(slug)) throw new TypeError(`${label} is invalid`);
  return slug;
}

function versionValue(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} is invalid`);
  return value;
}

function componentValue(value, label) {
  const component = objectValue(value, label);
  const id = boundedText(component.id, `${label}.id`, 128);
  if (!COMPONENT_ID_PATTERN.test(id)) throw new TypeError(`${label}.id is invalid`);
  if (!COMPONENT_KINDS.has(component.kind)) throw new TypeError(`${label}.kind is invalid`);
  if (!AVAILABILITY.has(component.availability)) {
    throw new TypeError(`${label}.availability is invalid`);
  }
  if (typeof component.required !== "boolean") {
    throw new TypeError(`${label}.required must be boolean`);
  }
  const signatureRequired = component.signature_required ?? component.signatureRequired;
  if (typeof signatureRequired !== "boolean") {
    throw new TypeError(`${label}.signature_required must be boolean`);
  }
  const sha256 = component.sha256 == null ? null : boundedText(component.sha256, `${label}.sha256`, 64);
  if (sha256 !== null && !SHA256_PATTERN.test(sha256)) {
    throw new TypeError(`${label}.sha256 is invalid`);
  }
  const rawSizeBytes = component.size_bytes ?? component.sizeBytes;
  const sizeBytes = rawSizeBytes == null ? null : rawSizeBytes;
  if (sizeBytes !== null && (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)) {
    throw new TypeError(`${label}.size_bytes is invalid`);
  }
  if (component.availability === "available") {
    if (sha256 === null) throw new TypeError(`${label} available artifact requires sha256`);
    if (!signatureRequired) {
      throw new TypeError(`${label} available artifact must require signature`);
    }
  }
  if (component.availability === "planned" && sha256 !== null) {
    throw new TypeError(`${label} planned artifact cannot claim a publish hash`);
  }
  return Object.freeze({
    id,
    kind: component.kind,
    required: component.required,
    availability: component.availability,
    sha256,
    sizeBytes,
    signatureRequired: signatureRequired,
  });
}

export function validateProfileDistribution(value, label = "Profile distribution") {
  const distribution = objectValue(value, label);
  const schema = distribution.$schema ?? distribution.schema;
  if (schema !== PROFILE_DISTRIBUTION_SCHEMA) {
    throw new TypeError(`${label} schema is incompatible`);
  }
  const profile = objectValue(distribution.profile, `${label}.profile`);
  const slug = slugValue(profile.slug, `${label}.profile.slug`);
  const version = versionValue(profile.version, `${label}.profile.version`);
  const deliveryMode = distribution.delivery_mode ?? distribution.deliveryMode;
  const metadataBundled = distribution.metadata_bundled ?? distribution.metadataBundled;
  const offlineAfterInstall = distribution.offline_after_install ?? distribution.offlineAfterInstall;
  const publicInstallEnabled = distribution.public_install_enabled ?? distribution.publicInstallEnabled;
  if (!DELIVERY_MODES.has(deliveryMode)) {
    throw new TypeError(`${label}.delivery_mode is invalid`);
  }
  if (typeof metadataBundled !== "boolean") {
    throw new TypeError(`${label}.metadata_bundled must be boolean`);
  }
  if (typeof offlineAfterInstall !== "boolean") {
    throw new TypeError(`${label}.offline_after_install must be boolean`);
  }
  if (typeof publicInstallEnabled !== "boolean") {
    throw new TypeError(`${label}.public_install_enabled must be boolean`);
  }
  const rawBlockedReason = distribution.blocked_reason ?? distribution.blockedReason;
  const blockedReason = rawBlockedReason == null
    ? null
    : boundedText(rawBlockedReason, `${label}.blocked_reason`, 320);
  if (!publicInstallEnabled && blockedReason === null) {
    throw new TypeError(`${label} blocked distribution requires reason`);
  }
  if (publicInstallEnabled && blockedReason !== null) {
    throw new TypeError(`${label} enabled distribution cannot carry blocked reason`);
  }
  if (!Array.isArray(distribution.components) || distribution.components.length > 64) {
    throw new TypeError(`${label}.components must be a bounded array`);
  }
  const components = distribution.components.map((entry, index) =>
    componentValue(entry, `${label}.components[${index}]`));
  const ids = new Set(components.map((entry) => entry.id));
  if (ids.size !== components.length) {
    throw new TypeError(`${label}.components contains duplicate ids`);
  }
  return Object.freeze({
    schema: PROFILE_DISTRIBUTION_SCHEMA,
    profile: Object.freeze({ slug, version }),
    deliveryMode,
    metadataBundled,
    offlineAfterInstall,
    publicInstallEnabled,
    blockedReason,
    components: Object.freeze(components),
  });
}

export function planProfileProvisioning({
  distribution,
  installedComponentIds = [],
  networkAvailable = false,
} = {}) {
  const value = validateProfileDistribution(distribution);
  if (!Array.isArray(installedComponentIds) || installedComponentIds.length > 256) {
    throw new TypeError("installedComponentIds must be a bounded array");
  }
  const installed = new Set(installedComponentIds.map((id, index) => {
    const value = boundedText(id, `installedComponentIds[${index}]`, 128);
    if (!COMPONENT_ID_PATTERN.test(value)) {
      throw new TypeError(`installedComponentIds[${index}] is invalid`);
    }
    return value;
  }));

  const missing = value.components.filter((component) => !installed.has(component.id));
  const plannedMissing = missing.filter((component) => component.availability === "planned");
  const downloadableMissing = missing.filter((component) => component.availability === "available");
  const requiredDownloadBytes = downloadableMissing.reduce(
    (total, component) => total + (component.sizeBytes ?? 0),
    0,
  );

  let state = "ready";
  let reason = null;
  if (!value.publicInstallEnabled) {
    state = "blocked";
    reason = value.blockedReason;
  } else if (plannedMissing.some((component) => component.required)) {
    state = "blocked";
    reason = "required-profile-components-not-published";
  } else if (downloadableMissing.length > 0 && !networkAvailable) {
    state = "network-required";
    reason = "missing-components-require-network";
  } else if (missing.length === 0) {
    state = "already-provisioned";
  }

  return Object.freeze({
    schema: PROFILE_PROVISIONING_SCHEMA,
    profile: value.profile,
    state,
    reason,
    metadataBundled: value.metadataBundled,
    deliveryMode: value.deliveryMode,
    offlineAfterInstall: value.offlineAfterInstall,
    missing: Object.freeze(missing),
    alreadyInstalled: Object.freeze(
      value.components.filter((component) => installed.has(component.id)),
    ),
    requiredDownloadBytes,
    mayDownload: state === "ready" && downloadableMissing.length > 0,
    mayActivate:
      (state === "ready" || state === "already-provisioned")
      && plannedMissing.every((component) => !component.required),
  });
}


export function assertProfileProvisioningPort(port) {
  if (!port || typeof port !== "object" || port.schema !== PROFILE_PROVISIONING_SCHEMA) {
    throw new TypeError("A compatible Profile provisioning port is required");
  }
  for (const method of ["list", "get", "refresh", "dispose"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Profile provisioning port must implement ${method}()`);
    }
  }
  return port;
}
