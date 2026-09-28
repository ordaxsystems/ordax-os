import {
  INTELLIGENCE_AGENT_REGISTRY_SCHEMA,
  INTELLIGENCE_AGENT_SCHEMA,
  validateIntelligenceAgentDescriptors,
  validateIntelligenceAgentId,
} from "../../contracts/intelligence-agent.mjs";

const DEFAULT_AGENT_DESCRIPTORS = Object.freeze([
  Object.freeze({
    schema: INTELLIGENCE_AGENT_SCHEMA,
    id: "system",
    title: "System",
    description: "Interpreta estado observável do OrdaX sem executar mudanças.",
    domain: "system-state",
    readOnly: true,
    authority: "none",
    executable: false,
    toolExecution: false,
  }),
  Object.freeze({
    schema: INTELLIGENCE_AGENT_SCHEMA,
    id: "search",
    title: "Search",
    description: "Organiza consulta sobre fontes já autorizadas sem habilitar egress ou busca implícita.",
    domain: "knowledge-search",
    readOnly: true,
    authority: "none",
    executable: false,
    toolExecution: false,
  }),
  Object.freeze({
    schema: INTELLIGENCE_AGENT_SCHEMA,
    id: "file",
    title: "File",
    description: "Analisa contexto de arquivo explicitamente compartilhado sem ler outros caminhos.",
    domain: "files",
    readOnly: true,
    authority: "none",
    executable: false,
    toolExecution: false,
  }),
  Object.freeze({
    schema: INTELLIGENCE_AGENT_SCHEMA,
    id: "workspace",
    title: "Workspace",
    description: "Interpreta metadados sanitizados da área de trabalho sem controlar janelas ou apps.",
    domain: "workspace",
    readOnly: true,
    authority: "none",
    executable: false,
    toolExecution: false,
  }),
  Object.freeze({
    schema: INTELLIGENCE_AGENT_SCHEMA,
    id: "developer",
    title: "Developer",
    description: "Interpreta projetos, testes, contratos e evidências explicitamente fornecidos.",
    domain: "developer",
    readOnly: true,
    authority: "none",
    executable: false,
    toolExecution: false,
  }),
]);

export function listDefaultIntelligenceAgents() {
  return validateIntelligenceAgentDescriptors(DEFAULT_AGENT_DESCRIPTORS);
}

export function createIntelligenceAgentRegistry({ agents = DEFAULT_AGENT_DESCRIPTORS } = {}) {
  const descriptors = validateIntelligenceAgentDescriptors(agents);
  const byId = new Map(descriptors.map((agent) => [agent.id, agent]));

  return Object.freeze({
    schema: INTELLIGENCE_AGENT_REGISTRY_SCHEMA,
    list() {
      return descriptors;
    },
    get(agentId) {
      const id = validateIntelligenceAgentId(agentId);
      return byId.get(id) ?? null;
    },
    has(agentId) {
      const id = validateIntelligenceAgentId(agentId);
      return byId.has(id);
    },
  });
}
