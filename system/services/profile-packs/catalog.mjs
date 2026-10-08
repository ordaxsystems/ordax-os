import {
  PROFILE_PACK_CATALOG_SCHEMA,
  PROFILE_PACK_CATALOG_ENTRY_SCHEMA,
  validateProfilePackCatalogEntry,
  validateProfilePackCatalogProjection,
} from "../../contracts/profile-pack-catalog.mjs";
import { assertValidatedProfilePackCatalog } from "../../contracts/profile-pack.mjs";

function identity(entry) {
  return `${entry.slug}@${entry.version}`;
}

export function createProfilePackCatalog({ rows = [] } = {}) {
  if (!Array.isArray(rows) || rows.length > 128) {
    throw new TypeError("Profile Pack catalog requires a bounded row set");
  }
  return finalizeCatalog(rows.map((row) => validateProfilePackCatalogEntry(row)));
}

// The bundled manifest loader already returns validated, immutable Packs.
// Project their public catalog fields exactly once, without fabricating a raw
// manifest, copying category memberships, or publishing draft/retired Packs.
export function createProfilePackCatalogFromPacks({ packs = [] } = {}) {
  const validated = assertValidatedProfilePackCatalog(packs);
  return finalizeCatalog(validated.filter((pack) => pack.state === "active").map((pack) =>
    validateProfilePackCatalogProjection({
      schema: PROFILE_PACK_CATALOG_ENTRY_SCHEMA,
      slug: pack.slug,
      version: pack.version,
      title: pack.title,
      category: pack.category,
      spaceKind: pack.spaceKind,
      apps: pack.apps,
      templates: pack.templates,
      intelligence: pack.intelligence,
    }),
  ));
}

function finalizeCatalog(projectedEntries) {
  const entries = [];
  const identities = new Set();
  for (const entry of projectedEntries) {
    const key = identity(entry);
    if (identities.has(key)) throw new Error(`Duplicate Profile Pack catalog entry ${key}`);
    identities.add(key);
    entries.push(entry);
  }
  entries.sort((left, right) => {
    const title = left.title.localeCompare(right.title, "en", { sensitivity: "base" });
    if (title !== 0) return title;
    const slug = left.slug.localeCompare(right.slug);
    if (slug !== 0) return slug;
    return left.version - right.version;
  });
  const frozenEntries = Object.freeze(entries);

  return Object.freeze({
    schema: PROFILE_PACK_CATALOG_SCHEMA,
    list() {
      return frozenEntries;
    },
    get(slug, version) {
      if (typeof slug !== "string" || !Number.isSafeInteger(version)) {
        throw new TypeError("Profile Pack catalog lookup requires exact slug and version");
      }
      return frozenEntries.find((entry) => entry.slug === slug && entry.version === version) ?? null;
    },
  });
}
