import {
  PROFILE_PACK_BUNDLED_SOURCE_SCHEMA,
  assertBundledProfilePackPath,
  validateBundledProfilePackCatalogIndex,
} from "../../contracts/profile-pack-source.mjs";
import { validateProfilePack } from "../../contracts/profile-pack.mjs";

export const DEFAULT_BUNDLED_PROFILE_PACK_CATALOG =
  "/system/profile-packs/catalog.json";

// Keep same-origin read-only manifest acquisition bounded as catalogs grow.
const MAX_CONCURRENT_MANIFEST_READS = 4;

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
    redirect: "error",
  });
  if (!response || response.ok !== true) {
    const status = response?.status ?? "unavailable";
    throw new Error(`${label} unavailable: ${status}`);
  }
  if (response.redirected === true) {
    throw new Error(`${label} redirect is not allowed`);
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
  // Each manifest has an independent, exact catalog identity. Fetch at most
  // four at once while retaining original catalog order and fail-closed checks.
  for (let offset = 0; offset < index.entries.length; offset += MAX_CONCURRENT_MANIFEST_READS) {
    const batch = index.entries.slice(offset, offset + MAX_CONCURRENT_MANIFEST_READS);
    const validated = await Promise.all(batch.map(async (entry) => {
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
      return pack;
    }));
    packs.push(...validated);
  }

  return Object.freeze({
    schema: PROFILE_PACK_BUNDLED_SOURCE_SCHEMA,
    catalog: index,
    packs: Object.freeze(packs),
  });
}
