import { validateIntelligenceContext } from "./intelligence.mjs";

export const INTELLIGENCE_CONTEXT_SOURCE_SCHEMA = "ordax.intelligence-context-source/1";
export const INTELLIGENCE_CONTEXT_REGISTRY_SCHEMA = "ordax.intelligence-context-registry/1";

const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const ACTIVATION_MODES = new Set(["automatic", "explicit"]);

function boundedText(value, label, max = 120) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

export function defineIntelligenceContextSource(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TypeError("Intelligence context source must be an object");
  }
  if (!SOURCE_ID_RE.test(spec.id ?? "")) {
    throw new TypeError("Intelligence context source id is invalid");
  }
  if (!ACTIVATION_MODES.has(spec.activation)) {
    throw new TypeError("Intelligence context source activation is invalid");
  }
  if (typeof spec.collect !== "function") {
    throw new TypeError("Intelligence context source must implement collect()");
  }

  return Object.freeze({
    schema: INTELLIGENCE_CONTEXT_SOURCE_SCHEMA,
    id: spec.id,
    title: boundedText(spec.title, "Intelligence context source title"),
    activation: spec.activation,
    collect: spec.collect,
  });
}

export function assertIntelligenceContextSource(value) {
  if (!value || typeof value !== "object" || value.schema !== INTELLIGENCE_CONTEXT_SOURCE_SCHEMA) {
    throw new TypeError("Compatible Intelligence context source is required");
  }
  if (!SOURCE_ID_RE.test(value.id ?? "") || !ACTIVATION_MODES.has(value.activation)) {
    throw new TypeError("Intelligence context source metadata is invalid");
  }
  boundedText(value.title, "Intelligence context source title");
  if (typeof value.collect !== "function") {
    throw new TypeError("Intelligence context source must implement collect()");
  }
  return value;
}

export function assertIntelligenceContextRegistry(value) {
  if (!value || typeof value !== "object" || value.schema !== INTELLIGENCE_CONTEXT_REGISTRY_SCHEMA) {
    throw new TypeError("Compatible Intelligence context registry is required");
  }
  for (const method of ["listSources", "collect"]) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`Intelligence context registry must implement ${method}()`);
    }
  }
  const sources = value.listSources();
  if (!Array.isArray(sources)) {
    throw new TypeError("Intelligence context registry source list is invalid");
  }
  return value;
}

export function validateContextSourceResult(value) {
  return validateIntelligenceContext(value ?? []);
}
