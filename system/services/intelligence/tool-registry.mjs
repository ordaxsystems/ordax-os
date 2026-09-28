import {
  INTELLIGENCE_TOOL_REGISTRY_SCHEMA,
  INTELLIGENCE_TOOL_SCHEMA,
  validateIntelligenceToolDescriptors,
  validateIntelligenceToolId,
} from "../../contracts/intelligence-tool.mjs";

const SAFE_READ_ONLY_CAPABILITIES = new Set([
  "system.metrics",
  "network.status",
  "power.status",
]);

const DEFAULT_TOOL_DESCRIPTORS = Object.freeze([
  Object.freeze({
    schema: INTELLIGENCE_TOOL_SCHEMA,
    id: "observe-system-metrics",
    title: "System metrics",
    description: "Descreve métricas agregadas já expostas pela capability read-only do sistema.",
    capabilityId: "system.metrics",
    inputScopes: Object.freeze(["system"]),
    readOnly: true,
    networkEgress: false,
    mutatesState: false,
    invocationEnabled: true,
    authority: "none",
  }),
  Object.freeze({
    schema: INTELLIGENCE_TOOL_SCHEMA,
    id: "observe-network-status",
    title: "Network status",
    description: "Descreve observabilidade local de rede sem conectar, desconectar ou alterar configuração.",
    capabilityId: "network.status",
    inputScopes: Object.freeze(["network"]),
    readOnly: true,
    networkEgress: false,
    mutatesState: false,
    invocationEnabled: true,
    authority: "none",
  }),
  Object.freeze({
    schema: INTELLIGENCE_TOOL_SCHEMA,
    id: "observe-power-status",
    title: "Power status",
    description: "Descreve observabilidade de bateria e energia sem executar ações de energia.",
    capabilityId: "power.status",
    inputScopes: Object.freeze(["power"]),
    readOnly: true,
    networkEgress: false,
    mutatesState: false,
    invocationEnabled: true,
    authority: "none",
  }),
]);

function validateSafeDescriptors(value) {
  const tools = validateIntelligenceToolDescriptors(value);
  for (const tool of tools) {
    if (!SAFE_READ_ONLY_CAPABILITIES.has(tool.capabilityId)) {
      throw new TypeError(
        `Intelligence tool capability ${tool.capabilityId} is not approved for the read-only foundation`,
      );
    }
  }
  return tools;
}

export function listDefaultIntelligenceTools() {
  return validateSafeDescriptors(DEFAULT_TOOL_DESCRIPTORS);
}

export function createIntelligenceToolRegistry({ tools = DEFAULT_TOOL_DESCRIPTORS } = {}) {
  const descriptors = validateSafeDescriptors(tools);
  const byId = new Map(descriptors.map((tool) => [tool.id, tool]));

  return Object.freeze({
    schema: INTELLIGENCE_TOOL_REGISTRY_SCHEMA,
    list() {
      return descriptors;
    },
    get(toolId) {
      const id = validateIntelligenceToolId(toolId);
      return byId.get(id) ?? null;
    },
    has(toolId) {
      const id = validateIntelligenceToolId(toolId);
      return byId.has(id);
    },
  });
}
