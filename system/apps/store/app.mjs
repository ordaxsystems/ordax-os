import { defineFirstPartyApp } from "../../contracts/first-party-app.mjs";
import { storeComponent } from "../../services/components/manifests/apps.mjs";

export const storeApp = defineFirstPartyApp({
  id: "store",
  title: "Loja",
  description: "Descubra aplicativos verificados e solicite instalação pelo lifecycle da plataforma.",
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
      body: "O catálogo verificado ainda não está disponível neste host.",
    },
  ],
});
