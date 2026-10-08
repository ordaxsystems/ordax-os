import { assertProfilePackCatalogPort } from "../../contracts/profile-pack-catalog.mjs";
import {
  PROFILE_TAXONOMY_VIEW_SCHEMA,
  validateProfileTaxonomy,
} from "../../contracts/profile-taxonomy.mjs";

const LANGUAGES = new Set(["ptBR", "en"]);

function compareLabels(left, right, locale) {
  const a = left.localeCompare(right, locale, { sensitivity: "base" });
  return a;
}

// Read-only navigation over the existing Profile Pack catalog. A Profile's
// manifest.category is its sole category membership. Taxonomy is ONLY the
// SSOT of labels and parent links; it never owns app/data/capability mappings.
export function createProfileTaxonomyView({
  catalogPort,
  taxonomy,
  language = "ptBR",
} = {}) {
  const catalog = assertProfilePackCatalogPort(catalogPort);
  const registry = validateProfileTaxonomy(taxonomy);
  if (!LANGUAGES.has(language)) {
    throw new TypeError("Profile taxonomy language is not supported");
  }
  const locale = language === "ptBR" ? "pt-BR" : "en";
  const definitions = new Map(registry.nodes.map((node) => [node.id, node]));
  const direct = new Map(registry.nodes.map((node) => [node.id, []]));
  const profiles = catalog.list();
  for (const profile of profiles) {
    if (!definitions.has(profile.category)) {
      // An unknown category is a publishing error, not an "Other" fallback:
      // silent reassignment could hide an entitlement or editorial mistake.
      throw new Error("Profile Pack category is missing from canonical taxonomy: " + profile.category);
    }
    direct.get(profile.category).push(Object.freeze({
      slug: profile.slug,
      version: profile.version,
      title: profile.title,
    }));
  }
  for (const group of direct.values()) {
    group.sort((a, b) => compareLabels(a.title, b.title, locale)
      || a.slug.localeCompare(b.slug, "en") || a.version - b.version);
  }
  const descendants = new Map(registry.nodes.map((node) => [node.id, []]));
  for (const node of registry.nodes) {
    if (node.parentId !== null) descendants.get(node.parentId).push(node.id);
  }
  const byId = new Map();
  const build = (id, ancestorIds) => {
    const definition = definitions.get(id);
    const children = descendants.get(id)
      .map((childId) => build(childId, [...ancestorIds, id]));
    children.sort((a, b) => compareLabels(a.label, b.label, locale)
      || a.id.localeCompare(b.id, "en"));
    const directProfiles = Object.freeze(direct.get(id));
    const profileCount = directProfiles.length
      + children.reduce((sum, node) => sum + node.profileCount, 0);
    const projection = Object.freeze({
      id,
      parentId: definition.parentId,
      label: definition.labels[language],
      ancestorIds: Object.freeze(ancestorIds),
      directProfiles,
      profileCount,
      children: Object.freeze(children),
    });
    byId.set(id, projection);
    return projection;
  };
  const roots = registry.nodes.filter((node) => node.parentId === null)
    .map((node) => build(node.id, []))
    .sort((a, b) => compareLabels(a.label, b.label, locale)
      || a.id.localeCompare(b.id, "en"));

  return Object.freeze({
    schema: PROFILE_TAXONOMY_VIEW_SCHEMA,
    revision: registry.revision,
    language,
    profileCount: profiles.length,
    roots: Object.freeze(roots),
    getCategory(categoryId) {
      if (typeof categoryId !== "string") {
        throw new TypeError("Profile category lookup requires id");
      }
      return byId.get(categoryId) ?? null;
    },
  });
}
