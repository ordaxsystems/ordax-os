import { validateProfileDiscoveryCatalog } from "../../contracts/profile-discovery.mjs";

// This is an editorial projection, never a data source for Intelligence/RAG.
// Only the trusted catalog publisher may provide an actual verification callback.
// The preview is fail-closed while no verified publication pipeline is connected.
export const PROFILE_DISCOVERY_VIEW_SCHEMA = "ordax.profile-discovery-view/1";

export function projectProfileDiscovery({
  catalog,
  activeProfile,
  asOf,
  locale = "pt-BR",
  country = "BR",
  sponsoredEnabled = false,
  verifyPublication,
} = {}) {
  const empty = (state) => Object.freeze({
    schema: PROFILE_DISCOVERY_VIEW_SCHEMA,
    state,
    organic: Object.freeze([]),
    sponsored: Object.freeze([]),
    sponsorshipLabel: "Patrocinado",
    trackingEnabled: false,
    personalizationSource: "profile-only",
  });

  if (!activeProfile || typeof activeProfile.slug !== "string"
      || !Number.isSafeInteger(activeProfile.version) || activeProfile.version < 1) {
    return empty("no-profile");
  }
  // A content source that is not cryptographically verified cannot be displayed.
  // A boolean in catalog metadata is not acceptable evidence.
  if (typeof verifyPublication !== "function") return empty("unavailable");
  const verified = verifyPublication(catalog);
  if (verified !== true) return empty("unavailable");
  const data = validateProfileDiscoveryCatalog(catalog);
  if (typeof asOf !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(asOf)
      || Number.isNaN(Date.parse(asOf))) {
    throw new TypeError("Discovery requires the caller's bounded UTC clock");
  }
  if (typeof sponsoredEnabled !== "boolean") {
    throw new TypeError("Sponsored discovery setting must be boolean");
  }
  // Fixed profile/version/country/locale targeting. No user IDs, IPs,
  // Memory, AI prompts, documents, interests or cross-Space tracking.
  const matches = data.entries.filter((entry) => (
    entry.profileSlug === activeProfile.slug
    && entry.profileVersion === activeProfile.version
    && entry.country === country
    && entry.locale === locale
    && entry.startsAt <= asOf
    && asOf < entry.expiresAt
  ));
  const organic = Object.freeze(matches.filter((entry) => (
    entry.commercial.kind === "organic"
  )));
  const sponsored = Object.freeze(sponsoredEnabled ? matches.filter((entry) => (
    entry.commercial.kind === "sponsored"
  )) : []);

  return Object.freeze({
    schema: PROFILE_DISCOVERY_VIEW_SCHEMA,
    state: "ready",
    organic, sponsored,
    sponsorshipLabel: "Patrocinado",
    trackingEnabled: false,
    personalizationSource: "profile-only",
  });
}
