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

export function createNativeIntelligenceSystemAnalysis({
  host,
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

  let disposed = false;
  return Object.freeze({
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
