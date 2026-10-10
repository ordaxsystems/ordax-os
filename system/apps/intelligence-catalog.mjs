import { accountIntelligenceManifest } from "./account/ai/manifest.mjs";
import { activityIntelligenceManifest } from "./activity/ai/manifest.mjs";
import { assistantIntelligenceManifest } from "./assistant/ai/manifest.mjs";
import { filesIntelligenceManifest } from "./files/ai/manifest.mjs";
import { internetIntelligenceManifest } from "./internet/ai/manifest.mjs";
import { networkIntelligenceManifest } from "./network/ai/manifest.mjs";
import { projectsIntelligenceManifest } from "./projects/ai/manifest.mjs";
import { settingsIntelligenceManifest } from "./settings/ai/manifest.mjs";
import { systemIntelligenceManifest } from "./system/ai/manifest.mjs";

const BUNDLED_FIRST_PARTY_INTELLIGENCE_MANIFESTS = Object.freeze([
  filesIntelligenceManifest,
  projectsIntelligenceManifest,
  internetIntelligenceManifest,
  networkIntelligenceManifest,
  assistantIntelligenceManifest,
  activityIntelligenceManifest,
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
