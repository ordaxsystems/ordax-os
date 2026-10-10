import { validateIntelligenceSnapshot } from "./intelligence.mjs";

// Read-only UX projection of the already-authoritative Intelligence snapshot.
// A connected ChatGPT MCP plugin is not an inference provider for this port.
export const INTELLIGENCE_CONVERSATION_CAPABILITIES_SCHEMA = "ordax.intelligence-conversation-capabilities/1";

export function projectIntelligenceConversationCapabilities(snapshot = null) {
  const current = snapshot === null ? null : validateIntelligenceSnapshot(snapshot);
  const available = current?.inferenceAvailable === true;
  return Object.freeze({
    schema: INTELLIGENCE_CONVERSATION_CAPABILITIES_SCHEMA,
    provider: available ? "local" : "unavailable",
    state: current?.state ?? "degraded",
    engineId: available ? current.engineId : null,
    modelId: available ? current.modelId : null,
    streamingSupported: false,
    // Local client HTTP request can now abort; engine-side interruption is not proven.
    transportCancellationSupported: available,
    backendCancellationSupported: false,
    resultDiscardSupported: true,
    authority: "none",
    toolExecution: false,
  });
}
