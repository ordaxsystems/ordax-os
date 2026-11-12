import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateBundledProfilePackCatalogIndex,
} from "../system/contracts/profile-pack-source.mjs";
import {
  DEFAULT_BUNDLED_PROFILE_PACK_CATALOG,
  loadBundledProfilePacks,
} from "../system/services/profile-packs/bundled-source.mjs";
import { resolveProfilePackRestore } from "../system/services/profile-packs/restore.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fileFetch(overrides = new Map()) {
  return async (path, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    if (overrides.has(path)) {
      return { ok: true, status: 200, redirected: false, async json() { return overrides.get(path); } };
    }
    const sourcePath = path.replace(/^\//, "");
    const local = resolve(ROOT, sourcePath);
    const raw = JSON.parse(await readFile(local, "utf8"));
    return { ok: true, status: 200, redirected: false, async json() { return raw; } };
  };
}

test("bundled source loads the versioned authoritative Profile manifests", async () => {
  const source = await loadBundledProfilePacks({ fetchImpl: fileFetch() });
  assert.equal(source.schema, "ordax.profile-pack-bundled-source/1");
  assert.deepEqual(
    source.packs.map((pack) => `${pack.slug}@${pack.version}`),
    ["developer@1", "legal-br@1", "pizzaria-br@1", "impressao-3d-br@1"],
  );
  assert.equal(source.packs[0].spaceKind, "professional");
  assert.equal(source.packs[1].activation.publiclyAvailable, false);
  assert.equal(source.packs[2].activation.publiclyAvailable, true);
  assert.deepEqual(source.packs[2].components, []);
  assert.equal(source.packs[3].activation.publiclyAvailable, true);
  assert.equal(source.packs[3].category, "digital-fabrication");
  assert.deepEqual(source.packs[3].components, []);
  assert.deepEqual(
    source.catalog.entries.map((entry) => entry.manifest),
    [
      "/system/profile-packs/developer/v1/manifest.json",
      "/system/profile-packs/legal-br/v1/manifest.json",
      "/system/profile-packs/pizzaria-br/v1/manifest.json",
      "/system/profile-packs/impressao-3d-br/v1/manifest.json",
    ],
  );
});

test("four independent bundled manifests start in parallel but retain catalog order", async () => {
  const catalog = JSON.parse(await readFile(resolve(ROOT, "system/profile-packs/catalog.json"), "utf8"));
  const manifestPayloads = new Map(await Promise.all(catalog.entries.map(async (entry) => [
    entry.manifest,
    JSON.parse(await readFile(resolve(ROOT, entry.manifest.slice(1)), "utf8")),
  ])));
  const requested = [];
  const pending = [];
  const fetchImpl = async (path, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    if (path === DEFAULT_BUNDLED_PROFILE_PACK_CATALOG) {
      return { ok: true, redirected: false, json: async () => catalog };
    }
    requested.push(path);
    return new Promise((resolve) => {
      pending.push(() => resolve({
        ok: true,
        redirected: false,
        json: async () => manifestPayloads.get(path),
      }));
    });
  };
  const loading = loadBundledProfilePacks({ fetchImpl });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    requested,
    catalog.entries.map((entry) => entry.manifest),
    "independent reads must all start before any manifest completes",
  );
  for (let i = pending.length - 1; i >= 0; i -= 1) pending[i]();
  const source = await loading;
  assert.deepEqual(
    source.packs.map((pack) => pack.slug),
    catalog.entries.map((entry) => entry.slug),
    "completion order must not alter validated catalog order",
  );
  assert.ok(Object.isFrozen(source.packs));
});

test("bundled catalog index binds path to exact slug and version", () => {
  assert.throws(
    () => validateBundledProfilePackCatalogIndex({
      $schema: "ordax.profile-pack-bundled-catalog/1",
      entries: [{
        slug: "developer",
        version: 1,
        manifest: "/system/profile-packs/legal-br/v1/manifest.json",
      }],
    }),
    /must match its exact Profile identity/,
  );
  assert.throws(
    () => validateBundledProfilePackCatalogIndex({
      $schema: "ordax.profile-pack-bundled-catalog/1",
      entries: [{
        slug: "developer",
        version: 1,
        manifest: "https://example.com/manifest.json",
      }],
    }),
    /must match its exact Profile identity/,
  );
});

test("bundled source refuses alternate catalog origins and manifest identity drift", async () => {
  await assert.rejects(
    () => loadBundledProfilePacks({
      fetchImpl: fileFetch(),
      catalogPath: "https://example.com/catalog.json",
    }),
    /canonical same-origin path/,
  );

  const index = {
    $schema: "ordax.profile-pack-bundled-catalog/1",
    entries: [{
      slug: "developer",
      version: 1,
      manifest: "/system/profile-packs/developer/v1/manifest.json",
    }],
  };
  const wrong = JSON.parse(
    await readFile(resolve(ROOT, "system/profile-packs/developer/v1/manifest.json"), "utf8"),
  );
  wrong.version = 2;
  const overrides = new Map([
    [DEFAULT_BUNDLED_PROFILE_PACK_CATALOG, index],
    ["/system/profile-packs/developer/v1/manifest.json", wrong],
  ]);
  await assert.rejects(
    () => loadBundledProfilePacks({ fetchImpl: fileFetch(overrides) }),
    /identity mismatch/,
  );
});

test("bundled source rejects redirected responses even from a non-compliant fetch adapter", async () => {
  const redirectedFetch = async (_path, options) => {
    assert.equal(options.redirect, "error");
    return {
      ok: true,
      status: 200,
      redirected: true,
      async json() {
        return { $schema: "ordax.profile-pack-bundled-catalog/1", entries: [] };
      },
    };
  };
  await assert.rejects(
    () => loadBundledProfilePacks({ fetchImpl: redirectedFetch }),
    /redirect is not allowed/,
  );
});


test("bundled normalized manifests flow directly into restore without raw revalidation", async () => {
  const source = await loadBundledProfilePacks({ fetchImpl: fileFetch() });
  const activationSnapshot = {
    schema: "ordax.profile-activation-state/1",
    revision: 1,
    persistence: "device",
    spaces: [{
      spaceId: "space-dev",
      spaceKind: "professional",
      current: {
        profile: { slug: "developer", version: 1 },
        components: [],
        activatedAt: 1000,
      },
      previous: null,
    }],
  };
  const activationState = {
    schema: "ordax.profile-activation-state-port/1",
    getSnapshot() { return activationSnapshot; },
    async refresh() { return activationSnapshot; },
    dispose() {},
  };
  const plan = {
    schema: "ordax.profile-provisioning/1",
    profile: { slug: "developer", version: 1 },
    state: "already-provisioned",
    reason: null,
    metadataBundled: true,
    deliveryMode: "bundled",
    offlineAfterInstall: true,
    inventoryPersistence: "device",
    missing: [],
    alreadyInstalled: [],
    componentsSatisfied: true,
    requiredMissing: [],
    requiredDownloadBytes: 0,
    mayDownload: false,
    mayActivate: true,
  };
  const provisioning = {
    schema: "ordax.profile-provisioning/1",
    list() { return Object.freeze([plan]); },
    get(slug, version) {
      return slug === "developer" && version === 1 ? plan : null;
    },
    refresh() { return this.list(); },
    dispose() {},
  };

  const restore = resolveProfilePackRestore({
    packs: source.packs,
    provisioning,
    activationState,
  });
  assert.equal(restore.entries[0].state, "resolved");
  assert.deepEqual(restore.entries[0].profile, { slug: "developer", version: 1 });
});
