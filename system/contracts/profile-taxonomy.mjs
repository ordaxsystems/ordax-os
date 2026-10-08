export const PROFILE_TAXONOMY_SCHEMA = "ordax.profile-taxonomy/1";
export const PROFILE_TAXONOMY_VIEW_SCHEMA = "ordax.profile-taxonomy-view/1";
export const MAX_PROFILE_CATEGORIES = 256;

const CATEGORY_ID = /^[a-z0-9][a-z0-9-]{1,79}$/;

function strictObject(value, label, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) {
    throw new TypeError(label + " fields are invalid");
  }
  return value;
}

function categoryId(value, label) {
  if (typeof value !== "string" || !CATEGORY_ID.test(value)) {
    throw new TypeError(label + " is invalid");
  }
  return value;
}

function labelText(value, label) {
  if (typeof value !== "string" || !value.trim()
      || value.length > 100 || value.includes("\0")) {
    throw new TypeError(label + " must be bounded text");
  }
  return value.trim();
}

// The category hierarchy is an independent, versioned navigation registry.
// A Profile Pack's manifest.category remains the SSOT for its membership;
// these nodes own ONLY category names and parent-child relationships.
export function validateProfileTaxonomy(value) {
  const normalized = value?.schema === PROFILE_TAXONOMY_SCHEMA;
  const source = strictObject(
    value, "Profile taxonomy",
    [normalized ? "schema" : "$schema", "revision", "nodes"],
  );
  if ((normalized ? source.schema : source.$schema) !== PROFILE_TAXONOMY_SCHEMA) {
    throw new TypeError("Profile taxonomy schema is incompatible");
  }
  if (!Number.isSafeInteger(source.revision) || source.revision < 1) {
    throw new TypeError("Profile taxonomy revision is invalid");
  }
  if (!Array.isArray(source.nodes) || source.nodes.length > MAX_PROFILE_CATEGORIES
      || source.nodes.length === 0) {
    throw new TypeError("Profile taxonomy node count is invalid");
  }
  const ids = new Set();
  const nodes = source.nodes.map((raw) => {
    const entry = strictObject(raw, "Profile category", ["id", "parentId", "labels"]);
    const id = categoryId(entry.id, "Profile category id");
    if (ids.has(id)) throw new TypeError("Duplicate Profile category id");
    ids.add(id);
    const parentId = entry.parentId === null ? null
      : categoryId(entry.parentId, "Profile category parent id");
    if (parentId === id) throw new TypeError("Profile category cannot be its own parent");
    const labels = strictObject(entry.labels, "Profile category labels", ["ptBR", "en"]);
    return Object.freeze({
      id, parentId,
      labels: Object.freeze({
        ptBR: labelText(labels.ptBR, "Portuguese category label"),
        en: labelText(labels.en, "English category label"),
      }),
    });
  });
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  if (!nodes.some((entry) => entry.parentId === null)) {
    throw new TypeError("Profile taxonomy must contain a root");
  }
  for (const entry of nodes) {
    if (entry.parentId !== null && !byId.has(entry.parentId)) {
      throw new TypeError("Profile category parent does not exist");
    }
    const visited = new Set();
    let current = entry;
    while (current !== undefined) {
      if (visited.has(current.id)) {
        throw new TypeError("Profile category hierarchy contains a cycle");
      }
      visited.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
  }
  return Object.freeze({
    schema: PROFILE_TAXONOMY_SCHEMA,
    revision: source.revision,
    nodes: Object.freeze(nodes),
  });
}
