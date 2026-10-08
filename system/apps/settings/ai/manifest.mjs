import { validateAppIntelligenceManifest } from "../../../contracts/app-intelligence-manifest.mjs";
import { settingsApp } from "../app.mjs";

export const settingsIntelligenceManifest = validateAppIntelligenceManifest({
  schema: "ordax.app-intelligence-manifest/1",
  appId: "settings",
  appVersion: "0.1.0",
  authority: "none",
  execution: "declarative-only",
  instructions: [
    "Use Ajustes para preferências do OrdaX, incluindo aparência, acessibilidade, região, rede, inteligência, segurança e notificações.",
    "Mudanças de preferência não devem ser inferidas como autorizadas apenas porque foram descritas semanticamente."
  ],
  intents: [
    {
      id: "settings.open-section",
      description: "Abrir uma seção específica de Ajustes.",
      effect: "none",
      confirmation: "none",
      parameters: [
        { name: "section", type: "string", required: false, description: "Seção solicitada, como aparência, rede ou notificações." }
      ],
      examples: ["Abra os ajustes de rede.", "Vá para Aparência.", "Abra as configurações de notificações.", "Abra os ajustes de Inteligência para ver o modelo ativo."]
    },
    {
      id: "settings.change-preference",
      description: "Alterar uma preferência declarada do OrdaX.",
      effect: "write",
      confirmation: "policy",
      parameters: [
        { name: "preference", type: "string", required: true, description: "Preferência que o usuário quer alterar." },
        { name: "value", type: "string", required: true, description: "Novo valor solicitado." }
      ],
      examples: ["Mude o idioma para português.", "Ative o modo escuro."]
    }
  ]
}, { appId: settingsApp.id, appVersion: settingsApp.component.version });
