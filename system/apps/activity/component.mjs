import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import { ACTIVITY_VERSION } from "./version.mjs";

export const activityComponent = defineComponentManifest({
  id: "activity",
  title: "Atividade",
  kind: "app",
  version: ACTIVITY_VERSION,
  releaseMode: "git-app",
  criticality: "optional",
  failureDomain: "app",
  restartScope: "component",
  healthMode: "runtime",
  owner: "system/apps/activity",
  dependencies: ["surface-shell"],
});
