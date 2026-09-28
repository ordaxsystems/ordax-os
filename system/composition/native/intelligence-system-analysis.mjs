import {
  INTELLIGENCE_PORT_SCHEMA,
  assertIntelligencePort,
  validateIntelligenceRequest,
} from "../../contracts/intelligence.mjs";
import { assertSurfaceHost } from "../../contracts/surface-host.mjs";
import { createIntelligenceAuditJournal } from "../../services/intelligence/audit-journal.mjs";
import { createIntelligenceCapabilityBridge } from "../../services/intelligence/capability-bridge.mjs";
import {
  createIntelligenceReadOnlyToolExecutor,
  createNetworkStatusIntelligenceToolHandler,
  createPowerStatusIntelligenceToolHandler,
  createSystemMetricsIntelligenceToolHandler,
} from "../../services/intelligence/readonly-tool-executor.mjs";
import { createIntelligenceSystemObserver } from "../../services/intelligence/system-observation.mjs";
import { createIntelligenceToolAuthorizationBroker } from "../../services/intelligence/tool-authorization.mjs";
import { createIntelligenceToolRegistry } from "../../services/intelligence/tool-registry.mjs";

const SYSTEM_OBSERVATIONS = Object.freeze([
  Object.freeze({ toolId: "observe-system-metrics", targetScope: "system" }),
  Object.freeze({ toolId: "observe-network-status", targetScope: "network" }),
  Object.freeze({ toolId: "observe-power-status", targetScope: "power" }),
]);

const SYSTEM_TOOL_BINDINGS = Object.freeze([Object.freeze({
  agentId: "system",
  toolIds: Object.freeze(SYSTEM_OBSERVATIONS.map((entry) => entry.toolId)),
})]);

function createGovernedSystemIntelligenceClient(portValue, observer) {
  const port = assertIntelligencePort(portValue);
  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return port.getSnapshot();
    },
    subscribe(listener) {
      return port.subscribe(listener);
    },
    async respond(value) {
      const request = validateIntelligenceRequest(value);
      if (request.intent !== "diagnose") {
        return port.respond(request);
      }
      const observation = await observer.observe();
      return port.respond({
        intent: request.intent,
        prompt: request.prompt,
        context: observation.context,
        maxTokens: request.maxTokens,
      });
    },
  });
}

export function createNativeIntelligenceSystemAnalysis({
  host,
  intelligence,
  systemMetrics = null,
  networkStatus = null,
  powerStatus = null,
} = {}) {
  const hostPort = assertSurfaceHost(host);
  const auditJournal = createIntelligenceAuditJournal();
  const toolRegistry = createIntelligenceToolRegistry();
  const capabilityBridge = createIntelligenceCapabilityBridge({ registry: toolRegistry });
  const authorizationBroker = createIntelligenceToolAuthorizationBroker({
    toolRegistry,
    capabilityBridge,
    auditJournal,
    bindings: SYSTEM_TOOL_BINDINGS,
    getCapabilityIds: () => hostPort.getSnapshot().capabilityIds,
  });

  const handlers = [];
  if (systemMetrics !== null) {
    handlers.push(createSystemMetricsIntelligenceToolHandler(systemMetrics));
  }
  if (networkStatus !== null) {
    handlers.push(createNetworkStatusIntelligenceToolHandler(networkStatus));
  }
  if (powerStatus !== null) {
    handlers.push(createPowerStatusIntelligenceToolHandler(powerStatus));
  }

  const executor = createIntelligenceReadOnlyToolExecutor({
    authorizationBroker,
    toolRegistry,
    auditJournal,
    handlers,
  });
  const observer = createIntelligenceSystemObserver({
    authorizationBroker,
    executor,
    observations: SYSTEM_OBSERVATIONS,
  });
  const systemIntelligence = createGovernedSystemIntelligenceClient(intelligence, observer);

  let disposed = false;
  return Object.freeze({
    intelligence: systemIntelligence,
    observer,
    auditJournal,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.dispose();
      executor.dispose();
      authorizationBroker.dispose();
    },
  });
}
