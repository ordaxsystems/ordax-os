import { defineFirstPartyApp } from "../../contracts/first-party-app.mjs";
import { networkComponent } from "./component.mjs";

export const networkApp = defineFirstPartyApp({
  id: "network",
  title: "Rede",
  description: "Comunidades profissionais e mensagens vinculadas explicitamente ao Space remetente.",
  monogram: "RE",
  singleton: true,
  component: networkComponent,
  localization: {
    sourceLocale: "pt-BR",
    bundledLocales: ["pt-BR", "en-US"],
    packPolicy: "component-scoped",
  },
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "network-workspace",
      label: "Rede",
      title: "Rede profissional",
      body: "O backend da Rede ainda não está ativo nesta composição.",
    },
  ],
});
