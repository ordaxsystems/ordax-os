import { defineFirstPartyApp } from "../../contracts/first-party-app.mjs";
import { assistantComponent } from "./component.mjs";

export const assistantApp = defineFirstPartyApp({
  id: "assistant",
  title: "Assistente",
  description: "Conversa local com a OrdaX Intelligence, sem autoridade implícita para executar ações.",
  monogram: "IA",
  singleton: true,
  component: assistantComponent,
  localization: {
    sourceLocale: "pt-BR",
    bundledLocales: ["pt-BR", "en-US"],
    packPolicy: "component-scoped",
  },
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "assistant-conversation",
      label: "Assistente",
      title: "OrdaX Intelligence",
      body: "A conversa não está disponível nesta composição.",
    },
  ],
});
