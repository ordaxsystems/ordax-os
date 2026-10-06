import {
  INTELLIGENCE_MAX_CONTEXT_ITEMS,
  INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS,
  INTELLIGENCE_PORT_SCHEMA,
  assertIntelligencePort,
  validateIntelligenceRequest,
} from "../../contracts/intelligence.mjs";
import {
  assertApplicationIntelligenceAwarenessPort,
} from "../../contracts/application-intelligence-awareness.mjs";
import {
  assertApplicationActionCapabilityRegistryPort,
} from "../../contracts/application-action-capability.mjs";

const RESERVED_CONTEXT_IDS = new Set([
  "ordax-application-catalog",
  "ordax-application-action-capabilities",
]);

function validatedSystemContextItem(value, expectedId) {
  const validated = validateIntelligenceRequest({
    prompt: "context-validation",
    context: [value],
    maxTokens: 1,
  }).context[0];
  if (
    validated.id !== expectedId
    || validated.scope !== "system"
    || validated.provenance.length === 0
  ) {
    throw new TypeError(`Application Intelligence context item is invalid: ${expectedId}`);
  }
  return validated;
}

function appendIfFits(context, item) {
  if (context.length >= INTELLIGENCE_MAX_CONTEXT_ITEMS) return context;
  const usedChars = context.reduce((total, entry) => total + entry.text.length, 0);
  if (usedChars + item.text.length > INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS) {
    return context;
  }
  return [...context, item];
}

export function createApplicationContextIntelligence({
  intelligencePort,
  awarenessPort,
  actionCapabilityRegistryPort = null,
} = {}) {
  const intelligence = assertIntelligencePort(intelligencePort);
  const awareness = assertApplicationIntelligenceAwarenessPort(awarenessPort);
  const capabilities = actionCapabilityRegistryPort === null
    ? null
    : assertApplicationActionCapabilityRegistryPort(actionCapabilityRegistryPort);

  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return intelligence.getSnapshot();
    },
    subscribe(listener) {
      return intelligence.subscribe(listener);
    },
    respond(value) {
      const request = validateIntelligenceRequest(value);
      for (const entry of request.context) {
        if (RESERVED_CONTEXT_IDS.has(entry.id)) {
          throw new TypeError(`Application Intelligence reserved context id cannot be caller supplied: ${entry.id}`);
        }
      }

      let context = [...request.context];
      const awarenessContext = validatedSystemContextItem(
        awareness.contextItem(),
        "ordax-application-catalog",
      );
      context = appendIfFits(context, awarenessContext);
      const awarenessIncluded = context.length === request.context.length + 1;

      if (capabilities !== null && awarenessIncluded) {
        const capabilityContext = validatedSystemContextItem(
          capabilities.contextItem(),
          "ordax-application-action-capabilities",
        );
        context = appendIfFits(context, capabilityContext);
      }

      return intelligence.respond(validateIntelligenceRequest({
        intent: request.intent,
        prompt: request.prompt,
        context,
        maxTokens: request.maxTokens,
      }));
    },
  });
}
