import { validateProfileAppReferences } from "./profile-app-references.mjs";

export const PROFILE_PACK_CATALOG_SCHEMA = "ordax.profile-pack-catalog/1";
export const PROFILE_PACK_CATALOG_ENTRY_SCHEMA = "ordax.profile-pack-catalog-entry/1";
export const MAX_PROFILE_PACK_CATALOG_ENTRIES = 128;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;
const SPACE_KINDS = new Set(["personal", "work", "professional"]);

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value.includes("\0")) {
    throw new TypeError(`${label} must be bounded text`);
  }
  return value;
}

function boundedTextArray(value, label, maxItems = 32, maxChars = 160) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  return Object.freeze(value.map((entry, index) => boundedText(entry, `${label}[${index}]`, maxChars)));
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

function projectionFields({ slug, version, title, category, spaceKind, apps, templates, preferredPurpose, externalProviderRequired }) {
  return Object.freeze({
    schema: PROFILE_PACK_CATALOG_ENTRY_SCHEMA,
    slug,
    version,
    title,
    category,
    spaceKind,
    apps,
    templates,
    intelligence: Object.freeze({ preferredPurpose, externalProviderRequired }),
  });
}

export function validateProfilePackCatalogEntry(value, label = "Profile Pack catalog entry") {
  const row = objectValue(value, label);
  const slug = slugValue(row.slug, `${label} slug`);
  const version = versionValue(row.version, `${label} version`);
  if (row.state !== "active") throw new Error(`${label} must be active`);
  const title = boundedText(row.title, `${label} title`, 120);
  const category = boundedText(row.category, `${label} category`, 80);
  const manifest = objectValue(row.manifest, `${label} manifest`);
  const spaceKind = manifest.space_kind;
  if (!SPACE_KINDS.has(spaceKind)) throw new TypeError(`${label} space kind is invalid`);
  const apps = validateProfileAppReferences(manifest.apps ?? [], `${label} apps`);
  const templates = boundedTextArray(manifest.templates ?? [], `${label} templates`, 32, 120);
  const intelligence = objectValue(manifest.intelligence ?? {}, `${label} intelligence`);
  const preferredPurpose = intelligence.preferred_purpose == null
    ? null
    : boundedText(intelligence.preferred_purpose, `${label} preferred purpose`, 80);
  if (
    intelligence.external_provider_required !== undefined
    && typeof intelligence.external_provider_required !== "boolean"
  ) {
    throw new TypeError(`${label} external provider policy is invalid`);
  }

  return projectionFields({
    slug,
    version,
    title,
    category,
    spaceKind,
    apps,
    templates,
    preferredPurpose,
    externalProviderRequired: intelligence.external_provider_required === true,
  });
}

export function validateProfilePackCatalogProjection(value, label = "Profile Pack catalog projection") {
  const entry = objectValue(value, label);
  if (entry.schema !== PROFILE_PACK_CATALOG_ENTRY_SCHEMA) {
    throw new TypeError(`${label} schema is incompatible`);
  }
  const slug = slugValue(entry.slug, `${label} slug`);
  const version = versionValue(entry.version, `${label} version`);
  const title = boundedText(entry.title, `${label} title`, 120);
  const category = boundedText(entry.category, `${label} category`, 80);
  if (!SPACE_KINDS.has(entry.spaceKind)) throw new TypeError(`${label} space kind is invalid`);
  const apps = validateProfileAppReferences(entry.apps, `${label} apps`);
  const templates = boundedTextArray(entry.templates, `${label} templates`, 32, 120);
  const intelligence = objectValue(entry.intelligence, `${label} intelligence`);
  const preferredPurpose = intelligence.preferredPurpose == null
    ? null
    : boundedText(intelligence.preferredPurpose, `${label} preferred purpose`, 80);
  if (typeof intelligence.externalProviderRequired !== "boolean") {
    throw new TypeError(`${label} external provider policy is invalid`);
  }
  return projectionFields({
    slug,
    version,
    title,
    category,
    spaceKind: entry.spaceKind,
    apps,
    templates,
    preferredPurpose,
    externalProviderRequired: intelligence.externalProviderRequired,
  });
}

export function validateProfilePackCatalogList(value) {
  if (!Array.isArray(value) || value.length > MAX_PROFILE_PACK_CATALOG_ENTRIES) {
    throw new TypeError(`Profile Pack catalog must contain at most ${MAX_PROFILE_PACK_CATALOG_ENTRIES} entries`);
  }
  const entries = Object.freeze(value.map((entry, index) =>
    validateProfilePackCatalogProjection(entry, `Profile Pack catalog entry[${index}]`)));
  const identities = new Set(entries.map((entry) => `${entry.slug}@${entry.version}`));
  if (identities.size !== entries.length) throw new TypeError("Profile Pack catalog entries must be unique");
  return entries;
}

export function assertProfilePackCatalogPort(port) {
  if (!port || typeof port !== "object" || port.schema !== PROFILE_PACK_CATALOG_SCHEMA) {
    throw new TypeError("A compatible Profile Pack catalog port is required");
  }
  for (const method of ["list", "get"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Profile Pack catalog port must implement ${method}()`);
    }
  }
  validateProfilePackCatalogList(port.list());
  return port;
}
