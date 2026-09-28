import { assertIntelligenceContextRegistry } from "../../contracts/intelligence-context.mjs";
import {
  INTELLIGENCE_CONTEXT_CAPSULE_BUILDER_SCHEMA,
  INTELLIGENCE_CONTEXT_CAPSULE_SCHEMA,
  validateIntelligenceContextCapsule,
} from "../../contracts/intelligence-context-capsule.mjs";

const MAX_EXPLICIT_SOURCE_IDS = 64;

function explicitSourceIds(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_EXPLICIT_SOURCE_IDS) {
    throw new TypeError("Explicit Intelligence capsule sources must be a bounded array");
  }
  const ids = value.map((id) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new TypeError("Explicit Intelligence capsule source id is invalid");
    }
    return id.trim();
  });
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Explicit Intelligence capsule source ids must be unique");
  }
  return Object.freeze(ids);
}

export function createIntelligenceContextCapsuleBuilder(registryValue) {
  const registry = assertIntelligenceContextRegistry(registryValue);
  const sources = registry.listSources();
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  return Object.freeze({
    schema: INTELLIGENCE_CONTEXT_CAPSULE_BUILDER_SCHEMA,
    listSources() {
      return sources;
    },
    async build({
      intent = "ask",
      prompt = "",
      target = null,
      includeExplicitSourceIds = [],
      authorization = null,
      authorizations = [],
    } = {}) {
      const explicit = explicitSourceIds(includeExplicitSourceIds);
      for (const sourceId of explicit) {
        if (!sourceById.has(sourceId)) {
          throw new TypeError(`Unknown Intelligence context source: ${sourceId}`);
        }
      }

      const context = await registry.collect({
        intent,
        prompt,
        includeExplicitSourceIds: explicit,
        authorization,
        authorizations,
      });
      const explicitSet = new Set(explicit);
      const activatedSourceIds = sources
        .filter((source) => source.activation === "automatic" || explicitSet.has(source.id))
        .map((source) => source.id);

      return validateIntelligenceContextCapsule({
        schema: INTELLIGENCE_CONTEXT_CAPSULE_SCHEMA,
        intent,
        target,
        sourceIds: activatedSourceIds,
        context,
        authority: "none",
        executable: false,
        toolExecution: false,
      });
    },
  });
}
