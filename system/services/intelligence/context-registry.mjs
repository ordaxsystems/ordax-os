import {
  INTELLIGENCE_CONTEXT_REGISTRY_SCHEMA,
  assertIntelligenceContextSource,
  validateContextSourceResult,
} from "../../contracts/intelligence-context.mjs";
import { validateIntelligenceContext } from "../../contracts/intelligence.mjs";

const MAX_CONTEXT_SOURCES = 64;

function freezeSourceMetadata(source) {
  return Object.freeze({
    id: source.id,
    title: source.title,
    activation: source.activation,
  });
}

function explicitSourceSet(value) {
  if (value == null) return new Set();
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_SOURCES) {
    throw new TypeError("Explicit Intelligence context sources must be a bounded array");
  }
  const ids = value.map((id) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new TypeError("Explicit Intelligence context source id is invalid");
    }
    return id.trim();
  });
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Explicit Intelligence context source ids must be unique");
  }
  return new Set(ids);
}

export function createIntelligenceContextRegistry({ sources = [] } = {}) {
  if (!Array.isArray(sources) || sources.length > MAX_CONTEXT_SOURCES) {
    throw new TypeError("Intelligence context registry sources must be a bounded array");
  }

  const normalized = sources.map(assertIntelligenceContextSource);
  const ids = normalized.map((source) => source.id);
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Intelligence context source ids must be unique");
  }
  const sourceIdSet = new Set(ids);
  const metadata = Object.freeze(normalized.map(freezeSourceMetadata));

  return Object.freeze({
    schema: INTELLIGENCE_CONTEXT_REGISTRY_SCHEMA,
    listSources() {
      return metadata;
    },
    async collect({
      prompt = "",
      intent = "ask",
      includeExplicitSourceIds = [],
      authorization = null,
    } = {}) {
      const explicit = explicitSourceSet(includeExplicitSourceIds);
      for (const sourceId of explicit) {
        if (!sourceIdSet.has(sourceId)) {
          throw new TypeError(`Unknown Intelligence context source: ${sourceId}`);
        }
      }

      const context = [];
      const contextIds = new Set();
      for (const source of normalized) {
        const enabled = source.activation === "automatic" || explicit.has(source.id);
        if (!enabled) continue;
        const collected = validateContextSourceResult(await source.collect({
          prompt,
          intent,
          authorization,
        }));
        for (const item of collected) {
          if (contextIds.has(item.id)) {
            throw new TypeError(`Duplicate Intelligence context item id: ${item.id}`);
          }
          contextIds.add(item.id);
          context.push(item);
        }
      }
      return validateIntelligenceContext(context);
    },
  });
}
