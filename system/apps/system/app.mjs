import { defineFirstPartyApp } from "../app-contract.mjs";
import { systemComponent } from "../../services/components/manifests/apps.mjs";

export const systemApp = defineFirstPartyApp({
  id: "system",
  title: "Sistema",
  description: "Entrega, atualizações, conectividade e recursos desta execução do OrdaX.",
  monogram: "SI",
  singleton: true,
  component: systemComponent,
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
      extensionId: "system-overview",
      label: "Sistema",
      title: "Visão geral",
      body: "O estado detalhado do sistema não está disponível neste host.",
    },
  ],
});
