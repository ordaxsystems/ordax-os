import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateProfilePack } from "../system/contracts/profile-pack.mjs";
import { createProfileTaxonomyView } from "../system/services/profile-packs/taxonomy.mjs";
import { validateProfileTaxonomy } from "../system/contracts/profile-taxonomy.mjs";

import {
  assertProfilePackCatalogPort,
  validateProfilePackCatalogProjection,
} from "../system/contracts/profile-pack-catalog.mjs";
import {
  createProfilePackCatalog,
  createProfilePackCatalogFromPacks,
} from "../system/services/profile-packs/catalog.mjs";

const active = {
  slug: "developer",
  version: 1,
  state: "active",
  title: "Developer",
  category: "development",
  manifest: {
    space_kind: "professional",
    apps: ["projects", "notes"],
    templates: ["repo-review"],
    intelligence: {
      preferred_purpose: "code",
      external_provider_required: false,
    },
  },
  knowledge_policy: {},
  backend_only_secret: "must-not-leak",
};

{
  const catalog = createProfilePackCatalog({
    rows: [
      { ...active, slug: "creator", title: "Creator", version: 2 },
      active,
    ],
  });
  assert.equal(assertProfilePackCatalogPort(catalog), catalog);
  assert.equal(catalog.schema, "ordax.profile-pack-catalog/1");
  assert.deepEqual(catalog.list().map((entry) => entry.slug), ["creator", "developer"]);
  const developer = catalog.get("developer", 1);
  assert.equal(developer.schema, "ordax.profile-pack-catalog-entry/1");
  assert.equal(developer.spaceKind, "professional");
  assert.deepEqual(developer.apps, ["projects", "notes"]);
  assert.equal(developer.intelligence.preferredPurpose, "code");
  assert.equal(developer.intelligence.externalProviderRequired, false);
  assert.equal("manifest" in developer, false);
  assert.equal("knowledge_policy" in developer, false);
  assert.equal("backend_only_secret" in developer, false);
  assert.equal(catalog.get("developer", 99), null);
  assert.throws(() => developer.apps.push("system"), TypeError);
  assert.deepEqual(validateProfilePackCatalogProjection(developer), developer);
}

for (const state of ["draft", "retired"]) {
  assert.throws(
    () => createProfilePackCatalog({ rows: [{ ...active, state }] }),
    /must be active/,
  );
}

assert.throws(
  () => createProfilePackCatalog({ rows: [active, structuredClone(active)] }),
  /Duplicate Profile Pack catalog entry/,
);

{
  const unsafe = structuredClone(active);
  unsafe.manifest.intelligence.external_provider_required = "yes";
  assert.throws(
    () => createProfilePackCatalog({ rows: [unsafe] }),
    /external provider policy is invalid/,
  );
}

assert.throws(
  () => assertProfilePackCatalogPort({ schema: "ordax.profile-pack-catalog/1", list() { return []; } }),
  /must implement get/,
);
assert.throws(
  () => assertProfilePackCatalogPort({
    schema: "ordax.profile-pack-catalog/1",
    list() {
      return [{
        schema: "ordax.profile-pack-catalog-entry/1",
        slug: "developer",
        version: 1,
        title: "Developer",
        category: "development",
        spaceKind: "professional",
        apps: [],
        templates: [],
        intelligence: { preferredPurpose: "code", externalProviderRequired: "no" },
      }];
    },
    get() { return null; },
  }),
  /external provider policy is invalid/,
);

console.log("PROFILE_PACK_CATALOG=PASS");

{
  // The real bundled manifests are authoritative: two published showcases
  // and two draft/internal Profiles in one read-only catalog.
  const slugs = ["pizzaria-br", "impressao-3d-br", "developer", "legal-br"];
  const packs = slugs.map((slug) => validateProfilePack(JSON.parse(
    readFileSync(new URL(`../system/profile-packs/${slug}/v1/manifest.json`, import.meta.url), "utf8"),
  )));
  const catalog = createProfilePackCatalogFromPacks({ packs });
  assert.deepEqual(catalog.list().map((row) => row.slug),
    ["impressao-3d-br", "pizzaria-br"]);
  assert.equal(catalog.get("developer", 1), null);
  assert.equal(catalog.get("legal-br", 1), null);
  assert.equal(catalog.get("pizzaria-br", 1).category, "business-food-service");
  assert.deepEqual(catalog.get("pizzaria-br", 1).apps, ["files", "notes", "internet", "projects"]);
  assert.equal("components" in catalog.get("pizzaria-br", 1), false);
  assert.equal("security" in catalog.get("pizzaria-br", 1), false);
  const taxonomy = validateProfileTaxonomy(JSON.parse(readFileSync(
    new URL("../system/profile-packs/taxonomy.json", import.meta.url), "utf8",
  )));
  const view = createProfileTaxonomyView({ catalogPort: catalog, taxonomy });
  assert.equal(view.getCategory("business").profileCount, 2);
  assert.equal(view.getCategory("legal").profileCount, 0);
  assert.deepEqual(view.getCategory("business-food-service").directProfiles.map((row) => row.slug),
    ["pizzaria-br"]);
  assert.throws(() => createProfilePackCatalogFromPacks({
    packs: packs.map((pack) => ({ ...pack, state: "active" })),
  }), /must come from validateProfilePack/);
}

