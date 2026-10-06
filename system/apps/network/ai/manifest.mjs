import { validateAppIntelligenceManifest } from "../../../contracts/app-intelligence-manifest.mjs";
import { networkApp } from "../app.mjs";

export const networkIntelligenceManifest = validateAppIntelligenceManifest({
  schema: "ordax.app-intelligence-manifest/1",
  appId: "network",
  appVersion: "0.1.0",
  authority: "none",
  execution: "declarative-only",
  instructions: [
    "O app Rede representa comunidades profissionais e mensagens vinculadas a Spaces; configuração de Wi-Fi pertence a Ajustes, não a este app.",
    "Não invente backend, comunidade ou mensagem quando a capability da Rede não estiver disponível."
  ],
  intents: [
    {
      id: "network.open",
      description: "Abrir a área de Rede profissional do OrdaX.",
      effect: "read",
      confirmation: "none",
      parameters: [],
      examples: ["Abra a Rede profissional.", "Vá para a comunidade do meu Space."]
    },
    {
      id: "network.review-messages",
      description: "Revisar mensagens ou atividade da Rede quando o backend estiver disponível.",
      effect: "read",
      confirmation: "none",
      parameters: [],
      examples: ["Mostre as mensagens da Rede.", "Veja a atividade da comunidade."]
    }
  ]
}, { appId: networkApp.id, appVersion: networkApp.component.version });
