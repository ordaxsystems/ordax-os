import {
  PROFILE_PACK_BUNDLED_SOURCE_SCHEMA,
  assertBundledProfilePackPath,
  validateBundledProfilePackCatalogIndex,
} from "../../contracts/profile-pack-source.mjs";
import {
  validateProfilePack,
  validateProfilePackCatalog,
} from "../../contracts/profile-pack.mjs";

export const DEFAULT_BUNDLED_PROFILE_PACK_CATALOG =
  "/system/profile-packs/catalog.json";

function assertCatalogPath(value) {
  if (value !== DEFAULT_BUNDLED_PROFILE_PACK_CATALOG) {
    throw new TypeError("Bundled Profile Pack catalog must use the canonical same-origin path");
  }
  return value;
}

async function fetchJson(fetchImpl, path, label) {
  const response = await fetchImpl(path, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response || response.ok !== true) {
    const status = response?.status ?? "unavailable";
    throw new Error(`${label} unavailable: ${status}`);
  }
  return response.json();
}

export async function loadBundledProfilePacks({
  fetchImpl = globalThis.fetch,
  catalogPath = DEFAULT_BUNDLED_PROFILE_PACK_CATALOG,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Bundled Profile Pack source requires fetch()");
  }
  const index = validateBundledProfilePackCatalogIndex(
    await fetchJson(fetchImpl, assertCatalogPath(catalogPath), "Bundled Profile Pack catalog"),
  );

  const packs = [];
  for (const entry of index.entries) {
    const path = assertBundledProfilePackPath(entry.manifest);
    const pack = validateProfilePack(
      await fetchJson(fetchImpl, path, `Profile Pack manifest ${entry.slug}@${entry.version}`),
      `Bundled Profile Pack ${entry.slug}@${entry.version}`,
    );
    if (pack.slug !== entry.slug || pack.version !== entry.version) {
      throw new Error(
        `Bundled Profile Pack identity mismatch for ${entry.slug}@${entry.version}`,
      );
    }
    packs.push(pack);
  }

  const validated = validateProfilePackCatalog(packs);
  return Object.freeze({
    schema: PROFILE_PACK_BUNDLED_SOURCE_SCHEMA,
    catalog: index,
    packs: validated,
  });
}
