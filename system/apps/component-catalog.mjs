import { validateComponentManifests } from "../contracts/component-manifest.mjs";
import { appComponentManifests } from "../services/components/manifests/apps.mjs";
import { coreComponentManifests } from "../services/components/manifests/core.mjs";
import { activityComponent } from "./activity/component.mjs";
import { filesComponent } from "./files/component.mjs";
import { studioComponent } from "./studio/component.mjs";

const COMPONENTS = validateComponentManifests([
  ...coreComponentManifests,
  ...appComponentManifests,
  activityComponent,
  filesComponent,
  studioComponent,
]);

const COMPONENT_BY_ID = new Map(
  COMPONENTS.map((component) => [component.id, component]),
);

export function listSystemComponents() {
  return COMPONENTS;
}

export function getSystemComponent(componentId) {
  return COMPONENT_BY_ID.get(componentId) ?? null;
}
