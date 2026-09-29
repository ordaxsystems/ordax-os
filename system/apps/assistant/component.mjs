import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import { ASSISTANT_VERSION } from "./version.mjs";

export const assistantComponent = defineComponentManifest({
  id: "assistant",
  title: "Assistente",
  kind: "app",
  version: ASSISTANT_VERSION,
  releaseMode: "git-app",
  criticality: "optional",
  failureDomain: "app",
  restartScope: "component",
  healthMode: "runtime",
  owner: "system/apps/assistant",
  dependencies: ["surface-shell", "ordax-intelligence"],
});
