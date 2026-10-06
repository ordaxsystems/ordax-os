import { validateAppIntelligenceManifest } from "../../../contracts/app-intelligence-manifest.mjs";
import { projectsApp } from "../app.mjs";

export const projectsIntelligenceManifest = validateAppIntelligenceManifest({
  schema: "ordax.app-intelligence-manifest/1",
  appId: "projects",
  appVersion: "0.1.0",
  authority: "none",
  execution: "declarative-only",
  instructions: [
    "Use Projetos para identidade, catálogo e continuidade de projetos; não confunda projeto com caminho arbitrário do filesystem.",
    "Criação ou alteração de projeto continua sujeita ao runtime e às permissões correspondentes."
  ],
  intents: [
    {
      id: "projects.list",
      description: "Listar projetos conhecidos pelo OrdaX.",
      effect: "read",
      confirmation: "none",
      parameters: [],
      examples: ["Mostre meus projetos.", "Quais projetos estão cadastrados?"]
    },
    {
      id: "projects.open",
      description: "Abrir um projeto conhecido pelo OrdaX.",
      effect: "read",
      confirmation: "none",
      parameters: [
        { name: "project", type: "string", required: true, description: "Nome ou id estável do projeto." }
      ],
      examples: ["Abra o projeto Bay of All Saints.", "Entre no projeto do catálogo."]
    },
    {
      id: "projects.create",
      description: "Criar um novo projeto pelo fluxo oficial do OrdaX.",
      effect: "write",
      confirmation: "policy",
      parameters: [
        { name: "name", type: "string", required: true, description: "Nome solicitado para o projeto." }
      ],
      examples: ["Crie um projeto chamado Loja 3D."]
    }
  ]
}, { appId: projectsApp.id, appVersion: projectsApp.component.version });
