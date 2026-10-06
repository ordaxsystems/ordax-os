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

export const APPLICATION_AWARE_INTELLIGENCE_SCHEMA =
  "ordax.intelligence-application-awareness/1";

function contextCost(entries) {
  return entries.reduce((total, entry) => total + entry.text.length, 0);
}

export function createApplicationAwareIntelligence({
  intelligencePort,
  applicationAwarenessPort,
} = {}) {
  const intelligence = assertIntelligencePort(intelligencePort);
  const awareness = assertApplicationIntelligenceAwarenessPort(applicationAwarenessPort);

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
      if (request.context.length >= INTELLIGENCE_MAX_CONTEXT_ITEMS) {
        return intelligence.respond(request);
      }
      const applicationContext = awareness.contextItem();
      const usedChars = contextCost(request.context);
      if (
        usedChars + applicationContext.text.length
        > INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS
      ) {
        return intelligence.respond(request);
      }
      return intelligence.respond(validateIntelligenceRequest({
        intent: request.intent,
        prompt: request.prompt,
        context: [...request.context, applicationContext],
        maxTokens: request.maxTokens,
      }));
    },
  });
}
