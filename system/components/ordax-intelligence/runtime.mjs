import { coreComponentManifests } from "../../services/components/manifests/core.mjs";
import { createIntelligenceRuntime } from "../../services/intelligence/runtime.mjs";

const component = coreComponentManifests.find(
  (candidate) => candidate.id === "ordax-intelligence",
);
if (!component) {
  throw new Error("Canonical ordax-intelligence component manifest is missing");
}

export const componentRuntime = Object.freeze({
  componentId: component.id,
  version: component.version,
  createRuntime: createIntelligenceRuntime,
});
