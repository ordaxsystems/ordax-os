export const LOCAL_AI_PORT_SCHEMA = "ordax.local-ai/1";
export const LOCAL_AI_NATIVE_ENDPOINT = "/__ordax/native/local-ai";
export const LOCAL_AI_MAX_SYSTEM_PROMPT_CHARS = 8192;
export const LOCAL_AI_MAX_PROMPT_CHARS = 32768;
export const LOCAL_AI_MAX_OUTPUT_TOKENS = 2048;
export const LOCAL_AI_MAX_RESPONSE_CHARS = 131072;
export const LOCAL_AI_MAX_MODEL_DISCOVERY_BYTES = 256 * 1024;
export const LOCAL_AI_MAX_COMPLETION_RESPONSE_BYTES = 1024 * 1024;

function text(value, label, max = 4096) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

export function validateLocalAiEngineId(value) {
  return text(value, "engineId", 80);
}

export function validateLocalAiModelId(value) {
  return text(value, "modelId", 160);
}

export function validateLocalAiSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Local AI snapshot must be an object");
  }
  const state = value.state;
  if (!["unavailable", "stopped", "ready", "busy", "error"].includes(state)) {
    throw new TypeError("Local AI state is invalid");
  }
  const engineId = value.engineId == null ? null : validateLocalAiEngineId(value.engineId);
  const modelId = value.modelId == null ? null : validateLocalAiModelId(value.modelId);
  if (["ready", "busy"].includes(state) && (!engineId || !modelId)) {
    throw new TypeError("Available Local AI requires engine and model identity");
  }
  return Object.freeze({
    schema: LOCAL_AI_PORT_SCHEMA,
    state,
    engineId,
    modelId,
    offline: value.offline !== false,
    migratable: value.migratable !== false,
  });
}

export function validateLocalAiRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Local AI request must be an object");
  }
  const systemPrompt = value.systemPrompt == null
    ? null
    : text(value.systemPrompt, "systemPrompt", LOCAL_AI_MAX_SYSTEM_PROMPT_CHARS);
  return Object.freeze({
    systemPrompt,
    prompt: text(value.prompt, "prompt", LOCAL_AI_MAX_PROMPT_CHARS),
    maxTokens: Number.isSafeInteger(value.maxTokens)
      && value.maxTokens > 0
      && value.maxTokens <= LOCAL_AI_MAX_OUTPUT_TOKENS
      ? value.maxTokens
      : 512,
  });
}

export function validateLocalAiResponseText(value) {
  return text(value, "Local AI response text", LOCAL_AI_MAX_RESPONSE_CHARS);
}

export function assertLocalAiPort(port) {
  if (!port || typeof port !== "object" || port.schema !== LOCAL_AI_PORT_SCHEMA) {
    throw new TypeError("Compatible Local AI port is required");
  }
  for (const method of ["getSnapshot", "subscribe", "generate"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Local AI port must implement ${method}()`);
    }
  }
  validateLocalAiSnapshot(port.getSnapshot());
  return port;
}
