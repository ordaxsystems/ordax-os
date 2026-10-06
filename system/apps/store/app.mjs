import { defineFirstPartyApp } from "../app-contract.mjs";
import { storeComponent } from "../../services/components/manifests/apps.mjs";

export const storeApp = defineFirstPartyApp({
  id: "store",
  title: "Loja",
  description: "Descubra aplicativos OrdaX e solicite instalações pelo lifecycle seguro da plataforma.",
  monogram: "LJ",
  singleton: true,
  component: storeComponent,
  localization: {
    sourceLocale: "pt-BR",
    bundledLocales: ["pt-BR", "en-US"],
    packPolicy: "component-scoped",
  },
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "store-overview",
      label: "Loja",
      title: "Aplicativos OrdaX",
      body: "O catálogo de aplicativos não está disponível nesta composição.",
    },
  ],
});
