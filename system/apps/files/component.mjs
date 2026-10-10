import { defineComponentManifest } from "../../contracts/component-manifest.mjs";

// A identidade do componente Arquivos pertence ao próprio aplicativo.
// O catálogo da plataforma a consome sem manter uma segunda declaração.
export const filesComponent = defineComponentManifest({
  id: "files",
  title: "Arquivos",
  kind: "app",
  version: "0.1.0",
  releaseMode: "bundled",
  criticality: "optional",
  failureDomain: "app",
  restartScope: "surface",
  healthMode: "surface",
  owner: "system/apps/files",
  dependencies: ["surface-shell"],
});

