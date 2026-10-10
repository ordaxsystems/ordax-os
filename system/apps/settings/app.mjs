import { defineFirstPartyApp } from "../../contracts/first-party-app.mjs";
import { settingsComponent } from "../../services/components/manifests/apps.mjs";

export const settingsApp = defineFirstPartyApp({
  id: "settings",
  title: "Ajustes",
  description: "Preferências compartilhadas, aparência e rede do OrdaX.",
  monogram: "AJ",
  singleton: true,
  component: settingsComponent,
  localization: {
    sourceLocale: "pt-BR",
    bundledLocales: ["pt-BR", "en-US"],
    packPolicy: "component-scoped",
  },
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "settings-overview",
      label: "Ajustes",
      title: "Preferências do OrdaX",
      body: "As preferências desta Surface não estão disponíveis neste host.",
    },
  ],
});
