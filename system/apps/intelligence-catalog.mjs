import { accountIntelligenceManifest } from "./account/ai/manifest.mjs";
import { settingsIntelligenceManifest } from "./settings/ai/manifest.mjs";
import { systemIntelligenceManifest } from "./system/ai/manifest.mjs";

const BUNDLED_FIRST_PARTY_INTELLIGENCE_MANIFESTS = Object.freeze([
  settingsIntelligenceManifest,
  accountIntelligenceManifest,
  systemIntelligenceManifest,
]);

const BY_APP_ID = new Map(
  BUNDLED_FIRST_PARTY_INTELLIGENCE_MANIFESTS.map((manifest) => [manifest.appId, manifest]),
);
if (BY_APP_ID.size !== BUNDLED_FIRST_PARTY_INTELLIGENCE_MANIFESTS.length) {
  throw new TypeError("Bundled App Intelligence manifest ids must be unique");
}

export function listBundledFirstPartyIntelligenceManifests() {
  return BUNDLED_FIRST_PARTY_INTELLIGENCE_MANIFESTS;
}

export function getBundledFirstPartyIntelligenceManifest(appId) {
  return BY_APP_ID.get(appId) ?? null;
}
