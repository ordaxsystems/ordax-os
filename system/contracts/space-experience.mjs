export const SPACE_TYPE_DEFINITION_SCHEMA = "ordax.space-type-definition/1";
export const SPACE_TYPE_CATALOG_SCHEMA = "ordax.space-type-catalog/1";
export const SPACE_CAPABILITY_PROVIDER_SCHEMA = "ordax.space-capability-provider/2";
export const SPACE_CAPABILITY_SNAPSHOT_SCHEMA = "ordax.space-capability-snapshot/1";
export const SPACE_EXPERIENCE_SCHEMA = "ordax.space-experience/1";
export const SPACE_EXPERIENCE_SOURCE_SCHEMA = "ordax.space-experience-source/1";

const IDENTIFIER = /^[a-z0-9][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const TYPE_LIFECYCLES = new Set(["mvp-foundation", "deferred"]);
const SNAPSHOT_STATES = new Set(["ready", "unavailable", "error"]);

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function identifier(value, label, max = 96) {
  if (typeof value !== "string" || value.length > max || !IDENTIFIER.test(value)) {
    throw new TypeError(`${label} must be a bounded identifier`);
  }
  return value;
}

function boundedText(value, label, max = 160) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value.includes("\0")) {
    throw new TypeError(`${label} must be bounded text`);
  }
  return value;
}

function uniqueIdentifiers(value, label, maxItems = 64) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const entries = value.map((entry, index) => identifier(entry, `${label}[${index}]`, 128));
  if (new Set(entries).size !== entries.length) throw new TypeError(`${label} must be unique`);
  return Object.freeze(entries);
}

function normalizeProjectionItems(value, label, capabilities, maxItems = 32) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const seen = new Set();
  const items = value.map((raw, index) => {
    const item = objectValue(raw, `${label}[${index}]`);
    const id = identifier(item.id, `${label}[${index}].id`, 128);
    if (seen.has(id)) throw new TypeError(`${label} contains duplicate ${id}`);
    seen.add(id);
    const capability = item.capability == null
      ? null
      : identifier(item.capability, `${label}[${index}].capability`, 128);
    if (capability !== null && !capabilities.has(capability)) {
      throw new TypeError(`${label}[${index}] requires undeclared capability ${capability}`);
    }
    return Object.freeze({
      id,
      capability,
      label: boundedText(item.label, `${label}[${index}].label`, 120),
    });
  });
  return Object.freeze(items);
}

function normalizeResources(value, label) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 16) throw new TypeError(`${label} must be bounded`);
  const seen = new Set();
  return Object.freeze(value.map((raw, index) => {
    const item = objectValue(raw, `${label}[${index}]`);
    const kind = identifier(item.kind, `${label}[${index}].kind`, 64);
    if (seen.has(kind)) throw new TypeError(`${label} contains duplicate ${kind}`);
    seen.add(kind);
    if (!new Set(["one", "many"]).has(item.multiplicity)) {
      throw new TypeError(`${label}[${index}].multiplicity is invalid`);
    }
    return Object.freeze({
      kind,
      multiplicity: item.multiplicity,
      owner: identifier(item.owner, `${label}[${index}].owner`, 64),
      openWith: item.open_with == null ? null : identifier(item.open_with, `${label}[${index}].open_with`, 64),
    });
  }));
}

export function validateSpaceTypeDefinition(value, label = "Space type definition") {
  const raw = objectValue(value, label);
  if (raw.schema !== SPACE_TYPE_DEFINITION_SCHEMA) throw new TypeError(`${label} schema is incompatible`);
  const domain = identifier(raw.domain, `${label}.domain`, 80);
  const subtype = identifier(raw.subtype, `${label}.subtype`, 80);
  if (!TYPE_LIFECYCLES.has(raw.lifecycle)) throw new TypeError(`${label}.lifecycle is invalid`);
  const capabilities = uniqueIdentifiers(raw.capabilities, `${label}.capabilities`, 64);
  const capabilitySet = new Set(capabilities);
  const navigation = normalizeProjectionItems(raw.navigation, `${label}.navigation`, capabilitySet, 32);
  const dashboard = normalizeProjectionItems(raw.dashboard, `${label}.dashboard`, capabilitySet, 32);
  const cardMetrics = uniqueIdentifiers(raw.card_metrics ?? [], `${label}.card_metrics`, 16);
  const dashboardIds = new Set(dashboard.map((item) => item.id));
  for (const metricId of cardMetrics) {
    if (!dashboardIds.has(metricId)) throw new TypeError(`${label} card metric ${metricId} must be a dashboard metric`);
  }
  const profileBindings = Array.isArray(raw.profile_bindings)
    ? Object.freeze(raw.profile_bindings.map((entry, index) => boundedText(entry, `${label}.profile_bindings[${index}]`, 160)))
    : Object.freeze([]);
  if (new Set(profileBindings).size !== profileBindings.length) {
    throw new TypeError(`${label}.profile_bindings must be unique`);
  }
  const aura = objectValue(raw.aura, `${label}.aura`);
  if (aura.scope !== "current-space-only") throw new TypeError(`${label}.aura.scope is invalid`);
  const auraCapability = identifier(aura.capability, `${label}.aura.capability`, 128);
  if (!capabilitySet.has(auraCapability)) throw new TypeError(`${label}.aura capability must be declared`);
  return Object.freeze({
    schema: SPACE_TYPE_DEFINITION_SCHEMA,
    key: `${domain}.${subtype}`,
    domain,
    subtype,
    lifecycle: raw.lifecycle,
    profileBindings,
    capabilities,
    navigation,
    dashboard,
    cardMetrics,
    aura: Object.freeze({ capability: auraCapability, scope: aura.scope }),
    resources: normalizeResources(raw.resources, `${label}.resources`),
  });
}

