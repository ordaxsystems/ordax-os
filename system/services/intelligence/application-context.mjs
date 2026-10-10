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
import { assertApplicationSemanticRouter } from "./application-semantic-router.mjs";

const RESERVED_CONTEXT_IDS = new Set([
  "ordax-application-catalog",
  "ordax-application-action-capabilities",
]);

function reservedContextId(value) {
  return RESERVED_CONTEXT_IDS.has(value) || value.startsWith("ordax-application-detail:");
}

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
  semanticRouterPort = null,
} = {}) {
  const intelligence = assertIntelligencePort(intelligencePort);
  const awareness = assertApplicationIntelligenceAwarenessPort(awarenessPort);
  const capabilities = actionCapabilityRegistryPort === null
    ? null
    : assertApplicationActionCapabilityRegistryPort(actionCapabilityRegistryPort);
  const semanticRouter = semanticRouterPort === null
    ? null
    : assertApplicationSemanticRouter(semanticRouterPort);
  const awarenessContext = validatedSystemContextItem(
    awareness.contextItem(),
    "ordax-application-catalog",
  );
  const capabilityContext = capabilities === null
    ? null
    : validatedSystemContextItem(
        capabilities.contextItem(),
        "ordax-application-action-capabilities",
      );

  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return intelligence.getSnapshot();
    },
    subscribe(listener) {
      return intelligence.subscribe(listener);
    },
    respond(value, { signal = null, onDelta = null } = {}) {
      const request = validateIntelligenceRequest(value);
      for (const entry of request.context) {
        if (reservedContextId(entry.id)) {
          throw new TypeError(`Application Intelligence reserved context id cannot be caller supplied: ${entry.id}`);
        }
      }

      let context = [...request.context];
      context = appendIfFits(context, awarenessContext);
      const awarenessIncluded = context.length === request.context.length + 1;

      let selectedAppIds = null;
      if (semanticRouter !== null && awarenessIncluded) {
        let routedItems = null;
        if (typeof semanticRouter.route === "function") {
          const routed = semanticRouter.route(request.prompt);
          selectedAppIds = routed.selection.map(({ appId }) => appId);
          routedItems = routed.contextItems;
        } else {
          selectedAppIds = semanticRouter.select(request.prompt).map(({ appId }) => appId);
          routedItems = semanticRouter.contextItemsForPrompt(request.prompt);
        }
        for (const item of routedItems) {
          const validated = validatedSystemContextItem(item, item.id);
          context = appendIfFits(context, validated);
        }
      }

      if (capabilities !== null && awarenessIncluded) {
        if (
          selectedAppIds !== null
          && typeof capabilities.contextItemForApps === "function"
        ) {
          if (selectedAppIds.length > 0) {
            const filteredCapabilityContext = validatedSystemContextItem(
              capabilities.contextItemForApps(selectedAppIds),
              "ordax-application-action-capabilities",
            );
            context = appendIfFits(context, filteredCapabilityContext);
          }
        } else {
          context = appendIfFits(context, capabilityContext);
        }
      }

      return intelligence.respond(validateIntelligenceRequest({
        intent: request.intent,
        prompt: request.prompt,
        context,
        maxTokens: request.maxTokens,
      }), { signal, onDelta });
    },
  });
}
