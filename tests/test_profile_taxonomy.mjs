import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PROFILE_TAXONOMY_SCHEMA,
  PROFILE_TAXONOMY_VIEW_SCHEMA,
  validateProfileTaxonomy,
} from "../system/contracts/profile-taxonomy.mjs";
import { createProfilePackCatalog } from "../system/services/profile-packs/catalog.mjs";
import { createProfileTaxonomyView } from "../system/services/profile-packs/taxonomy.mjs";
import {
  DEFAULT_PROFILE_TAXONOMY_PATH,
  loadBundledProfileTaxonomy,
} from "../system/services/profile-packs/taxonomy-source.mjs";

const taxonomy = JSON.parse(readFileSync(new URL(
  "../system/profile-packs/taxonomy.json", import.meta.url,
), "utf8"));

const fixture = (slug, title, category, apps = ["files", "notes"]) => ({
  slug, version: 1, title, category, state: "active",
  manifest: {
    space_kind: "professional",
    apps,
    templates: ["operacao"],
    intelligence: {
      preferred_purpose: "work",
      external_provider_required: false,
    },
  },
});

const rows = [
  fixture("pizzaria-br", "Pizzaria", "business-food-service", ["files", "notes", "internet"]),
  fixture("impressao-3d-br", "Impressão 3D", "digital-fabrication", ["files", "notes", "internet"]),
  fixture("developer", "Desenvolvimento", "development", ["projects", "notes"]),
  fixture("legal-br", "Advocacia", "legal", ["files", "notes"]),
];

test("the manifest remains the sole owner of category membership and apps", () => {
  const catalog = createProfilePackCatalog({ rows });
  const view = createProfileTaxonomyView({ catalogPort: catalog, taxonomy });
  assert.equal(view.schema, PROFILE_TAXONOMY_VIEW_SCHEMA);
  assert.equal(view.profileCount, 4);
  assert.equal(view.roots.length, 3);
  const business = view.getCategory("business");
  assert.equal(business.label, "Empresas e negócios");
  assert.equal(business.profileCount, 2);
  assert.equal(view.getCategory("business-food").profileCount, 1);
  assert.deepEqual(
    view.getCategory("business-food-service").directProfiles.map((p) => p.slug),
    ["pizzaria-br"],
  );
  assert.deepEqual(
    view.getCategory("digital-fabrication").ancestorIds,
    ["business", "business-production"],
  );
  assert.deepEqual(
    view.getCategory("digital-fabrication").directProfiles.map((p) => p.slug),
    ["impressao-3d-br"],
  );
  assert.deepEqual(
    view.getCategory("development").directProfiles.map((p) => p.slug),
    ["developer"],
  );
  assert.deepEqual(
    view.getCategory("legal").directProfiles.map((p) => p.slug),
    ["legal-br"],
  );
  const pizzaria = catalog.get("pizzaria-br", 1);
  const printing = catalog.get("impressao-3d-br", 1);
  assert.deepEqual(pizzaria.apps, printing.apps);
  assert.equal(view.getCategory("business").directProfiles.length, 0);
  assert.equal("apps" in view.getCategory("business-food-service"), false);
  assert.equal("apps" in view.getCategory("business-food-service").directProfiles[0], false);
  assert.equal("permissions" in view.getCategory("business"), false);
  assert.equal("manifest" in view.getCategory("business"), false);
  assert.ok(Object.isFrozen(view.roots));
  assert.ok(Object.isFrozen(view.getCategory("business").children));
  assert.ok(Object.isFrozen(view.getCategory("business-food-service").directProfiles));
});

test("taxonomy navigation works in English without modifying profile identities", () => {
  const catalog = createProfilePackCatalog({ rows });
  const view = createProfileTaxonomyView({ catalogPort: catalog, taxonomy, language: "en" });
  assert.equal(view.getCategory("business").label, "Businesses");
  assert.equal(view.getCategory("digital-fabrication").label, "Digital fabrication and 3D printing");
  assert.deepEqual(view.getCategory("business-food-service").directProfiles,
    [{ slug: "pizzaria-br", version: 1, title: "Pizzaria" }]);
  assert.throws(() => createProfileTaxonomyView({
    catalogPort: catalog, taxonomy, language: "fake",
  }), /language is not supported/);
});

