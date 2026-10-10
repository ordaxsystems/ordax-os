import { validateComponentManifests } from "../contracts/component-manifest.mjs";
import { appComponentManifests } from "../services/components/manifests/apps.mjs";
import { coreComponentManifests } from "../services/components/manifests/core.mjs";
import { assistantComponent } from "./assistant/component.mjs";
import { activityComponent } from "./activity/component.mjs";
import { internetComponent } from "./internet/component.mjs";
import { networkComponent } from "./network/component.mjs";
import { projectsComponent } from "./projects/component.mjs";
import { studioComponent } from "./studio/component.mjs";

const COMPONENTS = validateComponentManifests([
  ...coreComponentManifests,
  ...appComponentManifests,
  assistantComponent,
  activityComponent,
  internetComponent,
  networkComponent,
  projectsComponent,
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
