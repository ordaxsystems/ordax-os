export const INTELLIGENCE_PORT_SCHEMA = "ordax.intelligence/1";
export const INTELLIGENCE_RESPONSE_SCHEMA = "ordax.intelligence-response/1";
export const INTELLIGENCE_MAX_PROMPT_CHARS = 32000;
export const INTELLIGENCE_MAX_CONTEXT_ITEMS = 16;
export const INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS = 8192;
export const INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS = 65536;

const STATES = new Set(["degraded", "ready", "busy", "error"]);
const INTENTS = new Set(["ask", "explain", "summarize", "diagnose"]);
const CONTEXT_SCOPES = new Set(["user", "workspace", "system", "document"]);

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

export function validateIntelligenceSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence snapshot must be an object");
  }
  if (!STATES.has(value.state)) {
    throw new TypeError("Intelligence state is invalid");
  }
  if (value.authority !== "none" || value.toolExecution !== false) {
    throw new TypeError("Ordax Intelligence MVP must remain consultative");
  }
  const engineId = value.engineId == null
    ? null
    : boundedText(value.engineId, "Intelligence engineId", 80);
  const modelId = value.modelId == null
    ? null
    : boundedText(value.modelId, "Intelligence modelId", 160);
  const inferenceAvailable = value.inferenceAvailable === true;
  if (inferenceAvailable !== ["ready", "busy"].includes(value.state)) {
    throw new TypeError("Intelligence inference availability does not match state");
  }
  if (inferenceAvailable && (!engineId || !modelId)) {
    throw new TypeError("Ready Intelligence requires engine and model identity");
  }
  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    state: value.state,
    inferenceAvailable,
    engineId,
    modelId,
    authority: "none",
    toolExecution: false,
  });
}

function validateContext(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > INTELLIGENCE_MAX_CONTEXT_ITEMS) {
    throw new TypeError("Intelligence context must be a bounded array");
  }
  let total = 0;
  const result = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("Intelligence context item must be an object");
    }
    if (!CONTEXT_SCOPES.has(entry.scope)) {
      throw new TypeError("Intelligence context scope is invalid");
    }
    const id = boundedText(entry.id, "Intelligence context id", 160);
    const text = boundedText(
      entry.text,
      "Intelligence context text",
      INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS,
    );
    const provenance = boundedText(
      entry.provenance,
      "Intelligence context provenance",
      512,
    );
    total += text.length;
    if (total > INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS) {
      throw new TypeError("Intelligence context exceeds its total bound");
    }
    return Object.freeze({ id, scope: entry.scope, text, provenance });
  });
  return Object.freeze(result);
}

export function validateIntelligenceRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence request must be an object");
  }
  const intent = value.intent ?? "ask";
  if (!INTENTS.has(intent)) {
    throw new TypeError("Intelligence intent is invalid");
  }
  return Object.freeze({
    intent,
    prompt: boundedText(value.prompt, "Intelligence prompt", INTELLIGENCE_MAX_PROMPT_CHARS),
    context: validateContext(value.context),
    maxTokens:
      Number.isSafeInteger(value.maxTokens)
      && value.maxTokens > 0
      && value.maxTokens <= 2048
        ? value.maxTokens
        : 512,
  });
}

export function validateIntelligenceResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence response must be an object");
  }
  if (value.schema !== INTELLIGENCE_RESPONSE_SCHEMA || value.authority !== "none") {
    throw new TypeError("Intelligence response authority is invalid");
  }
  return Object.freeze({
    schema: INTELLIGENCE_RESPONSE_SCHEMA,
    text: boundedText(value.text, "Intelligence response text", 131072),
    engineId: boundedText(value.engineId, "Intelligence response engineId", 80),
    modelId: boundedText(value.modelId, "Intelligence response modelId", 160),
    authority: "none",
  });
}

export function assertIntelligencePort(port) {
  if (!port || typeof port !== "object" || port.schema !== INTELLIGENCE_PORT_SCHEMA) {
    throw new TypeError("Compatible Ordax Intelligence port is required");
  }
  for (const method of ["getSnapshot", "subscribe", "respond"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Ordax Intelligence port must implement ${method}()`);
    }
  }
  validateIntelligenceSnapshot(port.getSnapshot());
  return port;
}
