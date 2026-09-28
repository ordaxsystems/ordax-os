import { validateProfilePackCatalog } from "../contracts/profile-pack.mjs";
import { LOCAL_PROFILE_PACK_MANIFESTS } from "./manifests.generated.mjs";

export const LOCAL_PROFILE_PACKS = validateProfilePackCatalog(
  LOCAL_PROFILE_PACK_MANIFESTS,
  "Generated local Profile Pack manifests",
);

export function getLocalProfilePack(slug, version) {
  if (typeof slug !== "string" || !Number.isSafeInteger(version)) {
    throw new TypeError("Local Profile Pack lookup requires exact slug and version");
  }
  return LOCAL_PROFILE_PACKS.find(
    (pack) => pack.slug === slug && pack.version === version,
  ) ?? null;
}
