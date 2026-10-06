import { defineFirstPartyApp } from "../app-contract.mjs";
import { storeComponent } from "../../services/components/manifests/apps.mjs";

export const storeApp = defineFirstPartyApp({
  id: "store",
  title: "Loja",
  description: "Descubra aplicativos verificados e acompanhe sua disponibilidade no OrdaX.",
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
      kind: "static",
      label: "Loja",
      title: "Aplicativos do OrdaX",
      body: "A Loja apresenta aplicativos verificados. Instalação, atualização e rollback permanecem sob autoridade do lifecycle da plataforma.",
    },
  ],
});
