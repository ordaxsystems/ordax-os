export const INTELLIGENCE_AGENT_SCHEMA = "ordax.intelligence-agent/1";
export const INTELLIGENCE_AGENT_REGISTRY_SCHEMA = "ordax.intelligence-agent-registry/1";

const AGENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const DOMAIN_ID_RE = /^[a-z][a-z0-9.-]{0,95}$/;
const MAX_AGENTS = 32;
const ALLOWED_DESCRIPTOR_KEYS = new Set([
  "schema",
  "id",
  "title",
  "description",
  "domain",
  "readOnly",
  "authority",
  "executable",
  "toolExecution",
]);

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function rejectUnknownKeys(value) {
  for (const key of Object.keys(value)) {
    if (!ALLOWED_DESCRIPTOR_KEYS.has(key)) {
      throw new TypeError(`Intelligence agent descriptor field ${key} is not allowed`);
    }
  }
}

export function validateIntelligenceAgentId(value) {
  const id = boundedText(value, "Intelligence agent id", 64);
  if (!AGENT_ID_RE.test(id)) {
    throw new TypeError("Intelligence agent id is invalid");
  }
  return id;
}

export function validateIntelligenceAgentDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence agent descriptor must be an object");
  }
  rejectUnknownKeys(value);
  if (value.schema !== INTELLIGENCE_AGENT_SCHEMA) {
    throw new TypeError("Intelligence agent descriptor schema is invalid");
  }
  const id = validateIntelligenceAgentId(value.id);
  const domain = boundedText(value.domain, "Intelligence agent domain", 96);
  if (!DOMAIN_ID_RE.test(domain)) {
    throw new TypeError("Intelligence agent domain is invalid");
  }
  if (
    value.readOnly !== true
    || value.authority !== "none"
    || value.executable !== false
    || value.toolExecution !== false
  ) {
    throw new TypeError("Intelligence agent registry foundation must remain read-only and non-executable");
  }
  return Object.freeze({
    schema: INTELLIGENCE_AGENT_SCHEMA,
    id,
    title: boundedText(value.title, "Intelligence agent title", 120),
    description: boundedText(value.description, "Intelligence agent description", 512),
    domain,
    readOnly: true,
    authority: "none",
    executable: false,
    toolExecution: false,
  });
}

export function validateIntelligenceAgentDescriptors(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_AGENTS) {
    throw new TypeError("Intelligence agent descriptors must be a bounded non-empty array");
  }
  const agents = value.map(validateIntelligenceAgentDescriptor);
  if (new Set(agents.map((agent) => agent.id)).size !== agents.length) {
    throw new TypeError("Intelligence agent ids must be unique");
  }
  return Object.freeze(agents);
}
