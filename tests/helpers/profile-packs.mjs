import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateProfilePack } from "../../system/contracts/profile-pack.mjs";
import { createLocalProfileDistributions } from "../../system/profile-packs/distributions.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_PATHS = Object.freeze([
  "system/profile-packs/developer/v1/manifest.json",
  "system/profile-packs/legal-br/v1/manifest.json",
]);

export async function loadCanonicalProfilePacksForTest() {
  const packs = [];
  for (const path of MANIFEST_PATHS) {
    const raw = JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
    packs.push(validateProfilePack(raw, `Test Profile manifest ${path}`));
  }
  return Object.freeze(packs);
}

export async function loadLocalProfileDistributionsForTest() {
  return createLocalProfileDistributions(await loadCanonicalProfilePacksForTest());
}
