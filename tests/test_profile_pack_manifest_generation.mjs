import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOCAL_PROFILE_PACK_MANIFESTS,
  LOCAL_PROFILE_PACKS,
  getLocalProfilePack,
} from "../system/profile-packs/manifests.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readManifest(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
}

test("generated Profile manifest projection exactly matches canonical JSON manifests", async () => {
  const expected = [
    await readManifest("system/profile-packs/developer/manifest.json"),
    await readManifest("system/profile-packs/legal-br/manifest.json"),
  ].sort((left, right) =>
    left.slug.localeCompare(right.slug) || left.version - right.version);

  assert.deepEqual(structuredClone(LOCAL_PROFILE_PACK_MANIFESTS), expected);
  assert.deepEqual(
    LOCAL_PROFILE_PACKS.map((pack) => `${pack.slug}@${pack.version}`),
    ["developer@1", "legal-br@1"],
  );
  assert.equal(getLocalProfilePack("developer", 1)?.spaceKind, "professional");
  assert.equal(getLocalProfilePack("legal-br", 1)?.activation.publiclyAvailable, false);
  assert.equal(getLocalProfilePack("missing", 1), null);
  assert.throws(() => LOCAL_PROFILE_PACK_MANIFESTS.push({}), TypeError);
});
