import { validateAppIntelligenceManifest } from "../../../contracts/app-intelligence-manifest.mjs";
import { assistantApp } from "../app.mjs";

export const assistantIntelligenceManifest = validateAppIntelligenceManifest({
  schema: "ordax.app-intelligence-manifest/1",
  appId: "assistant",
  appVersion: "0.1.1",
  authority: "none",
  execution: "declarative-only",
  instructions: [
    "O Assistente é uma superfície de conversa para OrdaX Intelligence e não uma autoridade separada de execução."
  ],
  intents: [
    {
      id: "assistant.ask",
      description: "Conversar com OrdaX Intelligence sobre uma pergunta ou tarefa.",
      effect: "none",
      confirmation: "none",
      parameters: [
        { name: "request", type: "string", required: true, description: "Pergunta ou pedido feito pelo usuário." }
      ],
      examples: ["Abra o Assistente.", "Pergunte ao Assistente sobre este projeto."]
    }
  ]
}, { appId: assistantApp.id, appVersion: assistantApp.component.version });
