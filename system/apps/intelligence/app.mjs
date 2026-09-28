import { defineFirstPartyApp } from "../app-contract.mjs";
import { intelligenceAppComponent } from "./component.mjs";

export const intelligenceApp = defineFirstPartyApp({
  id: "intelligence",
  title: "OrdaX Intelligence",
  description: "Converse com a inteligência local do OrdaX com privacidade e contexto autorizado.",
  monogram: "OI",
  singleton: true,
  component: intelligenceAppComponent,
  requiredCapabilities: ["intelligence.system"],
  panels: [
    {
      kind: "extension",
      extensionId: "intelligence-chat",
      label: "Intelligence",
      title: "Conversa local",
      body: "A interface conversacional do OrdaX Intelligence não está disponível nesta composição.",
    },
  ],
});
