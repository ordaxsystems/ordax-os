import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateProfileAppReferences } from "../system/contracts/profile-app-references.mjs";
import { validateProfilePack } from "../system/contracts/profile-pack.mjs";
import {
  validateProfilePackCatalogEntry,
  validateProfilePackCatalogProjection,
} from "../system/contracts/profile-pack-catalog.mjs";
import { validateProfileDistribution } from "../system/contracts/profile-provisioning.mjs";
import { validateAppStoreCatalogSnapshot } from "../system/contracts/app-store.mjs";
import { validateSpace, SPACES_PORT_SCHEMA } from "../system/contracts/spaces.mjs";

const pack = JSON.parse(readFileSync(
  new URL("../system/profile-packs/pizzaria-br/v1/manifest.json", import.meta.url), "utf8",
));

test("Profile App references have exactly one Store-compatible identifier per app", () => {
  const apps = validateProfileAppReferences(["files", "notes", "orders"]);
  assert.deepEqual(apps, ["files", "notes", "orders"]);
  assert.throws(() => apps.push("duplicate"), TypeError);
  assert.throws(() => validateProfileAppReferences(["orders", "orders"]), /duplicate app id orders/);
  for (const invalid of ["Orders", "orders@2", "orders.app", " orders", "", "store/orders"]) {
    assert.throws(() => validateProfileAppReferences([invalid]), /canonical Store app id/);
  }
  assert.throws(() => validateProfileAppReferences(new Array(33).fill("orders")), /bounded array/);
});

test("Profile manifests cannot publish a parallel app artifact or version", () => {
  const referenceOnly = structuredClone(pack);
  referenceOnly.apps.push("orders");
  const validated = validateProfilePack(referenceOnly);
  assert.deepEqual(validated.apps.slice(-1), ["orders"]);
  assert.deepEqual(validated.components, []);

  for (const availability of ["planned", "available"]) {
    const payload = structuredClone(referenceOnly);
    payload.components = [{
      id: "orders",
      kind: "app",
      version: "9.0.0",
      availability,
      required: true,
      signature_required: true,
      sha256: availability === "available" ? "a".repeat(64) : null,
    }];
    assert.throws(() => validateProfilePack(payload), /app packages belong to the Store/);
  }
  referenceOnly.apps.push("orders");
  assert.throws(() => validateProfilePack(referenceOnly), /duplicate app id/);
});

test("Profile provisioning cannot become a second app installer", () => {
  const distribution = {
    $schema: "ordax.profile-distribution/1",
    profile: { slug: "pizzaria-br", version: 1 },
    delivery_mode: "on-demand",
    metadata_bundled: true,
    offline_after_install: true,
    public_install_enabled: true,
    blocked_reason: null,
    components: [{
      id: "orders",
      kind: "app",
      version: "1.0.0",
      required: true,
      availability: "available",
      sha256: "b".repeat(64),
      size_bytes: 100,
      signature_required: true,
    }],
  };
  assert.throws(() => validateProfileDistribution(distribution), /app packages belong to the Store/);
  distribution.components = [];
  const safe = validateProfileDistribution(distribution);
  assert.deepEqual(safe.components, []);
});

test("Both Profile catalog routes enforce canonical app identities but never claim installation", () => {
  const row = {
    slug: "pizzaria-br", version: 1, state: "active", title: "Pizzaria", category: "food",
    manifest: { space_kind: "professional", apps: ["orders"], templates: [], intelligence: {} },
  };
  const entry = validateProfilePackCatalogEntry(row);
  assert.deepEqual(entry.apps, ["orders"]);
  assert.equal("installedVersion" in entry, false);
  assert.equal("installable" in entry, false);
  assert.equal("appArtifacts" in entry, false);
  assert.deepEqual(validateProfilePackCatalogProjection(entry), entry);
  row.manifest.apps = ["orders", "orders"];
  assert.throws(() => validateProfilePackCatalogEntry(row), /duplicate app id/);
  assert.throws(() => validateProfilePackCatalogProjection({ ...entry, apps: ["Orders"] }), /canonical Store app id/);
});

test("Space structure stays separate from Profile and app installation versions", () => {
  const space = validateSpace({
    id: "space-pizzaria", name: "Minha Pizzaria", kind: "professional",
    state: "active", ownerId: "owner-1", profilePack: "pizzaria-br@1",
    apps: ["orders"], installedVersion: "2.0.0", components: [{ kind: "app" }],
  });
  assert.equal(space.schema, SPACES_PORT_SCHEMA);
  assert.equal(space.profilePack, "pizzaria-br@1");
  assert.equal("apps" in space, false);
  assert.equal("installedVersion" in space, false);
  assert.equal("components" in space, false);
});

test("Profile catalog UI never advertises a referenced app as installed", () => {
  const source = readFileSync(new URL("../system/surface/workspace/components/central/profile-catalog.tsx", import.meta.url), "utf8");
  assert.match(source, /a Loja OrdaX distribui e atualiza os aplicativos/);
  assert.match(source, /Referências abaixo não comprovam instalação/);
  assert.match(source, /IDs de aplicativos · Loja OrdaX/);
  assert.doesNotMatch(source, /entry\.apps\.map[\s\S]*?Instalar<\/button>/);
});

test("Store availability is independent of Profile references and cannot be fabricated by them", () => {
  const profile = validateProfilePack(pack);
  const unavailableStore = validateAppStoreCatalogSnapshot({
    schema: "ordax.app-store-catalog/2",
    state: "unavailable", entries: [], reason: "signed-catalog-unavailable", authority: "none",
  });
  assert.ok(profile.apps.includes("files"));
  assert.equal(unavailableStore.state, "unavailable");
  assert.deepEqual(unavailableStore.entries, []);
  assert.equal(profile.components.length, 0);
});
