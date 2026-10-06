import { validateAppIntelligenceManifest } from "../../../contracts/app-intelligence-manifest.mjs";
import { internetApp } from "../app.mjs";

export const internetIntelligenceManifest = validateAppIntelligenceManifest({
  schema: "ordax.app-intelligence-manifest/1",
  appId: "internet",
  appVersion: "0.3.0",
  authority: "none",
  execution: "declarative-only",
  instructions: [
    "Use o app Internet para navegação web, pesquisa, abas e referências; não trate controle de navegador externo como equivalente.",
    "A existência de uma intent não concede execução; navegação continua sujeita ao browser host e às políticas do sistema."
  ],
  intents: [
    {
      id: "internet.new-tab",
      description: "Abrir uma nova aba no navegador nativo do OrdaX.",
      effect: "write",
      confirmation: "none",
      parameters: [],
      examples: ["Abra uma nova aba.", "Crie outra aba no navegador."]
    },
    {
      id: "internet.navigate",
      description: "Navegar a aba do OrdaX Internet para um endereço ou serviço web.",
      effect: "read",
      confirmation: "none",
      parameters: [
        { name: "target", type: "string", required: true, description: "Endereço, domínio ou serviço web solicitado pelo usuário." }
      ],
      examples: ["Abra o YouTube.", "Vá para github.com.", "Abra o site da documentação."]
    },
    {
      id: "internet.search-web",
      description: "Pesquisar conteúdo na web usando o navegador nativo.",
      effect: "read",
      confirmation: "none",
      parameters: [
        { name: "query", type: "string", required: true, description: "Consulta que o usuário deseja pesquisar." }
      ],
      examples: ["Pesquise documentação do Blender.", "Procure notícias sobre o projeto."]
    },
    {
      id: "internet.bookmark",
      description: "Salvar a página atual como favorito do navegador do OrdaX.",
      effect: "write",
      confirmation: "none",
      parameters: [],
      examples: ["Salve esta página nos favoritos."]
    }
  ]
}, { appId: internetApp.id, appVersion: internetApp.component.version });
