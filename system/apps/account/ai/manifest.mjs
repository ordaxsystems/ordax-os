import { validateAppIntelligenceManifest } from "../../../contracts/app-intelligence-manifest.mjs";
import { accountApp } from "../app.mjs";

export const accountIntelligenceManifest = validateAppIntelligenceManifest({
  schema: "ordax.app-intelligence-manifest/1",
  appId: "account",
  appVersion: "0.1.0",
  authority: "none",
  execution: "declarative-only",
  instructions: [
    "Use Conta para identidade, Spaces, Profiles, Memory e continuidade de conta.",
    "Credenciais, tokens e dados protegidos nunca devem ser solicitados ou expostos pelo manifesto."
  ],
  intents: [
    {
      id: "account.open-section",
      description: "Abrir uma seção da Conta para revisão pelo usuário.",
      effect: "read",
      confirmation: "none",
      parameters: [
        { name: "section", type: "string", required: false, description: "Seção como visão geral, Spaces, Profiles ou Memory." }
      ],
      examples: ["Abra minha Conta.", "Mostre meus Spaces.", "Abra a área de Memory."]
    },
    {
      id: "account.review-continuity",
      description: "Revisar estado de continuidade e sincronização apresentado pela Conta.",
      effect: "read",
      confirmation: "none",
      parameters: [],
      examples: ["Veja se minha conta está sincronizada.", "Mostre o estado de continuidade."]
    }
  ]
}, { appId: accountApp.id, appVersion: accountApp.component.version });