test("the taxonomy references all current bundled profile categories exactly", () => {
  const registry = validateProfileTaxonomy(taxonomy);
  assert.equal(registry.schema, PROFILE_TAXONOMY_SCHEMA);
  const ids = new Set(registry.nodes.map((node) => node.id));
  for (const path of [
    "../system/profile-packs/pizzaria-br/v1/manifest.json",
    "../system/profile-packs/impressao-3d-br/v1/manifest.json",
    "../system/profile-packs/developer/v1/manifest.json",
    "../system/profile-packs/legal-br/v1/manifest.json",
  ]) {
    const manifest = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
    assert.ok(ids.has(manifest.category), manifest.category + " is not classified");
  }
});

test("unknown category is a fail-closed publishing error, not a default bucket", () => {
  const catalog = createProfilePackCatalog({ rows: [
    fixture("unknown-niche", "Unmapped", "unregistered-sector"),
  ] });
  assert.throws(
    () => createProfileTaxonomyView({ catalogPort: catalog, taxonomy }),
    /missing from canonical taxonomy/,
  );
});

test("invalid graph, duplicate ids, missing parent and cycles fail validation", () => {
  const bad = (edit) => {
    const clone = structuredClone(taxonomy);
    edit(clone);
    return clone;
  };
  assert.throws(() => validateProfileTaxonomy(bad((v) => {
    v.nodes.push(structuredClone(v.nodes[0]));
  })), /Duplicate Profile category id/);
  assert.throws(() => validateProfileTaxonomy(bad((v) => {
    v.nodes[1].parentId = "no-such-category";
  })), /parent does not exist/);
  assert.throws(() => validateProfileTaxonomy(bad((v) => {
    v.nodes[0].parentId = "business-food";
  })), /cycle/);
  assert.throws(() => validateProfileTaxonomy(bad((v) => {
    v.nodes[0].extraAuthority = true;
  })), /fields are invalid/);
  assert.throws(() => validateProfileTaxonomy(bad((v) => {
    v.nodes[0].labels.en = "";
  })), /bounded text/);
  assert.throws(() => validateProfileTaxonomy(bad((v) => {
    v.nodes[0].id = "../business";
  })), /id is invalid/);
});

test("bundled taxonomy source accepts only canonical same-origin immutable metadata", async () => {
  const seen = [];
  const loaded = await loadBundledProfileTaxonomy({
    fetchImpl: async (path, options) => {
      seen.push({ path, options });
      return { ok: true, redirected: false, async json() { return taxonomy; } };
    },
  });
  assert.equal(loaded.schema, PROFILE_TAXONOMY_SCHEMA);
  const fromLoader = createProfileTaxonomyView({
    catalogPort: createProfilePackCatalog({ rows }), taxonomy: loaded,
  });
  assert.equal(fromLoader.getCategory("business").profileCount, 2);
  assert.equal(fromLoader.getCategory("business-food-service").directProfiles[0].slug, "pizzaria-br");
  assert.deepEqual(seen[0], {
    path: DEFAULT_PROFILE_TAXONOMY_PATH,
    options: { method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error" },
  });
  await assert.rejects(loadBundledProfileTaxonomy({
    taxonomyPath: "https://untrusted.example/taxonomy.json",
  }), /canonical bundled path/);
  await assert.rejects(loadBundledProfileTaxonomy({
    fetchImpl: async () => ({ ok: true, redirected: true }),
  }), /unavailable/);
  await assert.rejects(loadBundledProfileTaxonomy({
    fetchImpl: async () => ({ ok: true, redirected: false, async json() { return {}; } }),
  }), /fields are invalid/);
});
