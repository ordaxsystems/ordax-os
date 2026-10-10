import { defineFirstPartyApp } from "../../contracts/first-party-app.mjs";
import { filesComponent } from "../../services/components/manifests/apps.mjs";

export const filesApp = defineFirstPartyApp({
  id: "files",
  title: "Arquivos",
  description: "Organize documentos, imagens, downloads e conteúdo persistente do usuário.",
  monogram: "AR",
  singleton: true,
  component: filesComponent,
  localization: {
    sourceLocale: "pt-BR",
    bundledLocales: ["pt-BR", "en-US"],
    packPolicy: "component-scoped",
  },
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "file-space",
      label: "Espaço do usuário",
      title: "Arquivos",
      body: "Este host não expõe um espaço local de arquivos para esta Surface.",
    },
  ],
});
