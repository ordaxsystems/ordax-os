import { defineFirstPartyApp } from "../app-contract.mjs";
import { studioComponent } from "./component.mjs";

export const studioApp = defineFirstPartyApp({
  id: "studio",
  title: "ORDAX Studio",
  description: "Crie e opere projetos com o runtime agentic do ORDAX e ferramentas locais tipadas.",
  monogram: "ST",
  singleton: true,
  component: studioComponent,
  localization: {
    sourceLocale: "pt-BR",
    bundledLocales: ["pt-BR", "en-US"],
    optionalLocales: [],
    allowAppOverride: true,
  },
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "studio-workspace",
      label: "Studio",
      title: "ORDAX Studio",
      body: "O runtime do Studio ainda não está disponível nesta composição.",
    },
  ],
});
