import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import { NETWORK_APP_VERSION } from "./version.mjs";

export const networkComponent = defineComponentManifest({
  id: "network",
  title: "Rede",
  kind: "app",
  version: NETWORK_APP_VERSION,
  releaseMode: "git-app",
  criticality: "optional",
  failureDomain: "app",
  restartScope: "component",
  healthMode: "runtime",
  owner: "system/apps/network",
  dependencies: ["surface-shell"],
});
