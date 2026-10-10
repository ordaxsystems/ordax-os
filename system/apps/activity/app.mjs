import { defineFirstPartyApp } from "../../contracts/first-party-app.mjs";
import { activityComponent } from "./component.mjs";

export const activityApp = defineFirstPartyApp({
  id: "activity",
  title: "Atividade",
  description: "Trabalho explícito do Personal OrdaX, com progresso e resultados visíveis.",
  monogram: "AT",
  singleton: true,
  component: activityComponent,
  localization: {
    sourceLocale: "pt-BR",
    bundledLocales: ["pt-BR", "en-US"],
    packPolicy: "component-scoped",
  },
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "personal-activity",
      label: "Personal OrdaX",
      title: "Atividade",
      body: "O runtime Personal OrdaX não está disponível nesta composição.",
    },
  ],
});
