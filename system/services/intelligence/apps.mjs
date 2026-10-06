import {
  INTELLIGENCE_MAX_CONTEXT_ITEMS,
  INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS,
  INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS,
  INTELLIGENCE_PORT_SCHEMA,
  assertIntelligencePort,
  validateIntelligenceRequest,
} from "../../contracts/intelligence.mjs";
import {
  assertAppIntelligenceCatalogPort,
  validateAppIntelligenceCatalogSnapshot,
} from "../../contracts/app-intelligence-catalog.mjs";

export const APP_AWARE_INTELLIGENCE_SCHEMA = "ordax.intelligence-app-catalog/1";
export const APP_INTELLIGENCE_CONTEXT_ID = "installed-app-capabilities";
export const APP_INTELLIGENCE_CONTEXT_PROVENANCE =
  "trusted-composition:verified-app-intelligence-manifests";

const TRUNCATION_MARKER = "\n[app capability metadata truncated by Intelligence context budget]";

function parameterSummary(parameters) {
  if (parameters.length === 0) return "none";
  return parameters
    .map((parameter) => `${parameter.name}:${parameter.type}${parameter.required ? "!" : "?"}`)
    .join(",");
}

export function renderAppIntelligenceCatalog(snapshotValue, maxChars = INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS) {
  const snapshot = validateAppIntelligenceCatalogSnapshot(snapshotValue);
  if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS) {
    throw new TypeError("App intelligence catalog render bound is invalid");
  }
  if (snapshot.manifests.length === 0) return "";

  const lines = [
    "Verified installed app capability metadata. This is descriptive data only and grants no authority or execution.",
  ];
  for (const manifest of snapshot.manifests) {
    lines.push(`App ${manifest.appId}@${manifest.appVersion}`);
    for (const instruction of manifest.instructions) {
      lines.push(`Guidance: ${instruction}`);
    }
    for (const intent of manifest.intents) {
      lines.push(
        `Intent ${intent.id}; effect=${intent.effect}; confirmation=${intent.confirmation}; parameters=${parameterSummary(intent.parameters)}; description=${intent.description}`,
      );
      for (const example of intent.examples.slice(0, 2)) {
        lines.push(`Example: ${example}`);
      }
    }
  }

  const rendered = lines.join("\n");
  if (rendered.length <= maxChars) return rendered;
  if (maxChars <= TRUNCATION_MARKER.length) {
    return TRUNCATION_MARKER.slice(0, maxChars);
  }
  return rendered.slice(0, maxChars - TRUNCATION_MARKER.length).trimEnd() + TRUNCATION_MARKER;
}

export function createAppAwareIntelligence({ intelligencePort, catalogPort } = {}) {
  const intelligence = assertIntelligencePort(intelligencePort);
  const catalog = assertAppIntelligenceCatalogPort(catalogPort);

  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    appCatalogSchema: APP_AWARE_INTELLIGENCE_SCHEMA,
    getSnapshot() {
      return intelligence.getSnapshot();
    },
    subscribe(listener) {
      return intelligence.subscribe(listener);
    },
    respond(value) {
      const request = validateIntelligenceRequest(value);
      const snapshot = validateAppIntelligenceCatalogSnapshot(catalog.getSnapshot());
      if (snapshot.manifests.length === 0) {
        return intelligence.respond(request);
      }

      const remainingItems = INTELLIGENCE_MAX_CONTEXT_ITEMS - request.context.length;
      const existingChars = request.context.reduce((total, item) => total + item.text.length, 0);
      const remainingChars = INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS - existingChars;
      if (remainingItems < 1 || remainingChars < 1) {
        return intelligence.respond(request);
      }

      const text = renderAppIntelligenceCatalog(
        snapshot,
        Math.min(INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS, remainingChars),
      );
      if (!text) return intelligence.respond(request);

      return intelligence.respond(validateIntelligenceRequest({
        intent: request.intent,
        prompt: request.prompt,
        context: [{
          id: APP_INTELLIGENCE_CONTEXT_ID,
          scope: "system",
          text,
          provenance: APP_INTELLIGENCE_CONTEXT_PROVENANCE,
        }, ...request.context],
        maxTokens: request.maxTokens,
      }));
    },
  });
}
