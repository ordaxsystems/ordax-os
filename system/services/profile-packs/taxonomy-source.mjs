import { validateProfileTaxonomy } from "../../contracts/profile-taxonomy.mjs";

export const DEFAULT_PROFILE_TAXONOMY_PATH = "/system/profile-packs/taxonomy.json";

// Read-only same-origin metadata source. The versioned registry only defines
// category relationships; the already verified manifest owns membership.
export async function loadBundledProfileTaxonomy({
  fetchImpl = globalThis.fetch,
  taxonomyPath = DEFAULT_PROFILE_TAXONOMY_PATH,
} = {}) {
  if (taxonomyPath !== DEFAULT_PROFILE_TAXONOMY_PATH) {
    throw new TypeError("Profile taxonomy requires the canonical bundled path");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Profile taxonomy loader requires fetch()");
  }
  const response = await fetchImpl(taxonomyPath, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response || response.ok !== true || response.redirected === true) {
    throw new Error("Canonical Profile taxonomy is unavailable");
  }
  return validateProfileTaxonomy(await response.json());
}
