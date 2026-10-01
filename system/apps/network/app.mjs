import { defineFirstPartyApp } from "../app-contract.mjs";
import { networkAppComponent } from "./component.mjs";

export const networkApp = defineFirstPartyApp({
  id: "network",
  title: "Rede",
  description: "Comunidades profissionais, grupos e mensagens por Space.",
  monogram: "RE",
  singleton: true,
  component: networkAppComponent,
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "network-workspace",
      label: "Rede",
      title: "Comunidades e mensagens",
      body: "O backend da Rede ainda não está ativo nesta composição.",
    },
  ],
});
