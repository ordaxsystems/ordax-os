import { coreComponentManifests } from "../../services/components/manifests/core.mjs";
import { createLocalAiRuntime } from "../../services/local-ai/runtime.mjs";

const component = coreComponentManifests.find(
  (candidate) => candidate.id === "local-ai-service",
);
if (!component) {
  throw new Error("Canonical local-ai-service component manifest is missing");
}

export const componentRuntime = Object.freeze({
  componentId: component.id,
  version: component.version,
  createRuntime: createLocalAiRuntime,
});
