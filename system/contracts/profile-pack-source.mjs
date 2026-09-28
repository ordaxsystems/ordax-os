export const PROFILE_PACK_BUNDLED_CATALOG_SCHEMA = "ordax.profile-pack-bundled-catalog/1";
export const PROFILE_PACK_BUNDLED_SOURCE_SCHEMA = "ordax.profile-pack-bundled-source/1";
export const MAX_BUNDLED_PROFILE_PACKS = 128;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;
const MANIFEST_PATH_PATTERN = /^\/system\/profile-packs\/([a-z0-9][a-z0-9-]{1,79})\/v([1-9][0-9]*)\/manifest\.json$/;

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exactFields(value, fields, label) {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

function slugValue(value, label) {
  if (
    typeof value !== "string"
    || value.length < 2
    || value.length > 80
    || !SLUG_PATTERN.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function versionValue(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function validateBundledProfilePackCatalogIndex(value) {
  const catalog = objectValue(value, "Bundled Profile Pack catalog");
  exactFields(catalog, ["$schema", "entries"], "Bundled Profile Pack catalog");
  if (catalog.$schema !== PROFILE_PACK_BUNDLED_CATALOG_SCHEMA) {
    throw new TypeError("Bundled Profile Pack catalog schema is incompatible");
  }
  if (
    !Array.isArray(catalog.entries)
    || catalog.entries.length > MAX_BUNDLED_PROFILE_PACKS
  ) {
    throw new TypeError("Bundled Profile Pack catalog entries are outside bounds");
  }

  const identities = new Set();
  const paths = new Set();
  const entries = catalog.entries.map((value, index) => {
    const label = `Bundled Profile Pack catalog entries[${index}]`;
    const entry = objectValue(value, label);
    exactFields(entry, ["slug", "version", "manifest"], label);
    const slug = slugValue(entry.slug, `${label}.slug`);
    const version = versionValue(entry.version, `${label}.version`);
    if (typeof entry.manifest !== "string") {
      throw new TypeError(`${label}.manifest is invalid`);
    }
    const match = MANIFEST_PATH_PATTERN.exec(entry.manifest);
    if (
      match === null
      || match[1] !== slug
      || Number(match[2]) !== version
    ) {
      throw new TypeError(`${label}.manifest must match its exact Profile identity`);
    }
    const identity = `${slug}@${version}`;
    if (identities.has(identity)) {
      throw new TypeError(`Bundled Profile Pack catalog contains duplicate ${identity}`);
    }
    if (paths.has(entry.manifest)) {
      throw new TypeError("Bundled Profile Pack catalog contains duplicate manifest path");
    }
    identities.add(identity);
    paths.add(entry.manifest);
    return Object.freeze({ slug, version, manifest: entry.manifest });
  });

  return Object.freeze({
    schema: PROFILE_PACK_BUNDLED_CATALOG_SCHEMA,
    entries: Object.freeze(entries),
  });
}

export function assertBundledProfilePackPath(value, label = "Bundled Profile Pack path") {
  if (typeof value !== "string" || MANIFEST_PATH_PATTERN.exec(value) === null) {
    throw new TypeError(`${label} must remain under the versioned bundled Profile Pack root`);
  }
  return value;
}
