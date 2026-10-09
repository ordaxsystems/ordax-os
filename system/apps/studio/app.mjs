import { defineFirstPartyApp } from "../app-contract.mjs";
import { studioComponent } from "./component.mjs";

export const studioApp = defineFirstPartyApp({
  id: "studio",
  title: "ORDAX Studio",
  description: "Acesse seus projetos e confira a integração do Studio com este host.",
  monogram: "ST",
  singleton: true,
  component: studioComponent,
  localization: {
    sourceLocale: "pt-BR",
    bundledLocales: ["pt-BR", "en-US"],
    packPolicy: "component-scoped",
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
