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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fileFetch(overrides = new Map()) {
  return async (path, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "same-origin");
    if (overrides.has(path)) {
      return { ok: true, status: 200, async json() { return overrides.get(path); } };
    }
    const sourcePath = path.startsWith("/profile-packs/")
      ? `system${path}`
      : path.replace(/^\//, "");
    const local = resolve(ROOT, sourcePath);
    const raw = JSON.parse(await readFile(local, "utf8"));
    return { ok: true, status: 200, async json() { return raw; } };
  };
}

test("bundled source loads the versioned authoritative Profile manifests", async () => {
  const source = await loadBundledProfilePacks({ fetchImpl: fileFetch() });
  assert.equal(source.schema, "ordax.profile-pack-bundled-source/1");
  assert.deepEqual(
    source.packs.map((pack) => `${pack.slug}@${pack.version}`),
    ["developer@1", "legal-br@1"],
  );
  assert.equal(source.packs[0].spaceKind, "professional");
  assert.equal(source.packs[1].activation.publiclyAvailable, false);
  assert.deepEqual(
    source.catalog.entries.map((entry) => entry.manifest),
    [
      "/profile-packs/developer/v1/manifest.json",
      "/profile-packs/legal-br/v1/manifest.json",
    ],
  );
});

test("bundled catalog index binds path to exact slug and version", () => {
  assert.throws(
    () => validateBundledProfilePackCatalogIndex({
      $schema: "ordax.profile-pack-bundled-catalog/1",
      entries: [{
        slug: "developer",
        version: 1,
        manifest: "/profile-packs/legal-br/v1/manifest.json",
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
      manifest: "/profile-packs/developer/v1/manifest.json",
    }],
  };
  const wrong = JSON.parse(
    await readFile(resolve(ROOT, "system/profile-packs/developer/v1/manifest.json"), "utf8"),
  );
  wrong.version = 2;
  const overrides = new Map([
    [DEFAULT_BUNDLED_PROFILE_PACK_CATALOG, index],
    ["/profile-packs/developer/v1/manifest.json", wrong],
  ]);
  await assert.rejects(
    () => loadBundledProfilePacks({ fetchImpl: fileFetch(overrides) }),
    /identity mismatch/,
  );
});
