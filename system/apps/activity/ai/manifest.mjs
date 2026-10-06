import { validateAppIntelligenceManifest } from "../../../contracts/app-intelligence-manifest.mjs";
import { activityApp } from "../app.mjs";

export const activityIntelligenceManifest = validateAppIntelligenceManifest({
  schema: "ordax.app-intelligence-manifest/1",
  appId: "activity",
  appVersion: "0.1.0",
  authority: "none",
  execution: "declarative-only",
  instructions: [
    "Use Atividade para revisar Work explícito, progresso e resultados do Personal OrdaX.",
    "Retomar ou alterar Work continua sujeito ao runtime Personal OrdaX e às suas autorizações."
  ],
  intents: [
    {
      id: "activity.review",
      description: "Revisar trabalhos, progresso e resultados apresentados em Atividade.",
      effect: "read",
      confirmation: "none",
      parameters: [],
      examples: ["Mostre minhas atividades.", "O que está em andamento?"]
    },
    {
      id: "activity.resume-work",
      description: "Solicitar continuação de um Work existente do Personal OrdaX.",
      effect: "write",
      confirmation: "policy",
      parameters: [
        { name: "work", type: "string", required: true, description: "Trabalho que o usuário deseja continuar." }
      ],
      examples: ["Continue a tarefa do catálogo.", "Retome o trabalho pausado."]
    }
  ]
}, { appId: activityApp.id, appVersion: activityApp.component.version });
