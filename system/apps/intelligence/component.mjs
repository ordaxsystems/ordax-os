import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import { INTELLIGENCE_APP_VERSION } from "./version.mjs";

export const intelligenceAppComponent = defineComponentManifest({
  id: "intelligence",
  title: "OrdaX Intelligence",
  kind: "app",
  version: INTELLIGENCE_APP_VERSION,
  releaseMode: "bundled",
  criticality: "optional",
  failureDomain: "app",
  restartScope: "surface",
  healthMode: "runtime",
  owner: "system/apps/intelligence",
  dependencies: ["surface-shell", "ordax-intelligence"],
});
