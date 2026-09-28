import { INTELLIGENCE_CAPABILITY_BRIDGE_SCHEMA } from "../../contracts/intelligence-tool.mjs";
import { createIntelligenceToolRegistry } from "./tool-registry.mjs";

const CAPABILITY_ID_RE = /^[a-z][a-z0-9.-]{0,127}$/;
const MAX_CAPABILITIES = 128;

function capabilitySet(value) {
  if (!Array.isArray(value) || value.length > MAX_CAPABILITIES) {
    throw new TypeError("Intelligence capability inventory must be a bounded array");
  }
  const normalized = value.map((entry) => {
    if (typeof entry !== "string" || !CAPABILITY_ID_RE.test(entry)) {
      throw new TypeError("Intelligence capability inventory contains an invalid id");
    }
    return entry;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError("Intelligence capability inventory ids must be unique");
  }
  return new Set(normalized);
}

function inspectTool(tool, availableCapabilities) {
  return Object.freeze({
    toolId: tool.id,
    capabilityId: tool.capabilityId,
    available: availableCapabilities.has(tool.capabilityId),
    readOnly: true,
    invocationEnabled: false,
    authority: "none",
  });
}

export function createIntelligenceCapabilityBridge({ registry = null } = {}) {
  const tools = registry ?? createIntelligenceToolRegistry();
  if (
    !tools
    || typeof tools !== "object"
    || typeof tools.list !== "function"
    || typeof tools.get !== "function"
  ) {
    throw new TypeError("Intelligence capability bridge requires a compatible tool registry");
  }

  return Object.freeze({
    schema: INTELLIGENCE_CAPABILITY_BRIDGE_SCHEMA,
    inspect(toolId, capabilityIds = []) {
      const tool = tools.get(toolId);
      if (tool === null) return null;
      return inspectTool(tool, capabilitySet(capabilityIds));
    },
    list(capabilityIds = []) {
      const available = capabilitySet(capabilityIds);
      return Object.freeze(tools.list().map((tool) => inspectTool(tool, available)));
    },
  });
}
