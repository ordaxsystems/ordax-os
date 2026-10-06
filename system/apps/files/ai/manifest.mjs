import { validateAppIntelligenceManifest } from "../../../contracts/app-intelligence-manifest.mjs";
import { filesApp } from "../app.mjs";

export const filesIntelligenceManifest = validateAppIntelligenceManifest({
  schema: "ordax.app-intelligence-manifest/1",
  appId: "files",
  appVersion: "0.1.0",
  authority: "none",
  execution: "declarative-only",
  instructions: [
    "Use Arquivos para conteúdo persistente do usuário; referências a caminhos ou recursos nunca concedem acesso por si mesmas.",
    "Operações de escrita ou remoção dependem do file-space e das políticas de autorização do OrdaX."
  ],
  intents: [
    {
      id: "files.browse",
      description: "Abrir ou listar uma área do espaço de arquivos autorizado.",
      effect: "read",
      confirmation: "none",
      parameters: [
        { name: "location", type: "string", required: false, description: "Local lógico solicitado, como Documentos ou Downloads." }
      ],
      examples: ["Abra meus Documentos.", "Mostre a pasta Downloads."]
    },
    {
      id: "files.search",
      description: "Pesquisar arquivos no espaço autorizado do usuário.",
      effect: "read",
      confirmation: "none",
      parameters: [
        { name: "query", type: "string", required: true, description: "Nome ou termo procurado pelo usuário." }
      ],
      examples: ["Procure o arquivo do orçamento.", "Encontre imagens do catálogo."]
    },
    {
      id: "files.create-folder",
      description: "Criar uma pasta dentro do espaço de arquivos autorizado.",
      effect: "write",
      confirmation: "policy",
      parameters: [
        { name: "name", type: "string", required: true, description: "Nome da nova pasta." }
      ],
      examples: ["Crie uma pasta chamada Referências."]
    },
    {
      id: "files.move",
      description: "Mover ou renomear um recurso já autorizado.",
      effect: "write",
      confirmation: "policy",
      parameters: [
        { name: "source", type: "string", required: true, description: "Recurso de origem descrito pelo usuário." },
        { name: "destination", type: "string", required: true, description: "Destino lógico solicitado." }
      ],
      examples: ["Mova estas imagens para Catálogo.", "Renomeie esta pasta para Final."]
    },
    {
      id: "files.delete",
      description: "Remover um recurso do espaço de arquivos autorizado.",
      effect: "destructive",
      confirmation: "explicit",
      parameters: [
        { name: "target", type: "string", required: true, description: "Recurso que o usuário pediu para remover." }
      ],
      examples: ["Apague este arquivo duplicado."]
    }
  ]
}, { appId: filesApp.id, appVersion: filesApp.component.version });
