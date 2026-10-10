import { validateApplicationActionManifest } from "../../../contracts/application-action-manifest.mjs";
import { filesApp } from "../app.mjs";
import { filesIntelligenceManifest } from "../ai/manifest.mjs";

// A declaration is not authorization. Other Files intents cannot be routed
// through this provider until their scoped grants and confirmation exist.
const browseIntent = filesIntelligenceManifest.intents.find(
  (entry) => entry.id === "files.browse",
);
if (!browseIntent) {
  throw new TypeError("Canonical Files browse intent is missing");
}

export const filesApplicationActionManifest = validateApplicationActionManifest({
  schema: "ordax.application-action-manifest/1",
  appId: filesApp.id,
  appVersion: filesApp.component.version,
  authority: "none",
  execution: "proposal-only",
  capabilities: [{
    schema: "ordax.application-action-capability/1",
    appId: filesApp.id,
    actionId: browseIntent.id,
    title: "Listar arquivos autorizados",
    description: browseIntent.description,
    sourceClass: "first-party",
    platform: "ordax",
    provider: { kind: "first-party-native", adapterId: "files-native", revision: "1" },
    binding: { payloadSha256: null },
    parameters: [{ id: "location", type: "string", required: false, maxLength: 1024 }],
    riskClass: "read-only",
    confirmation: "none",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
    provenance: "ordax-os:system/apps/files/actions/manifest.mjs",
  }],
}, { appId: filesApp.id, appVersion: filesApp.component.version });
