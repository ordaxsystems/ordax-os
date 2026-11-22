import { requireContractPort } from "../contract-bindings.mjs";

export function bindModelRouterContracts({ localAi, modelRouter } = {}) {
  requireContractPort("localAi",localAi,"LOCAL_AI_PORT_SCHEMA","ordax.local-ai/1",["assertLocalAiPort"]);
  requireContractPort("modelRouter",modelRouter,"MODEL_ROUTER_PORT_SCHEMA","ordax.model-router/1",["validateModelRoute"]);
  const { assertLocalAiPort } = localAi;
  const { MODEL_ROUTER_PORT_SCHEMA, validateModelRoute } = modelRouter;
  // Source: ordaxsystems/ordax-os/system/services/intelligence/model-router.mjs @ 22790a2f60b03ff5dea54d17171ad3a6a9dde442; extracted without OS-private imports.
const PURPOSES = new Set(["general", "summarize", "reason", "code", "embedding"]);

function normalizeRequest(value) {
  if (value == null) {
    return Object.freeze({
      provider: "local",
      purpose: "general",
      egressApproved: false,
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Model route request must be an object");
  }
  const provider = value.provider ?? "local";
  const purpose = value.purpose ?? "general";
  if (!PURPOSES.has(purpose)) {
    throw new TypeError("Model route purpose is invalid");
  }
  if (provider !== "local") {
    if (value.egressApproved !== true) {
      throw new TypeError("External model route requires explicit egress approval");
    }
    throw new Error(`Model provider ${provider} is not enabled in the Stable/MVP runtime`);
  }
  // The current local port exposes text generation only. A semantic-index
  // descriptor does not make embeddings executable without a verified backend.
  if (purpose === "embedding") {
    throw new Error("Local embedding route is unavailable without a verified embedding backend");
  }
  return Object.freeze({ provider, purpose, egressApproved: false });
}

function createModelRouterRuntime({ localPort } = {}) {
  const local = assertLocalAiPort(localPort);

  return Object.freeze({
    schema: MODEL_ROUTER_PORT_SCHEMA,
    route(value) {
      const request = normalizeRequest(value);
      const snapshot = local.getSnapshot();
      if (snapshot.state !== "ready" || !snapshot.engineId || !snapshot.modelId) {
        throw new Error("No ready local model is available for this route");
      }
      return validateModelRoute({
        provider: "local",
        engineId: snapshot.engineId,
        modelId: snapshot.modelId,
        purpose: request.purpose,
        egressApproved: false,
      });
    },
  });
}

  return Object.freeze({ createModelRouterRuntime });
}
