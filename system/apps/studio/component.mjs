import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import { STUDIO_VERSION } from "./version.mjs";

export const studioComponent = defineComponentManifest({
  id: "studio",
  title: "ORDAX Studio",
  kind: "app",
  version: STUDIO_VERSION,
  releaseMode: "git-app",
  criticality: "optional",
  failureDomain: "app",
  restartScope: "component",
  healthMode: "runtime",
  owner: "system/apps/studio",
  dependencies: ["surface-shell"],
});
