import { validateComponentCompatibility } from "../../../contracts/component-update-compatibility.mjs";
import { coreComponentManifests } from "../manifests/core.mjs";

function versionOf(componentId) {
  const manifest = coreComponentManifests.find((entry) => entry.id === componentId);
  if (!manifest) throw new TypeError(`Missing core component manifest: ${componentId}`);
  return manifest.version;
}

export const localAiCompatibility = validateComponentCompatibility({
  schema: "ordax.component-compatibility/1",
  componentId: "local-ai-service",
  componentVersion: versionOf("local-ai-service"),
  provides: [
    { id: "ordax.local-ai", major: 1 },
  ],
  requires: [],
  state: null,
  authority: "none",
});

export const intelligenceCompatibility = validateComponentCompatibility({
  schema: "ordax.component-compatibility/1",
  componentId: "ordax-intelligence",
  componentVersion: versionOf("ordax-intelligence"),
  provides: [
    { id: "ordax.intelligence", major: 1 },
  ],
  requires: [
    { id: "ordax.local-ai", minMajor: 1, maxMajor: 1, optional: false },
  ],
  state: null,
  authority: "none",
});

export const coreRuntimeCompatibility = Object.freeze([
  localAiCompatibility,
  intelligenceCompatibility,
]);
