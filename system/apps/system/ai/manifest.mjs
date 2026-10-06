import { validateAppIntelligenceManifest } from "../../../contracts/app-intelligence-manifest.mjs";
import { systemApp } from "../app.mjs";

export const systemIntelligenceManifest = validateAppIntelligenceManifest({
  schema: "ordax.app-intelligence-manifest/1",
  appId: "system",
  appVersion: "0.1.0",
  authority: "none",
  execution: "declarative-only",
  instructions: [
    "Use Sistema para estado do OrdaX, atualizações, armazenamento e diagnósticos.",
    "Diagnóstico é consultivo; o manifesto não concede autoridade de atualização, reboot, disco ou manutenção."
  ],
  intents: [
    {
      id: "system.status",
      description: "Consultar a visão geral e saúde apresentada pelo Sistema.",
      effect: "read",
      confirmation: "none",
      parameters: [],
      examples: ["Como está o sistema?", "Mostre a saúde do OrdaX."]
    },
    {
      id: "system.check-updates",
      description: "Consultar o estado de atualizações do OrdaX.",
      effect: "read",
      confirmation: "none",
      parameters: [],
      examples: ["Há atualização disponível?", "Verifique as atualizações."]
    },
    {
      id: "system.diagnostics",
      description: "Abrir ou explicar diagnósticos locais disponíveis.",
      effect: "read",
      confirmation: "none",
      parameters: [],
      examples: ["Abra os diagnósticos.", "Explique este problema do sistema."]
    }
  ]
}, { appId: systemApp.id, appVersion: systemApp.component.version });