export function validateSpaceTypeCatalog(value, label = "Space type catalog") {
  const raw = objectValue(value, label);
  if (raw.schema !== SPACE_TYPE_CATALOG_SCHEMA || !Array.isArray(raw.types) || raw.types.length > 64) {
    throw new TypeError(`${label} is incompatible or outside bounds`);
  }
  const types = Object.freeze(raw.types.map((entry, index) =>
    validateSpaceTypeDefinition(entry, `${label}.types[${index}]`)));
  const keys = new Set(types.map((entry) => entry.key));
  if (keys.size !== types.length) throw new TypeError(`${label} contains duplicate type keys`);
  const bindings = new Set();
  for (const type of types) {
    for (const binding of type.profileBindings) {
      if (bindings.has(binding)) throw new TypeError(`${label} contains duplicate profile binding ${binding}`);
      bindings.add(binding);
    }
  }
  return Object.freeze({ schema: SPACE_TYPE_CATALOG_SCHEMA, types });
}

export function validateSpaceCapabilitySnapshot(value, spaceId, label = "Space capability snapshot") {
  const raw = objectValue(value, label);
  if (raw.schema !== SPACE_CAPABILITY_SNAPSHOT_SCHEMA || !SNAPSHOT_STATES.has(raw.state)) {
    throw new TypeError(`${label} schema/state is invalid`);
  }
  if (raw.spaceId !== spaceId) throw new TypeError(`${label} belongs to another Space`);
  const metrics = raw.metrics ?? {};
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new TypeError(`${label}.metrics must be an object`);
  const entries = Object.entries(metrics);
  if (entries.length > 64) throw new TypeError(`${label}.metrics is outside bounds`);
  const normalizedMetrics = {};
  for (const [key, metric] of entries) {
    const id = identifier(key, `${label}.metrics key`, 128);
    if (!["string", "number", "boolean"].includes(typeof metric) || (typeof metric === "number" && !Number.isFinite(metric))) {
      throw new TypeError(`${label}.metrics.${id} must be a scalar`);
    }
    normalizedMetrics[id] = metric;
  }
  if (raw.state !== "ready" && entries.length > 0) {
    throw new TypeError(`${label} cannot expose metrics while unavailable`);
  }
  const auraContext = raw.state === "ready" && raw.auraContext != null
    ? objectValue(raw.auraContext, `${label}.auraContext`)
    : null;
  if (auraContext !== null && auraContext.spaceId !== spaceId) {
    throw new TypeError(`${label}.auraContext belongs to another Space`);
  }
  return Object.freeze({
    schema: SPACE_CAPABILITY_SNAPSHOT_SCHEMA,
    state: raw.state,
    spaceId,
    metrics: Object.freeze(normalizedMetrics),
    auraContext: auraContext === null ? null : Object.freeze({ ...auraContext }),
  });
}

export function assertSpaceCapabilityProvider(provider, label = "Space capability provider") {
  const raw = objectValue(provider, label);
  if (raw.schema !== SPACE_CAPABILITY_PROVIDER_SCHEMA) throw new TypeError(`${label} schema is incompatible`);
  const capability = identifier(raw.capability, `${label}.capability`, 128);
  const spaceTypes = uniqueIdentifiers(raw.spaceTypes, `${label}.spaceTypes`, 64);
  if (spaceTypes.length === 0) throw new TypeError(`${label}.spaceTypes must not be empty`);
  if (typeof raw.getSnapshot !== "function" || typeof raw.subscribe !== "function") {
    throw new TypeError(`${label} must implement getSnapshot() and subscribe()`);
  }
  return Object.freeze({ ...raw, capability, spaceTypes });
}

export function assertSpaceExperienceSource(source) {
  if (!source || source.schema !== SPACE_EXPERIENCE_SOURCE_SCHEMA || typeof source.get !== "function" || typeof source.subscribe !== "function") {
    throw new TypeError("Compatible Space experience source is required");
  }
  return source;
}
